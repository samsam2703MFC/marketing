import { useCallback, useEffect, useRef, useState } from 'react'
import '../social/social.css'
import '../social/google.css'
import './commentaires.css'
import { commentaireRepondre, commentaires, commentaireTraiter, dateHeure, maintenant, texteErreur, useFranchise } from './_donnees'
import type { Commentaire, Couleur, Totaux, VueCommentaires } from './_donnees'

/**
 * Commentaires — la page « Commentaires » de l'espace franchisé (social/franchisee/Commentaires.dc.html), réécrite
 * dans le Marketing. Les commentaires de la Page de la boutique (et de ses publicités), classés vert / orange / rouge
 * par le réseau dans le contexte de la publication (api/social/src/commentaires.php), relus toutes les heures. La boutique
 * y répond (si le réseau le permet) et les marque traités.
 *
 * Adresse : `?jours=1|7|14|30` (période, 14 par défaut) et `?couleur=rouge|orange|vert` (filtre de départ).
 */

type Jours = 1 | 7 | 14 | 30
type Ton = 'ok' | 'warn' | 'err'
const PERIODES: [Jours, string][] = [
  [1, '24 h'],
  [7, '7 j'],
  [14, '14 j'],
  [30, '30 j'],
]
const C: Record<string, [string, string]> = { rouge: ['is-rouge', 'Rouge'], orange: ['is-orange', 'Orange'], vert: ['is-vert', 'Vert'], '': ['is-classer', 'À classer'] }
const ORDRE: Record<string, number> = { rouge: 0, orange: 1, '': 2, vert: 3 }
const VIDE: Totaux = { rouge: 0, orange: 0, vert: 0, aClasser: 0, rougeOuverts: 0, orangeOuverts: 0, total: 0 }
const pluriel = (n: number | null | undefined) => ((n ?? 0) > 1 ? 's' : '')

function parametresDeDepart() {
  const p = new URLSearchParams(window.location.search)
  const j = Number(p.get('jours'))
  const c = p.get('couleur') ?? ''
  const couleur = (['rouge', 'orange', 'vert'].includes(c) ? c : '') as Couleur
  return { jours: ([1, 7, 14, 30].includes(j) ? j : 14) as Jours, couleur, nonTraites: couleur !== '' && couleur !== 'vert' }
}

