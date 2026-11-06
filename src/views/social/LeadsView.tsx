import { useEffect, useMemo, useRef, useState } from 'react'
import './social.css'
import './leads.css'
import { dShort } from '../../lib/social/format'
import { corrigerTextes } from '../../lib/social/api-leads'
import type { Relecture } from '../../lib/social/api-leads'
import { boutiquesReseau, effacerAvis, enregistrer, journaliser, parId, useSocial } from '../../lib/social/store'
import type { Objet } from '../../lib/social/store'

/** Les questions standard d'un formulaire instantané Meta (repris de social-data.js, LF_Q). */
const LF_Q: Record<string, string> = {
  FULL_NAME: 'Nom complet',
  FIRST_NAME: 'Prénom',
  LAST_NAME: 'Nom',
  EMAIL: 'E-mail',
  PHONE: 'Téléphone',
  CITY: 'Ville',
  ZIP: 'Code postal',
  COMPANY_NAME: 'Société',
  JOB_TITLE: 'Fonction',
}
const EXEMPLE: Record<string, string> = {
  FULL_NAME: 'Marie Dupont',
  FIRST_NAME: 'Marie',
  LAST_NAME: 'Dupont',
  EMAIL: 'marie@exemple.be',
  PHONE: '+32 470 00 00 00',
  CITY: 'Wavre',
  ZIP: '1300',
  COMPANY_NAME: 'Votre société',
  JOB_TITLE: 'Votre fonction',
}

interface Question {
  type: string
  key?: string
  label?: string
  options?: { key: string; value: string }[]
}

interface Formulaire {
  id: string
  family: string
  version: number
  status: string
  name: string
  locale: string
  created: string
  shops: string[]
  questions: Question[]
  privacy: { url?: string; link_text?: string }
  context: { title?: string; style?: string; content?: string[]; button_text?: string }
  thanks: { title?: string; body?: string; button_type?: string; button_text?: string; website_url?: string }
  quality: boolean
  followUp?: string
  metaError?: string | null
  isNew?: boolean
}

interface Lead {
  id: string
  form: string
  shop: string
  created_time?: string
  field_data?: Record<string, string>
  ad?: string
}

type Apercu = 'intro' | 'form' | 'thanks'
interface RelectureOuverte extends Relecture {
  avant: Record<string, string>
  ou: Record<string, string>
}

const ETAT_FORM: Record<string, string> = { Actif: 'is-actif', Brouillon: 'is-brouillon' }

/** Les textes du brouillon que lit la personne (intro, remerciement, questions personnalisées). */
function textesFormulaire(d: Formulaire): { cle: string; ou: string; texte: string }[] {
  const out: { cle: string; ou: string; texte: string }[] = []
  const add = (cle: string, ou: string, t: string | undefined) => {
    if (String(t ?? '').trim()) out.push({ cle, ou, texte: String(t) })
  }
  const ctx = d.context ?? {}
  const ty = d.thanks ?? {}
  add('ctx.title', 'Intro · titre', ctx.title)
  add('ctx.content', 'Intro · contenu', (ctx.content ?? []).join('\n'))
  add('ctx.button', 'Intro · bouton', ctx.button_text)
  add('ty.title', 'Merci · titre', ty.title)
  add('ty.body', 'Merci · texte', ty.body)
  add('ty.button', 'Merci · bouton', ty.button_text)
  d.questions.forEach((q, i) => {
    if (q.type !== 'CUSTOM') return
    add(`q.${i}.label`, `Question ${i + 1}`, q.label)
    ;(q.options ?? []).forEach((o, k) => add(`q.${i}.o.${k}`, `Question ${i + 1} · option`, o.value))
  })
  return out.slice(0, 20)
}

/** Remet un texte corrigé à sa place dans le brouillon. */
function poserTexte(d: Formulaire, cle: string, t: string): Formulaire {
  const ctx = { ...d.context }
  const ty = { ...d.thanks }
  const qs = d.questions.map((q) => ({ ...q, options: (q.options ?? []).map((o) => ({ ...o })) }))
  const m = cle.match(/^q\.(\d+)\.(label|o\.(\d+))$/)
  if (cle === 'ctx.title') ctx.title = t
  else if (cle === 'ctx.content') ctx.content = t.split('\n')
  else if (cle === 'ctx.button') ctx.button_text = t
  else if (cle === 'ty.title') ty.title = t
  else if (cle === 'ty.body') ty.body = t
  else if (cle === 'ty.button') ty.button_text = t
  else if (m && qs[+m[1]]) {
    if (m[2] === 'label') qs[+m[1]].label = t
    else if (qs[+m[1]].options[+m[3]]) qs[+m[1]].options[+m[3]].value = t
  }
  return { ...d, context: ctx, thanks: ty, questions: qs }
}

function useToast(duree: number): [string, (m: string) => void] {
  const [msg, setMsg] = useState('')
  const t = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(t.current), [])
  return [
    msg,
    (m: string) => {
      window.clearTimeout(t.current)
      setMsg(m)
      t.current = window.setTimeout(() => setMsg(''), duree)
    },
  ]
}

/**
 * Formulaires de leads — l'écran « Leads » du module Social, réécrit dans le Marketing (docs/PORTAILS.md,
 * étape 2f). Formulaires instantanés Meta par familles de versions (un formulaire publié ne se modifie
 * plus : « Nouvelle version » le duplique), aperçu mobile, relecteur des textes et leads reçus.
 * Données : l'état du module Social (`/state`, collections `leadforms`, `leads`, `ads`).
 */