export default function CommentairesView() {
  const { etat, erreur } = useFranchise()
  const [depart] = useState(parametresDeDepart)
  const [jours, setJours] = useState<Jours>(depart.jours)
  const [couleur, setCouleur] = useState<Couleur>(depart.couleur)
  const [nonTraites, setNonTraites] = useState(depart.nonTraites)
  const [retard, setRetard] = useState(false)
  const [data, setData] = useState<VueCommentaires | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState<{ t: string; k: Ton } | null>(null)
  const [brouillons, setBrouillons] = useState<Record<string, string>>({})
  const [busyRep, setBusyRep] = useState('')
  const cle = useRef(0)

  const charger = useCallback((j: Jours) => {
    const k = ++cle.current
    setJours(j)
    setLoading(true)
    setErr('')
    commentaires(j)
      .then((r) => {
        if (k !== cle.current) return
        setData(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (k !== cle.current) return
        setLoading(false)
        setErr(texteErreur(e))
      })
  }, [])
  const pret = !!etat
  useEffect(() => {
    if (pret) charger(depart.jours)
  }, [pret, charger, depart.jours])

  if (!etat) return <div className="social-native">{erreur ? <p className="error">{erreur}</p> : <p className="muted">Chargement de l’espace boutique…</p>}</div>

  const regles = etat.rules ?? {}
  const masque = !!data?.hidden || regles.voirCommentaires === false
  const repondreOuvert = regles.repondreCommentaires !== false

  const ouvrirFermer = (c: Commentaire, traite: boolean, autres: Partial<Commentaire> = {}) =>
    setData((d) => {
      if (!d) return d
      const le = maintenant()
      const liste = d.commentaires.map((x) =>
        x.id === c.id ? { ...x, ...autres, traite, traiteLe: traite ? x.traiteLe || le : null, traitePar: traite ? x.traitePar || 'vous' : '' } : x,
      )
      const totaux = { ...d.totaux }
      if (c.traite !== traite) {
        if (c.couleur === 'rouge') totaux.rougeOuverts += traite ? -1 : 1
        if (c.couleur === 'orange') totaux.orangeOuverts += traite ? -1 : 1
      }
      return { ...d, commentaires: liste, totaux }
    })

  const traiter = (c: Commentaire) => {
    commentaireTraiter(c.id, !c.traite)
      .then(() => ouvrirFermer(c, !c.traite, !c.traite ? { traiteLe: maintenant(), traitePar: 'vous' } : {}))
      .catch((e: unknown) => setMsg({ t: `Non enregistré : ${texteErreur(e)}`, k: 'err' }))
  }

  const publier = (c: Commentaire) => {
    const txt = String(brouillons[c.id] ?? c.reponse ?? '').trim()
    if (!txt) {
      setMsg({ t: 'Écrivez une réponse avant de la publier.', k: 'warn' })
      return
    }
    if (busyRep || !window.confirm(`Publier cette réponse sous le commentaire, au nom de la Page ?\n\n« ${txt} »`)) return
    setBusyRep(c.id)
    commentaireRepondre(c.id, txt)
      .then((r) => {
        const le = r?.le || maintenant()
        ouvrirFermer(c, true, { reponseEnvoyee: txt, reponseLe: le, reponsePar: 'vous', enRetard: false })
        setBusyRep('')
        setMsg({ t: 'Réponse publiée sous le commentaire.', k: 'ok' })
      })
      .catch((e: unknown) => {
        setBusyRep('')
        setMsg({ t: `Réponse non publiée : ${texteErreur(e)}`, k: 'err' })
      })
  }

  const copier = (c: Commentaire) => {
    const ok = () => setMsg({ t: 'Réponse copiée : collez-la sous le commentaire sur votre Page (lien « Répondre ↗ »).', k: 'ok' })
    const ko = () => setMsg({ t: 'Copie impossible : sélectionnez le texte à la main.', k: 'warn' })
    try {
      navigator.clipboard.writeText(c.reponse ?? '').then(ok, ko)
    } catch {
      ko()
    }
  }

  const t = data?.totaux ?? VIDE
  const choisirKpi = (k: Couleur) => {
    setCouleur(couleur === k ? '' : k)
    setNonTraites(couleur === k ? nonTraites : k !== 'vert' && k !== '')
  }
  const liste = (data?.commentaires ?? [])
    .filter((c) => (!couleur || c.couleur === couleur) && (!nonTraites || !c.traite) && (!retard || c.enRetard))
    .sort((a, b) => Number(!!a.traite) - Number(!!b.traite) || ORDRE[a.couleur || ''] - ORDRE[b.couleur || ''] || String(b.le).localeCompare(String(a.le)))
  const relu = data?.relu?.le

  return (
    <div className="social-native gg fcom">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">{`Les commentaires de la Page de L’Atelier By ${etat.shop.name} · lus dans le contexte de la publication`}</span>
          <span className="media__spacer" />
          <div className="seg" role="group" aria-label="Période">
            {PERIODES.map(([j, label]) => (
              <button key={j} type="button" className={jours === j ? 'is-on' : ''} aria-pressed={jours === j} onClick={() => charger(j)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {masque ? <div className="card gg__indispo">Le réseau ne partage pas les commentaires dans l’espace boutique.</div> : null}
      {msg ? <div className={`gg__msg is-${msg.k}`}>{msg.t}</div> : null}

      {!masque ? (
        <>
          <div className="gg__kpis">
            {(
              [
                ['rouge', 'À traiter vite', t.rougeOuverts, `${t.rouge} rouge${pluriel(t.rouge)} sur la période`],
                ['orange', 'À répondre', t.orangeOuverts, `${t.orange} orange${pluriel(t.orange)} sur la période`],
                ['vert', 'Positifs ou neutres', t.vert, 'rien de particulier à faire'],
                ['', 'Total', t.total, t.aClasser ? `${t.aClasser} en cours de classement` : 'tous classés'],
              ] as [Couleur, string, number, string][]
            ).map(([k, label, value, sub]) => (
              <button key={label} type="button" className={`gg__kpi ${C[k][0]}${couleur === k && k ? ' is-on' : ''}`} onClick={() => choisirKpi(k)}>
                <span className="gg__kpi-label">
                  <span className="gg__point" />
                  {label}
                </span>
                <span className={`gg__kpi-n${k === 'rouge' && value ? ' is-alerte' : ''}`}>{Number(value || 0).toLocaleString('fr-BE')}</span>
                <span className="muted gg__kpi-sub">{sub}</span>
              </button>
            ))}
            <button
              type="button"
              className={`gg__kpi is-retard${retard ? ' is-on' : ''}`}
              onClick={() => {
                setRetard(!retard)
                setNonTraites(!retard ? true : nonTraites)
              }}
            >
              <span className="gg__kpi-label">
                <span className="gg__point" />
                En retard
              </span>
              <span className={`gg__kpi-n${t.enRetard ? ' is-alerte' : ''}`}>{String(t.enRetard ?? 0)}</span>
              <span className="muted gg__kpi-sub">
                {`au-delà du délai de réponse${t.delaiMedianH != null ? ` · délai médian ${String(t.delaiMedianH).replace('.', ',')} h` : ''}`}
              </span>
            </button>
          </div>

          <div className="filters__row">
            {(
              [
                ['', 'Tous'],
                ['rouge', 'Rouge'],
                ['orange', 'Orange'],
                ['vert', 'Vert'],
              ] as [Couleur, string][]
            ).map(([k, label]) => (
              <button key={label} type="button" className={`filter gg__filtre ${C[k][0]}${couleur === k ? ' is-on' : ''}`} onClick={() => setCouleur(k)}>
                <span className="gg__point" />
                {label}
              </button>
            ))}
            <label className="gg__case">
              <input type="checkbox" checked={nonTraites} onChange={() => setNonTraites(!nonTraites)} />
              Non traités seulement
            </label>
            <span className="muted gg__etat">
              {(relu ? `Relu le ${dateHeure(relu)} · ` : '') +
                'relu par le réseau toutes les heures' +
                (data?.ia?.configure ? ' · classé par Claude' : ' · classé par des règles simples')}
            </span>
          </div>
        </>
      ) : null}

      {loading && !data ? <p className="muted">Lecture des commentaires…</p> : null}
      {err ? <p className="error">{err}</p> : null}

      {data && !masque ? (
        <section className="card table-card gg__table">
          <div className="fcom__grille">
            {['Analyse', 'Commentaire', 'Publication', 'Action conseillée · réponse', 'Suivi'].map((h) => (
              <span key={h} className="gg__th">
                {h}
              </span>
            ))}
            {liste.map((c) => (
              <Ligne
                key={c.id}
                c={c}
                repondreOuvert={repondreOuvert}
                brouillon={String(brouillons[c.id] ?? c.reponse ?? '')}
                setBrouillon={(v) => setBrouillons((b) => ({ ...b, [c.id]: v }))}
                publiant={busyRep === c.id}
                publier={() => publier(c)}
                copier={() => copier(c)}
                traiter={() => traiter(c)}
              />
            ))}
            {!liste.length ? (
              <div className="gg__vide">{t.total ? 'Aucun commentaire pour ce filtre.' : 'Aucun commentaire sur votre Page pendant cette période.'}</div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function Ligne({
  c,
  repondreOuvert,
  brouillon,
  setBrouillon,
  publiant,
  publier,
  copier,
  traiter,
}: {
  c: Commentaire
  repondreOuvert: boolean
  brouillon: string
  setBrouillon: (v: string) => void
  publiant: boolean
  publier: () => void
  copier: () => void
  traiter: () => void
}) {
  const [classe, label] = C[c.couleur || '']
  const fond = c.traite ? ' is-traite' : ''
  const compte = /^(Instagram|Publicité)/.test(c.compte ?? '') ? c.compte : `${c.canal === 'ig' ? 'Instagram · ' : 'Facebook · '}${c.compte ?? ''}`
  const meta = [c.auteur || 'Anonyme', dateHeure(c.le), compte, c.masque ? 'masqué' : ''].filter(Boolean).join(' · ')
  const peutRepondre = !!c.peutRepondre && !c.reponseEnvoyee && c.responsable === 'franchise' && repondreOuvert
  const suggestion = !peutRepondre && !!c.reponse && !c.reponseEnvoyee
  const pub = c.publication ? (c.publication.length > 220 ? `${c.publication.slice(0, 220)}…` : c.publication) : '—'
  return (
    <div className="gg__ligne">
      <span className={`gg__cellule gg__analyse fcom__c1${fond}`}>
        <span className={`gg__couleur ${classe}`}>
          <span className="gg__point" />
          {label}
        </span>
        <span className="gg__sujet">{c.sujet || '—'}</span>
        <span className="gg__source">{c.analyse === 'ia' ? 'analyse Claude' : c.analyse === 'regles' ? 'règles simples' : 'pas encore classé'}</span>
        {c.enRetard ? <span className="gg__retard">{`En retard · ${c.ageH ?? 0} h${c.escalade ? ' · remonté au réseau' : ''}`}</span> : null}
      </span>
      <span className={`gg__cellule${fond}`}>
        <span className="muted gg__meta">{meta}</span>
        <span className="gg__message">{c.message || '(sans texte)'}</span>
        {c.resume ? <span className="muted gg__resume">{c.resume}</span> : null}
      </span>
      <span className={`gg__cellule${fond}`}>
        <span className="fcom__publication">{pub}</span>
        {c.lienPublication ? (
          <a href={c.lienPublication} target="_blank" rel="noopener noreferrer" className="gg__fiche">
            Voir la publication ↗
          </a>
        ) : null}
      </span>
      <span className={`gg__cellule${fond}`}>
        {c.action ? <span className="gg__action">{c.action}</span> : null}
        {peutRepondre ? (
          <>
            <textarea className="gg__brouillon" rows={3} value={brouillon} placeholder="Votre réponse…" onChange={(e) => setBrouillon(e.target.value)} />
            <div className="gg__boutons">
              <button type="button" className={`btn btn--sm gg__publier${publiant ? ' is-busy' : ''}`} onClick={publier}>
                {publiant ? 'Publication…' : 'Publier la réponse'}
              </button>
              <button type="button" className="btn btn--sm" onClick={copier}>
                Copier
              </button>
            </div>
          </>
        ) : null}
        {suggestion ? (
          <>
            <span className="fcom__suggestion">{c.reponse}</span>
            <button type="button" className="btn btn--sm fcom__gauche" onClick={copier}>
              Copier la réponse
            </button>
          </>
        ) : null}
        {c.reponseEnvoyee ? (
          <span className="gg__envoyee">
            {'Réponse publiée' +
              (c.reponseLe ? ` le ${String(c.reponseLe).slice(8, 10)}/${String(c.reponseLe).slice(5, 7)} à ${String(c.reponseLe).slice(11, 16)}` : '') +
              (c.reponsePar ? ` par ${c.reponsePar}` : '') +
              ` : « ${c.reponseEnvoyee} »`}
          </span>
        ) : null}
      </span>
      <span className={`gg__cellule fcom__cz${fond}`}>
        {c.responsable !== 'reseau' ? (
          <label className="gg__case">
            <input type="checkbox" checked={!!c.traite} onChange={traiter} />
            Traité
          </label>
        ) : (
          <span className="muted fcom__reseau">{c.traite ? 'Traité par le réseau' : 'Pris en charge par le réseau'}</span>
        )}
        <span className="gg__source">{c.traite ? `le ${dateHeure(c.traiteLe)}${c.traitePar ? ` · ${c.traitePar}` : ''}` : ''}</span>
        {c.lien ? (
          <a href={c.lien} target="_blank" rel="noopener noreferrer" className="gg__fiche">
            Répondre ↗
          </a>
        ) : null}
      </span>
    </div>
  )
}