export default function LeadsView() {
  const { etat, serveur, erreur, chargement, avis } = useSocial()
  const [selId, setSelId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Formulaire | null>(null)
  const [pv, setPv] = useState<Apercu>('intro')
  const [leadScope, setLeadScope] = useState<'version' | 'family'>('version')
  const [err, setErr] = useState('')
  const [opt, setOpt] = useState<Record<number, string>>({})
  const [cor, setCor] = useState<RelectureOuverte | null>(null)
  const [corBusy, setCorBusy] = useState(false)
  const [toast, montrer] = useToast(2800)

  const forms = useMemo(() => ((etat?.leadforms ?? []) as unknown as Formulaire[]), [etat])
  const leads = useMemo(() => ((etat?.leads ?? []) as unknown as Lead[]), [etat])

  const blankDraft = (): Formulaire => ({
    isNew: true,
    id: 'new',
    family: `f${Date.now()}`,
    version: 1,
    status: 'Brouillon',
    name: '',
    locale: 'fr_FR',
    created: serveur?.today ?? '',
    shops: [etat ? boutiquesReseau(etat)[0]?.id : undefined].filter((x): x is string => !!x),
    questions: [{ type: 'FULL_NAME' }, { type: 'EMAIL' }],
    privacy: { url: 'https://www.latelierby.be/confidentialite', link_text: 'Politique de confidentialité' },
    context: { title: '', style: 'LIST_STYLE', content: [], button_text: 'Continuer' },
    thanks: { title: 'Merci !', body: '', button_type: 'VIEW_WEBSITE', button_text: 'Voir le site', website_url: 'https://www.latelierby.be' },
    quality: true,
    followUp: 'https://www.latelierby.be',
  })

  // Aucun formulaire (base neuve) : on ouvre directement un nouveau formulaire.
  const vide = !!etat && !forms.length && !draft
  useEffect(() => {
    if (vide) {
      setDraft(blankDraft())
      setErr('')
    }
    // blankDraft lit l'état courant ; on ne relance que quand la liste se vide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vide])

  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>

  const boutiques = boutiquesReseau(etat)
  const sel = forms.find((x) => x.id === selId) ?? forms[0]
  const d = draft ?? sel
  if (!d) return <p className="muted">Ouverture d’un nouveau formulaire…</p>
  const editable = !!draft
  const D = (patch: Partial<Formulaire>) => {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    setErr('')
  }

  const fam: Record<string, Formulaire[]> = {}
  forms.forEach((x) => {
    ;(fam[x.family] = fam[x.family] ?? []).push(x)
  })
  const leadsOf = (ids: string[]) => leads.filter((l) => ids.includes(l.form))
  const familles = Object.keys(fam).map((k) => ({
    k,
    name: fam[k][fam[k].length - 1].name,
    versions: fam[k].slice().sort((a, b) => b.version - a.version),
  }))
  const famVersions = fam[d.family] ?? []
  const famIds = famVersions.map((x) => x.id)
  const nextN = Math.max(0, ...famVersions.map((x) => x.version)) + 1
  const qTypes = d.questions.map((q) => q.type)
  const custom = d.questions.map((q, i) => ({ q, i })).filter((x) => x.q.type === 'CUSTOM')
  const setQ = (i: number, patch: Partial<Question>) => {
    const qs = d.questions.slice()
    qs[i] = { ...qs[i], ...patch }
    D({ questions: qs })
  }
  const ctx = d.context ?? {}
  const ty = d.thanks ?? {}
  const privacy = d.privacy ?? {}
  const statut = editable ? 'Brouillon' : d.status
  const titre = editable ? (d.isNew ? 'Nouveau formulaire · brouillon' : `${d.name} · v${nextN} (brouillon)`) : `${d.name} · v${d.version}`

  // Leads reçus
  const rowsSrc = leadsOf(leadScope === 'family' ? famIds : [d.id])
  const keys = d.questions.map((q) => (q.type === 'CUSTOM' ? q.key ?? '' : q.type))
  const leadHead = ['created_time', 'Boutique', 'Version', ...d.questions.map((q) => (q.type === 'CUSTOM' ? q.label ?? '' : LF_Q[q.type] ?? q.type)), 'Publicité']
  const leadRows = rowsSrc.map((l) => {
    const t = String(l.created_time ?? '')
    return [
      t ? `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11)}` : '—',
      parId(etat.shops, l.shop)?.name ?? l.shop ?? '—',
      `v${forms.find((x) => x.id === l.form)?.version ?? '?'}`,
      ...keys.map((k) => l.field_data?.[k] || '—'),
      l.ad ?? '—',
    ]
  })

  const ajouterOption = (i: number) => {
    const v = String(opt[i] ?? '').trim()
    if (!draft || !v) return
    const qs = draft.questions.slice()
    const q = qs[i]
    if (!q || q.type !== 'CUSTOM') return
    const opts = q.options ?? []
    if (!opts.some((o) => o.value.toLowerCase() === v.toLowerCase())) {
      const base =
        v
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'option'
      let key = base
      let n = 2
      while (opts.some((o) => o.key === key)) key = `${base}_${n++}`
      qs[i] = { ...q, options: opts.concat({ key, value: v }) }
    }
    setDraft({ ...draft, questions: qs })
    setOpt({ ...opt, [i]: '' })
    setErr('')
  }

  const corriger = async () => {
    if (!draft || corBusy) return
    const L = String(draft.locale || 'fr_FR').slice(0, 2)
    const textes = textesFormulaire(draft)
    if (!textes.length) {
      montrer('Aucun texte à relire.')
      return
    }
    setCorBusy(true)
    setCor(null)
    setErr('')
    try {
      const langue = (['fr', 'nl', 'en'].includes(L) ? L : 'fr') as 'fr' | 'nl' | 'en'
      const r = await corrigerTextes(
        `un formulaire de leads Meta (${draft.name || 'sans nom'})`,
        textes.map((x) => ({ cle: x.cle, langue, texte: x.texte })),
      )
      setCor({ ...r, avant: Object.fromEntries(textes.map((x) => [x.cle, x.texte])), ou: Object.fromEntries(textes.map((x) => [x.cle, x.ou])) })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCorBusy(false)
    }
  }
  const corChange = !!cor && (cor.textes ?? []).some((x) => x.change)
  const nCor = (cor?.corrections ?? []).length
  const corAppliquer = () => {
    if (!cor || !draft) return
    const cur = Object.fromEntries(textesFormulaire(draft).map((x) => [x.cle, x.texte]))
    let dr = draft
    let garde = 0
    ;(cor.textes ?? []).forEach((x) => {
      if (!x.change) return
      if (cur[x.cle] !== cor.avant[x.cle]) {
        garde++
        return
      }
      dr = poserTexte(dr, x.cle, x.texte)
    })
    setDraft(dr)
    setCor(null)
    montrer(garde ? `${garde} texte(s) modifié(s) depuis la relecture : relancez « Corriger les textes ».` : 'Corrections appliquées.')
  }

  const publier = () => {
    const dr = draft
    if (!dr) return
    if (!dr.name.trim()) return setErr('Le nom est obligatoire (name).')
    if (!dr.questions.length) return setErr('Ajoutez au moins une question (questions).')
    if (!dr.privacy?.url) return setErr('La politique de confidentialité est obligatoire (privacy_policy.url).')
    if (dr.questions.some((q) => q.type === 'CUSTOM' && (!q.label || !q.key))) return setErr('Chaque question personnalisée doit avoir un intitulé et une clé.')
    const id = `lf-${Date.now()}`
    const nf: Formulaire = { ...dr, id, version: dr.isNew ? 1 : nextN, status: 'Actif', created: serveur.today }
    delete nf.isNew
    const list = forms.map((x) => (x.family === nf.family && x.status === 'Actif' ? { ...x, status: 'Archivé' } : x)).concat(nf)
    const ads = etat.ads.map((a) => (a.leadForm && famIds.includes(String(a.leadForm)) ? { ...a, leadForm: id } : a))
    enregistrer({ leadforms: list as unknown as Objet[], ads })
    journaliser('Formulaire', `« ${nf.name} » v${nf.version} publié${nf.version > 1 ? `, v${nf.version - 1} archivée` : ''}`)
    setDraft(null)
    setSelId(id)
    setOpt({})
    montrer(`Version ${nf.version} envoyée à Meta${nf.version > 1 ? ' · la précédente est archivée.' : '.'} Un refus de Meta s’affiche sous le titre.`)
  }

  const exporter = () => {
    const csv =
      '﻿' +
      [leadHead]
        .concat(leadRows)
        .map((r) => r.map((v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(';'))
        .join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `leads-${d.family}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    montrer('Leads exportés (CSV).')
  }

  const ctxLines = (ctx.content ?? []).filter((x) => x.trim())
  const pvFields = d.questions.map((q) =>
    q.type === 'CUSTOM'
      ? { label: q.label || 'Question', ph: (q.options ?? []).map((o) => o.value).join(' / ') || 'Réponse' }
      : { label: LF_Q[q.type] ?? q.type, ph: EXEMPLE[q.type] ?? '' },
  )
  const pvPage = `L'Atelier By ${parId(etat.shops, d.shops[0])?.name ?? ''}`
  const leadCols = `110px 100px 64px ${d.questions.map(() => 'minmax(110px,1fr)').join(' ')} minmax(140px,1fr)`

  return (
    <div className="social-native leads">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">
            Formulaires instantanés · <code>POST /{'{page_id}'}/leadgen_forms</code>
          </span>
          <span className="leads__espace" />
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(blankDraft())
              setErr('')
              setOpt({})
            }}
          >
            Nouveau formulaire
          </button>
        </div>
      </div>

      {avis ? (
        <p className="warning leads__avis">
          {avis}{' '}
          <button type="button" className="linklike" onClick={effacerAvis}>
            Fermer
          </button>
        </p>
      ) : null}

      <div className="leads__info card">
        <span className="leads__info-v">v</span>
        <span>
          <span className="leads__encre">Un formulaire Meta ne se modifie pas après sa création.</span> « Nouvelle version » duplique le formulaire ; à
          la publication, la nouvelle version remplace l'ancienne dans les publicités et l'ancienne est archivée. Ses leads restent consultables.
        </span>
      </div>

      <div className="leads__corps">
        {/* Liste */}
        <aside className="leads__liste">
          {draft?.isNew ? (
            <div className="leads__famille">
              <div className="leads__famille-nom">{draft.name || 'Nouveau formulaire'}</div>
              <button type="button" className="leads__version is-on">
                <span className="leads__version-txt">
                  <span>Version 1</span>
                  <span className="muted">Non publié</span>
                </span>
                <span className="leads__etat is-brouillon">Brouillon</span>
              </button>
            </div>
          ) : null}
          {familles.map((f) => (
            <div key={f.k} className="leads__famille">
              <div className="leads__famille-nom">{f.name}</div>
              {f.versions.map((x) => {
                const on = !draft && x.id === sel?.id
                return (
                  <button
                    key={x.id}
                    type="button"
                    className={`leads__version${on ? ' is-on' : ''}`}
                    onClick={() => {
                      setSelId(x.id)
                      setDraft(null)
                      setErr('')
                    }}
                  >
                    <span className="leads__version-txt">
                      <span>Version {x.version}</span>
                      <span className="muted">
                        Créé le {dShort(x.created)} · {leadsOf([x.id]).length} leads
                      </span>
                    </span>
                    <span className={`leads__etat ${ETAT_FORM[x.status] ?? ''}`}>{x.status}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </aside>

        {/* Éditeur */}
        <section className="card leads__editeur">
          <div className="leads__tete">
            <span className="leads__titre">
              <span>{titre}</span>
              <span className={`leads__etat ${ETAT_FORM[statut] ?? ''}`}>{statut}</span>
            </span>
            <div className="leads__actions">
              {!editable && d.status !== 'Archivé' ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    if (!sel) return
                    setDraft(JSON.parse(JSON.stringify({ ...sel, status: 'Brouillon', metaError: null })) as Formulaire)
                    setErr('')
                    setOpt({})
                  }}
                >
                  Nouvelle version (v{nextN})
                </button>
              ) : null}
              {editable ? (
                <>
                  <button type="button" className={`btn${corBusy ? ' is-busy' : ''}`} title="Orthographe, grammaire, typographie et charte, sans réécrire" onClick={() => void corriger()}>
                    {corBusy ? 'Relecture…' : '✓ Corriger les textes'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setDraft(null)
                      setErr('')
                      setOpt({})
                      setCor(null)
                    }}
                  >
                    Abandonner
                  </button>
                  <button type="button" className="btn btn--primary" onClick={publier}>
                    Publier sur Meta
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {!editable ? <span className="muted leads__petit">Lecture seule : créez une nouvelle version pour modifier ce formulaire.</span> : null}
          {err ? <span className="leads__erreur">{err}</span> : null}
          {/* Le relecteur : les corrections des textes du formulaire, appliquées sur demande. */}
          {cor && editable ? (
            <div className="leads__relecture">
              <span className="leads__relecture-titre">
                {corChange ? `Relecture · ${nCor} correction${nCor > 1 ? 's' : ''}` : 'Relecture · rien à corriger'}
              </span>
              {(cor.corrections ?? []).map((x, i) => (
                <span key={i} className="leads__correction">
                  <span className="muted">{cor.ou[x.cle] ?? x.cle}</span> <s className="leads__avant">{x.avant}</s> → <span className="leads__apres">{x.apres}</span>{' '}
                  <span className="muted">· {x.raison}</span>
                </span>
              ))}
              {(cor.remarques ?? []).map((rq, i) => (
                <span key={i} className="leads__remarque">
                  {rq}
                </span>
              ))}
              <div className="leads__actions">
                {corChange ? (
                  <button type="button" className="btn btn--sm" onClick={corAppliquer}>
                    Appliquer les corrections
                  </button>
                ) : null}
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setCor(null)}>
                  {corChange ? 'Ignorer' : 'Fermer'}
                </button>
              </div>
            </div>
          ) : null}
          {/* Ce que Meta a répondu à la publication (refus d'une Page, d'une question…) : jamais caché derrière « publié ». */}
          {!editable && d.metaError ? <span className="leads__erreur">{d.metaError}</span> : null}

          <div className="leads__ligne">
            <label className="leads__champ leads__champ--2">
              <span>
                Nom interne <code>name *</code>
              </span>
              <input type="text" value={d.name} disabled={!editable} onChange={(e) => D({ name: e.target.value })} />
            </label>
            <label className="leads__champ">
              <span>
                Langue <code>locale</code>
              </span>
              <select value={d.locale} disabled={!editable} onChange={(e) => D({ locale: e.target.value })}>
                <option value="fr_FR">fr_FR · Français</option>
                <option value="nl_BE">nl_BE · Nederlands</option>
                <option value="en_GB">en_GB · English</option>
              </select>
            </label>
          </div>

          <div className="leads__bloc">
            <span className="leads__libelle">
              Questions standard <code>questions [{'{type}'}] *</code>
            </span>
            <div className="leads__puces">
              {Object.keys(LF_Q).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`filter${qTypes.includes(t) ? ' is-on' : ''}`}
                  disabled={!editable}
                  onClick={() =>
                    D({
                      questions: qTypes.includes(t)
                        ? d.questions.filter((q) => q.type !== t)
                        : d.questions
                            .filter((q) => q.type !== 'CUSTOM')
                            .concat({ type: t })
                            .concat(d.questions.filter((q) => q.type === 'CUSTOM')),
                    })
                  }
                >
                  {LF_Q[t]} <code>{t}</code>
                </button>
              ))}
            </div>
          </div>

          <div className="leads__bloc">
            <span className="leads__libelle">
              Questions personnalisées <code>{'{type: "CUSTOM", key, label, options: [{key, value}]}'}</code>
            </span>
            {custom.map(({ q, i }) => (
              <div key={i} className="leads__question">
                <div className="leads__ligne">
                  <input
                    className="leads__grand"
                    type="text"
                    placeholder="Intitulé"
                    value={q.label ?? ''}
                    disabled={!editable}
                    onChange={(e) => setQ(i, { label: e.target.value })}
                  />
                  <input
                    className="leads__cle"
                    type="text"
                    placeholder="clé"
                    value={q.key ?? ''}
                    disabled={!editable}
                    onChange={(e) => setQ(i, { key: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })}
                  />
                  {editable ? (
                    <button type="button" className="btn btn--sm btn--danger" onClick={() => D({ questions: d.questions.filter((_, j) => j !== i) })}>
                      Supprimer
                    </button>
                  ) : null}
                </div>
                <div className="leads__options">
                  {(q.options ?? []).map((op, k) => (
                    <span key={op.key} className="leads__option">
                      {op.value}
                      {editable ? (
                        <button
                          type="button"
                          className="leads__option-x"
                          aria-label={`Retirer ${op.value}`}
                          onClick={() => setQ(i, { options: (q.options ?? []).filter((_, j) => j !== k) })}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}
                  {editable ? (
                    <>
                      {/* L'option tapée s'ajoute par Entrée, par « + Ajouter » ou en quittant le champ : rien de ce qui est écrit ne se perd. */}
                      <input
                        type="text"
                        className="leads__nouvelle"
                        placeholder="Nouvelle option"
                        aria-label="Nouvelle option"
                        value={opt[i] ?? ''}
                        onChange={(e) => setOpt({ ...opt, [i]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            ajouterOption(i)
                          }
                        }}
                        onBlur={() => ajouterOption(i)}
                      />
                      <button type="button" className="btn btn--sm" onClick={() => ajouterOption(i)}>
                        + Ajouter
                      </button>
                    </>
                  ) : null}
                </div>
                <span className="muted leads__petit">
                  {(q.options ?? []).length
                    ? 'Choix multiple : la personne choisit une option.'
                    : 'Sans option : réponse libre. Ajoutez des options pour un choix multiple.'}
                </span>
              </div>
            ))}
            {editable ? (
              <button
                type="button"
                className="btn btn--sm leads__ajout"
                onClick={() => D({ questions: d.questions.concat({ type: 'CUSTOM', key: `question_${custom.length + 1}`, label: '', options: [] }) })}
              >
                + Question personnalisée
              </button>
            ) : null}
          </div>

          <div className="leads__bloc leads__bloc--filet">
            <span className="leads__sous-titre">
              Écran d'introduction <code>context_card</code>
            </span>
            <div className="leads__ligne">
              <input
                className="leads__grand"
                type="text"
                placeholder="title"
                value={ctx.title ?? ''}
                disabled={!editable}
                onChange={(e) => D({ context: { ...ctx, title: e.target.value } })}
              />
              <select value={ctx.style ?? 'LIST_STYLE'} disabled={!editable} onChange={(e) => D({ context: { ...ctx, style: e.target.value } })}>
                <option value="LIST_STYLE">Liste · LIST_STYLE</option>
                <option value="PARAGRAPH_STYLE">Paragraphe · PARAGRAPH_STYLE</option>
              </select>
              <input
                type="text"
                placeholder="button_text"
                value={ctx.button_text ?? ''}
                disabled={!editable}
                onChange={(e) => D({ context: { ...ctx, button_text: e.target.value } })}
              />
            </div>
            <textarea
              rows={3}
              placeholder="content (une ligne par point)"
              value={(ctx.content ?? []).join('\n')}
              disabled={!editable}
              onChange={(e) => D({ context: { ...ctx, content: e.target.value.split('\n') } })}
            />
          </div>

          <div className="leads__bloc leads__bloc--filet">
            <span className="leads__sous-titre">
              Écran de remerciement <code>thank_you_page</code>
            </span>
            <div className="leads__ligne">
              <input type="text" placeholder="title" value={ty.title ?? ''} disabled={!editable} onChange={(e) => D({ thanks: { ...ty, title: e.target.value } })} />
              <input
                className="leads__grand"
                type="text"
                placeholder="body"
                value={ty.body ?? ''}
                disabled={!editable}
                onChange={(e) => D({ thanks: { ...ty, body: e.target.value } })}
              />
            </div>
            <div className="leads__ligne">
              <select value={ty.button_type ?? 'VIEW_WEBSITE'} disabled={!editable} onChange={(e) => D({ thanks: { ...ty, button_type: e.target.value } })}>
                <option value="VIEW_WEBSITE">Voir le site · VIEW_WEBSITE</option>
                <option value="CALL_BUSINESS">Appeler · CALL_BUSINESS</option>
                <option value="DOWNLOAD">Télécharger · DOWNLOAD</option>
              </select>
              <input
                type="text"
                placeholder="button_text"
                value={ty.button_text ?? ''}
                disabled={!editable}
                onChange={(e) => D({ thanks: { ...ty, button_text: e.target.value } })}
              />
              <input
                className="leads__grand"
                type="url"
                placeholder="website_url"
                value={ty.website_url ?? ''}
                disabled={!editable}
                onChange={(e) => D({ thanks: { ...ty, website_url: e.target.value } })}
              />
            </div>
          </div>

          <div className="leads__ligne leads__bloc--filet">
            <label className="leads__champ leads__champ--2">
              <span>
                Politique de confidentialité <code>privacy_policy.url *</code>
              </span>
              <input type="url" value={privacy.url ?? ''} disabled={!editable} onChange={(e) => D({ privacy: { ...privacy, url: e.target.value } })} />
            </label>
            <label className="leads__champ">
              <span>
                Texte du lien <code>privacy_policy.link_text</code>
              </span>
              <input type="text" value={privacy.link_text ?? ''} disabled={!editable} onChange={(e) => D({ privacy: { ...privacy, link_text: e.target.value } })} />
            </label>
            <label className="leads__champ leads__champ--2">
              <span>
                Lien après envoi <code>follow_up_action_url</code>
              </span>
              <input type="url" value={d.followUp ?? ''} disabled={!editable} onChange={(e) => D({ followUp: e.target.value })} />
            </label>
          </div>
          <label className="leads__case">
            <input type="checkbox" checked={!!d.quality} disabled={!editable} onChange={() => D({ quality: !d.quality })} />
            Écran de confirmation avant envoi (moins de leads, meilleure qualité) <code>is_optimized_for_quality</code>
          </label>
          <div className="leads__bloc">
            <span className="leads__libelle">Pages Facebook qui utilisent ce formulaire</span>
            <div className="leads__puces">
              {boutiques.map((sh) => (
                <button
                  key={sh.id}
                  type="button"
                  className={`filter${d.shops.includes(sh.id) ? ' is-on' : ''}`}
                  disabled={!editable}
                  onClick={() => D({ shops: d.shops.includes(sh.id) ? d.shops.filter((x) => x !== sh.id) : d.shops.concat(sh.id) })}
                >
                  {sh.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Aperçu mobile */}
        <aside className="leads__apercu">
          <div className="seg" role="group" aria-label="Écran de l’aperçu">
            {(
              [
                ['intro', 'Intro'],
                ['form', 'Questions'],
                ['thanks', 'Merci'],
              ] as [Apercu, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" className={pv === k ? 'is-on' : ''} aria-pressed={pv === k} onClick={() => setPv(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="leads__telephone">
            <div className="leads__ecran">
              <div className="leads__page">
                <span className="leads__page-logo">AB</span>
                <span>{pvPage}</span>
              </div>
              {pv === 'intro' ? (
                <>
                  <div className="leads__pv-corps">
                    <span className="leads__pv-titre">{ctx.title}</span>
                    {ctxLines.map((t, i) => (
                      <span key={i} className="leads__pv-ligne">
                        {ctx.style === 'LIST_STYLE' ? <span className="leads__puce">•</span> : null}
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="leads__pv-pied">
                    <span className="leads__pv-bouton">{ctx.button_text}</span>
                  </div>
                </>
              ) : null}
              {pv === 'form' ? (
                <>
                  <div className="leads__pv-corps">
                    <span className="leads__pv-section">Vos coordonnées</span>
                    {pvFields.map((q, i) => (
                      <span key={i} className="leads__pv-champ">
                        <span>{q.label}</span>
                        <span>{q.ph}</span>
                      </span>
                    ))}
                    <span className="leads__pv-mention">
                      En envoyant, vous acceptez la <span className="leads__pv-lien">{privacy.link_text}</span> de L'Atelier By.
                    </span>
                  </div>
                  <div className="leads__pv-pied">
                    <span className="leads__pv-bouton">{d.quality ? 'Vérifier' : 'Envoyer'}</span>
                  </div>
                </>
              ) : null}
              {pv === 'thanks' ? (
                <>
                  <div className="leads__pv-corps leads__pv-merci">
                    <span className="leads__pv-coche">✓</span>
                    <span className="leads__pv-titre">{ty.title}</span>
                    <span className="leads__pv-ligne">{ty.body}</span>
                  </div>
                  <div className="leads__pv-pied">
                    <span className="leads__pv-bouton">{ty.button_text}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      {/* Leads reçus */}
      <section className="card table-card leads__recus">
        <div className="leads__recus-tete">
          <span className="leads__recus-titre">
            <span>Leads reçus · {rowsSrc.length}</span>
            <code>GET /{'{form_id}'}/leads · webhook leadgen · id, created_time, field_data, ad_id, form_id</code>
          </span>
          <div className="leads__actions">
            <select value={leadScope} onChange={(e) => setLeadScope(e.target.value as 'version' | 'family')}>
              <option value="version">Cette version</option>
              <option value="family">Toutes les versions</option>
            </select>
            <button type="button" className="btn btn--sm" onClick={exporter}>
              Exporter CSV
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <div className="leads__grille" style={{ gridTemplateColumns: leadCols }}>
            {leadHead.map((h, i) => (
              <span key={`h${i}`} className="leads__th">
                {h}
              </span>
            ))}
            {leadRows.map((r, i) => r.map((c, j) => <span key={`${i}-${j}`} className="leads__td">{c}</span>))}
          </div>
          {!rowsSrc.length ? <div className="muted leads__vide">Aucun lead pour l'instant.</div> : null}
        </div>
      </section>

      {toast ? <div className="leads__toast">{toast}</div> : null}
    </div>
  )
}
