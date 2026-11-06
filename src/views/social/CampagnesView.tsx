import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent, ReactNode, RefObject } from 'react'
import './social.css'
import './campagnes.css'
import { DAYS, addDays, d2, dShort, daysBetween, eur, fmt, pct } from '../../lib/social/format'
import { AD_STATUS, CTYPES, LEVERS, RAG, imageSocial } from '../../lib/social/refs'
import type { TypeOperation } from '../../lib/social/refs'
import { roi } from '../../lib/social/roi'
import { charger, libelleBoutiques, parId, rattacher, useSocial } from '../../lib/social/store'
import type { EtatSocial, Objet, Operation } from '../../lib/social/store'
import { calendriers, planCreer, planOptions, planProposer } from '../../lib/social/api-campagnes'
import type { PlanDemande, PlanOptions, PlanPropose, PostMeta } from '../../lib/social/api-campagnes'
import { avatar, lienSocial } from '../../lib/social/liens'

interface CampagnesViewProps {
  /** Campagne du Marketing à ouvrir (son id ; l'opération du module est `bo-<id>`), sur son plan de posts. */
  operation?: number | null
  /**
   * Suivre un lien vers un autre écran du module dans le rail (`social-post`, `social-ads`…) avec les
   * paramètres de cet écran. Sans elle, le lien change l'adresse (`?ecran=social-…&…`).
   */
  onNaviguer?: (ecran: string, query: string) => void
}

type Onglet = 'all' | 'live' | 'done'
type Reseau = 'fbig' | 'facebook' | 'instagram' | 'story'

interface PlanReglage {
  dur: string
  du: string
  au: string
  on: Record<Reseau, boolean>
  n: Record<Reseau, number>
  mix: string
  remplacer: boolean
}

const NETS: [Reseau, string, string, string, string][] = [
  ['fbig', 'Facebook + Instagram', 'le même post, publié sur les deux', '#EFE9F7', '#4B2E83'],
  ['facebook', 'Facebook seul', 'Page Facebook seulement', '#E7EEF9', '#1F4E9C'],
  ['instagram', 'Instagram seul', 'compte Instagram seulement', '#FBE7F1', '#9C2266'],
  ['story', 'Stories', 'story seule, Facebook et Instagram', '#F6E7CE', '#7A5207'],
]
const net = (k: string) => NETS.find((x) => x[0] === k) ?? NETS[0]
const PLAN_DEPART: PlanReglage = {
  dur: '',
  du: '',
  au: '',
  on: { fbig: true, facebook: false, instagram: false, story: true },
  n: { fbig: 3, facebook: 2, instagram: 2, story: 2 },
  mix: 'equilibre',
  remplacer: true,
}

/** Un post ou une publicité de l'état du module (les champs que l'écran lit). */
interface Piece extends Objet {
  campaign?: string | null
  date?: string
  time?: string
  title?: string
  name?: string
  status?: string
  img?: string | null
  shops?: string[] | 'all'
  marque?: boolean
  dark?: boolean
  origin?: string
  ig?: boolean
  accountName?: string
  permalink?: string
  plan?: unknown
  text?: string
  media?: unknown[]
  spent?: number
  start?: string
  end?: string
}

const texte = (v: unknown) => (v == null ? '' : String(v))

/** Le type d'une opération : le référentiel s'il le connaît, sinon le libellé du Marketing (comme SA.ctype). */
function typeDe(c: Operation): TypeOperation {
  return (
    CTYPES.find((t) => t.id === c.type) ?? {
      id: c.type,
      name: c.typeLabel || 'Opération',
      color: '#666666',
      icon: 'img/illus/decorative/circle-01.png',
      lev: 'trafic',
      kpi: c.goal?.metric || '—',
    }
  )
}

const statutDe = (c: Operation): [string, string, string] =>
  texte(c.boStatusCode) === 'draft'
    ? ['Brouillon', '#EDE7DE', '#7a736a']
    : c.status === 'en cours'
      ? ['En cours', '#E2F0E8', '#0F6B4A']
      : c.status === 'terminée'
        ? ['Terminée', '#EDE7DE', '#5c5852']
        : ['À venir', '#F2C9A0', '#6b4420']

/** L'opération présélectionnée : la prop, sinon `?op=<id>` (campagne du Marketing) ou `?c=bo-…` de l'adresse. */
function operationInitiale(operation: number | null | undefined): { id: string | null; versPlan: boolean } {
  if (operation != null && Number.isInteger(operation) && operation > 0) return { id: `bo-${operation}`, versPlan: true }
  const q = new URLSearchParams(window.location.search)
  const op = q.get('op') ?? ''
  if (/^\d{1,9}$/.test(op)) return { id: `bo-${op}`, versPlan: true }
  return { id: q.get('c'), versPlan: false }
}

/**
 * Opérations — l'écran « Campagnes » du module Social, réécrit dans le Marketing (docs/PORTAILS.md, étape 2f).
 * Les opérations sont les campagnes commerciales du Marketing, lues par l'API du module ; ici on leur
 * prépare un plan de posts, on voit la répartition du budget et la frise, et on y rattache posts et publicités.
 */
export default function CampagnesView({ operation, onNaviguer }: CampagnesViewProps) {
  const { etat, serveur, erreur, chargement } = useSocial()
  const depart = useMemo(() => operationInitiale(operation), [operation])
  const [selId, setSelId] = useState<string | null>(depart.id)
  const [onglet, setOnglet] = useState<Onglet>('all')
  const [refOpen, setRefOpen] = useState(false)
  const [rtTab, setRtTab] = useState<'posts' | 'ads'>('posts')
  const [mpo, setMpo] = useState<{ key: string; loading?: boolean; posts: PostMeta[]; err?: string } | null>(null)
  const [pl, setPlBrut] = useState<PlanReglage>(PLAN_DEPART)
  const [plOpts, setPlOpts] = useState<PlanOptions | null>(null)
  const [plRes, setPlRes] = useState<{ key: string; loading?: boolean; data?: PlanPropose; err?: string } | null>(null)
  const [plBusy, setPlBusy] = useState(false)
  const [plDone, setPlDone] = useState<{ cid: string; crees: number; retires: number; first: string } | null>(null)
  const [plErr, setPlErr] = useState('')
  const versPlan = useRef(depart.versPlan)
  const secPlan = useRef<HTMLDivElement>(null)

  // Ouvert depuis le suivi d'une campagne du Marketing (« Planifier les posts ») : la campagne, et son plan de posts.
  useEffect(() => {
    setSelId(depart.id)
    versPlan.current = depart.versPlan
  }, [depart])

  useEffect(() => {
    planOptions()
      .then(setPlOpts)
      .catch((e: unknown) => setPlOpts({ err: e instanceof Error ? e.message : String(e) }))
  }, [])

  const camps = etat?.campaigns ?? []
  const today = serveur?.today ?? ''
  const c = camps.find((x) => x.id === selId) ?? camps[0]

  const setPl = (patch: Partial<PlanReglage>) => {
    setPlBrut((z) => ({ ...z, ...patch }))
    setPlDone(null)
    setPlErr('')
  }

  // La période du plan : à partir de demain au plus tôt ; « toute la campagne » si le Marketing lui donne une fin.
  const per = useMemo(() => {
    if (!c || !today) return null
    const demain = addDays(today, 1)
    const debut = c.start && c.start > demain ? c.start : demain
    const campOk = !!(c.end && c.end >= debut && daysBetween(debut, c.end) <= 365)
    const dur = pl.dur || (campOk ? 'camp' : '4')
    let du = debut
    let au: string
    if (dur === 'camp') au = campOk ? (c.end as string) : addDays(debut, 27)
    else if (dur === 'dates') {
      du = pl.du && pl.du >= demain ? pl.du : debut
      au = pl.au && pl.au >= du ? pl.au : campOk ? (c.end as string) : addDays(du, 27)
    } else au = addDays(debut, 7 * Number(dur) - 1)
    return { dur, du, au, debut, campOk, demain }
  }, [c, today, pl.dur, pl.du, pl.au])

  const demande: PlanDemande | null = useMemo(() => {
    if (!per) return null
    const rythme: Record<string, number> = {}
    for (const k of Object.keys(pl.on) as Reseau[]) if (pl.on[k]) rythme[k] = pl.n[k]
    return { du: per.du, au: per.au, rythme, mix: pl.mix }
  }, [per, pl.on, pl.n, pl.mix])
  const planKey = demande ? JSON.stringify(demande) : ''

  // Le plan proposé par le serveur, recalculé dès qu'une option change (rien n'est écrit).
  useEffect(() => {
    if (!demande) return
    if (!Object.keys(demande.rythme).length) {
      setPlRes({ key: planKey, err: 'Choisissez au moins un réseau.' })
      return
    }
    let vivant = true
    setPlRes({ key: planKey, loading: true })
    const t = window.setTimeout(() => {
      planProposer(demande)
        .then((r) => vivant && setPlRes({ key: planKey, data: r }))
        .catch((e: unknown) => vivant && setPlRes({ key: planKey, err: `Plan impossible : ${e instanceof Error ? e.message : String(e)}` }))
    }, 250)
    return () => {
      vivant = false
      window.clearTimeout(t)
    }
  }, [planKey])

  // Les publications des Pages (lues chez Meta) sur la période de l'opération affichée, 100 jours au plus.
  const meta = useMemo(() => {
    if (!c || !today) return null
    let au = c.end && c.end < addDays(today, 30) ? c.end : addDays(today, 30)
    let du = c.start || addDays(today, -30)
    if (au < du) au = du
    if (daysBetween(du, au) > 99) du = addDays(au, -99)
    return { key: `${c.id}_${du}_${au}`, du, au }
  }, [c, today])
  useEffect(() => {
    if (!meta) return
    let vivant = true
    setMpo({ key: meta.key, loading: true, posts: [] })
    calendriers(meta.du, meta.au)
      .then((r) => vivant && setMpo({ key: meta.key, posts: r.posts ?? [] }))
      .catch((e: unknown) => vivant && setMpo({ key: meta.key, posts: [], err: e instanceof Error ? e.message : 'erreur' }))
    return () => {
      vivant = false
    }
  }, [meta])

  // Ouvert sur une campagne : on descend jusqu'au plan de posts une fois la fiche affichée.
  useEffect(() => {
    if (versPlan.current && c && secPlan.current) {
      versPlan.current = false
      const el = secPlan.current
      window.setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50)
    }
  }, [c])

  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>

  const aller = (page: string, query = '') => ({
    href: lienSocial(page, query),
    onClick: onNaviguer
      ? (e: MouseEvent) => {
          e.preventDefault()
          onNaviguer(`social-${page}`, query)
        }
      : undefined,
  })

  const posts = etat.posts as Piece[]
  const ads = etat.ads as Piece[]
  const spentOf = (cid: string) => ads.filter((a) => a.campaign === cid).reduce((s, x) => s + (Number(x.spent) || 0), 0)
  const resultat = (cid: string) => (serveur.results?.[cid] ? roi(etat, serveur, cid) : null)
  const nomBoutique = (id: string) => parId(etat.shops, id)?.name ?? id
  const opsLien = serveur.operations?.lien || '/marketing/?nouvelle=1'
  const opsErr = serveur.operations?.erreur || ''

  const onglets: [Onglet, string, Operation[]][] = [
    ['all', 'Toutes', camps],
    ['live', 'En cours', camps.filter((x) => x.status !== 'terminée')],
    ['done', 'Terminées', camps.filter((x) => x.status === 'terminée')],
  ]
  const affichees = (onglets.find((t) => t[0] === onglet) ?? onglets[0])[2]

  return (
    <div className="social-native camp">
      <div className="filters">
        <div className="filters__row">
          <span className="muted social-native__periode">Campagnes commerciales du Marketing · posts et publicités rattachés</span>
          <span className="media__spacer" />
          <a
            className="btn"
            {...aller('ads', 'src=meta&importer=1')}
            title="Relit chez Meta les campagnes de vos comptes publicitaires (Gestionnaire de publicités, agence…) ; elles arrivent dans Publicités, où vous pouvez les rattacher à une opération."
          >
            Récupérer les campagnes Meta
          </a>
          <button type="button" className="btn" aria-pressed={refOpen} onClick={() => setRefOpen(!refOpen)}>
            Référentiel des types
          </button>
          <a className="btn" href={opsLien} title="Les campagnes se créent dans le Marketing (assistant de campagne) ; elles apparaissent ici d'elles-mêmes.">
            Créer dans le Marketing →
          </a>
        </div>
      </div>

      <p className="camp__note">
        Les opérations sont les campagnes commerciales du Marketing, lues en direct par son API ({camps.length} opération{camps.length > 1 ? 's' : ''}) :
        nom, dates, boutiques, produits de l’offre, objectif et budget se modifient là-bas. Ici, on y rattache les posts et les publicités Meta, et
        on en suit le retour.
      </p>
      {opsErr && <p className="camp__alerte">{opsErr} — Paramètres → adresse de l’API Marketing.</p>}

      {refOpen && (
        <section className="card camp__ref">
          <div className="camp__ref-grille">
            {['', 'Type', 'Levier', 'KPI attendu', 'Durée'].map((h, i) => (
              <span key={i} className="camp__th">
                {h}
              </span>
            ))}
            {CTYPES.map((t) => (
              <RefLigne key={t.id} t={t} />
            ))}
          </div>
        </section>
      )}

      <div className="camp__corps">
        <aside className="camp__liste">
          <div className="seg" role="tablist">
            {onglets.map(([k, label, arr]) => (
              <button key={k} type="button" className={onglet === k ? 'is-on' : ''} onClick={() => setOnglet(k)}>
                {label} · {arr.length}
              </button>
            ))}
          </div>
          {affichees.map((x) => {
            const t = typeDe(x)
            const [stL, stB, stF] = statutDe(x)
            const sp = spentOf(x.id)
            const r = resultat(x.id)
            const rag = r ? RAG[r.total.rag] : { label: 'Pas encore de résultats', fg: '#7a736a', bar: '#B8B2A8' }
            const budget = Number(x.budget) || 0
            return (
              <button key={x.id} type="button" className={`camp__op${c && x.id === c.id ? ' is-on' : ''}`} onClick={() => setSelId(x.id)}>
                <span className="camp__op-tete">
                  <span className="camp__icone" style={{ background: `${t.color}22` }}>
                    <img src={imageSocial(t.icon)} alt="" />
                  </span>
                  <span className="camp__op-nom">
                    <span>{x.name}</span>
                    <span className="muted">
                      {t.name} ·{' '}
                      {x.start ? `${dShort(x.start)}${x.end ? ` → ${dShort(x.end)}` : ' → sans fin'}` : 'dates à fixer dans le BO'}
                    </span>
                  </span>
                  <span className="camp__tag" style={{ background: stB, color: stF }}>
                    {stL}
                  </span>
                </span>
                <span className="camp__budget">
                  <span className="camp__budget-tete">
                    <span>Budget dépensé</span>
                    <span>
                      {eur(sp)} / {eur(x.budget)}
                    </span>
                  </span>
                  <span className="camp__jauge">
                    <span style={{ width: `${Math.min(100, budget ? (sp / budget) * 100 : 0)}%` }} />
                  </span>
                </span>
                <span className="camp__rag" style={{ color: rag.fg || rag.bar }}>
                  <span className="camp__point" style={{ background: rag.bar }} />
                  {r ? `${rag.label} · ${pct(r.total.att)}${x.status === 'en cours' ? ' (au prorata)' : ''}` : rag.label}
                </span>
              </button>
            )
          })}
        </aside>

        {c ? (
          <Fiche
            key={c.id}
            c={c}
            etat={etat}
            today={today}
            posts={posts}
            ads={ads}
            spent={spentOf(c.id)}
            r={resultat(c.id)}
            nomBoutique={nomBoutique}
            mpo={mpo && mpo.key.startsWith(`${c.id}_`) ? mpo : { key: '', loading: true, posts: [] }}
            setMpo={setMpo}
            rtTab={rtTab}
            setRtTab={setRtTab}
            aller={aller}
            opsLien={opsLien}
            plan={
              <Plan
                refSection={secPlan}
                c={c}
                per={per}
                pl={pl}
                setPl={setPl}
                opts={plOpts}
                res={plRes && plRes.key === planKey ? plRes : { key: planKey, loading: true }}
                busy={plBusy}
                done={plDone && plDone.cid === c.id ? plDone : null}
                err={plErr}
                vides={
                  posts.filter(
                    (x) => x.campaign === c.id && x.plan && x.status === 'Brouillon' && !texte(x.text).trim() && !(x.media ?? []).length && !x.img,
                  ).length
                }
                creer={(n, vides, premier) => {
                  if (plBusy || !n || !demande) return
                  setPlBusy(true)
                  setPlErr('')
                  planCreer({ ...demande, campagne: c.id, remplacer: !!(vides && pl.remplacer) })
                    .then((r) => {
                      setPlBusy(false)
                      setPlDone({ cid: c.id, crees: r.crees, retires: r.retires, first: premier })
                      return charger()
                    })
                    .catch((e: unknown) => {
                      setPlBusy(false)
                      setPlErr(`Ajout impossible : ${e instanceof Error ? e.message : String(e)}`)
                    })
                }}
                aller={aller}
              />
            }
          />
        ) : (
          <section className="camp__fiche">
            <p className="muted">Aucune opération.</p>
          </section>
        )}
      </div>
    </div>
  )
}

function RefLigne({ t }: { t: TypeOperation }) {
  const lev = LEVERS[t.lev] ?? LEVERS.trafic
  return (
    <>
      <span className="camp__td">
        <span className="camp__icone camp__icone--petite" style={{ background: `${t.color}22` }}>
          <img src={imageSocial(t.icon)} alt="" />
        </span>
      </span>
      <span className="camp__td">
        <span className="camp__carre" style={{ background: t.color }} />
        {t.name}
      </span>
      <span className="camp__td">
        <Levier nom={lev.name} couleur={lev.color} />
      </span>
      <span className="camp__td camp__td--sec">{t.kpi}</span>
      <span className="camp__td camp__td--sec muted">{t.continuous ? 'Continue' : 'Datée'}</span>
    </>
  )
}

function Levier({ nom, couleur }: { nom: string; couleur: string }) {
  return (
    <span className="camp__levier">
      <span className="camp__point" style={{ background: couleur }} />
      {nom}
    </span>
  )
}

type Aller = (page: string, query?: string) => { href: string; onClick?: (e: MouseEvent) => void }

interface FicheProps {
  c: Operation
  etat: EtatSocial
  today: string
  posts: Piece[]
  ads: Piece[]
  spent: number
  r: ReturnType<typeof roi>
  nomBoutique: (id: string) => string
  mpo: { key: string; loading?: boolean; posts: PostMeta[]; err?: string }
  setMpo: (f: (z: { key: string; loading?: boolean; posts: PostMeta[]; err?: string } | null) => { key: string; loading?: boolean; posts: PostMeta[]; err?: string } | null) => void
  rtTab: 'posts' | 'ads'
  setRtTab: (t: 'posts' | 'ads') => void
  aller: Aller
  plan: ReactNode
  opsLien: string
}

function Fiche({ c, etat, today, posts, ads, spent, r, nomBoutique, mpo, setMpo, rtTab, setRtTab, aller, plan, opsLien }: FicheProps) {
  const t = typeDe(c)
  const lev = LEVERS[t.lev] ?? LEVERS.trafic
  const split0 = c.split ?? {}
  const budget = Number(c.budget) || 0
  const goal = c.goal as { metric?: string; value?: number; unit?: string } | undefined

  // Répartition du budget par boutique (celle du Marketing) et ce qui est dépensé.
  const top = Math.max(...c.shops.map((k) => split0[k] || 0), 1)
  const split = c.shops.map((id) => {
    const v = split0[id] || 0
    const sp = r ? Number(r.perShop.find((x) => x.sid === id)?.spend) || 0 : 0
    return { id, name: nomBoutique(id), v, pct: Math.min(100, (v / top) * 100), spentPct: Math.min(100, (sp / top) * 100), sp }
  })
  const allocated = c.shops.reduce((a, id) => a + (split0[id] || 0), 0)
  const left = budget - allocated

  // Frise.
  const start = c.start || today
  const end = c.end || addDays(start, 30)
  const span = Math.max(1, daysBetween(start, end))
  const X = (d: string) => `${Math.max(0, Math.min(100, (daysBetween(start, d) / span) * 100))}%`
  const ticks: { x: string; label: string }[] = []
  const step = Math.max(1, Math.round(span / 5))
  for (let i = 0; i <= span; i += step) ticks.push({ x: X(addDays(start, i)), label: dShort(addDays(start, i)) })
  const postsFrise = (posts.filter((p) => p.campaign === c.id) as (Piece | PostMeta)[])
    .concat(mpo.posts.filter((p) => p.campaign === c.id).map((p) => ({ ...p, href: p.permalink })))
    .sort((a, b) => texte(a.date).localeCompare(texte(b.date)))
  const adsOp = ads.filter((a) => a.campaign === c.id)
  const goalNow = r ? r.total : null

  // Rattacher : les posts de la période (du module, et publiés sur les Pages, lus chez Meta) et les publicités.
  const nameOf = (id: string) => parId(etat.campaigns, id)?.name ?? id
  const inShops = (p: Piece | PostMeta) => {
    const s = p.shops
    if (p.marque || !s || s === 'all' || !s.length) return true
    return s.some((x) => c.shops.includes(x))
  }
  const pStart = c.start || '0000'
  const pEnd = c.end || '9999'
  const tag = (cur: string | null | undefined): [string, string, string] =>
    cur === c.id ? ['Rattaché', '#E2F0E8', '#0F6B4A'] : cur ? [`dans « ${nameOf(cur)} »`, '#F6E7CE', '#7A5207'] : ['libre', '#EDE7DE', '#7a736a']
  const basculer = (genre: 'post' | 'ad', x: Piece | PostMeta) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.checked ? c.id : null
    rattacher(genre, x.id, v)
      .then(() => {
        if (genre === 'post' && x.origin === 'meta')
          setMpo((z) => (z ? { ...z, posts: z.posts.map((y) => (y.id === x.id ? { ...y, campaign: v } : y)) } : z))
      })
      .catch((err: unknown) => window.alert(`Rattachement impossible : ${err instanceof Error ? err.message : String(err)}`))
  }
  const ligne = (genre: 'post' | 'ad', x: Piece | PostMeta, titre: string, sous: string, img: string) => {
    const [t0, tb, tf] = tag(x.campaign as string | null | undefined)
    const on = x.campaign === c.id
    return (
      <label key={`${genre}-${x.id}`} className={`camp__rt${on ? ' is-on' : ''}`}>
        <input type="checkbox" checked={on} onChange={basculer(genre, x)} />
        <img src={img} alt="" className="camp__rt-img" />
        <span className="camp__rt-texte">
          <span>{titre}</span>
          <span className="muted">{sous}</span>
        </span>
        <span className="camp__tag" style={{ background: tb, color: tf }}>
          {t0}
        </span>
      </label>
    )
  }
  const cand = (posts.filter((p) => (!p.dark && texte(p.date) >= pStart && texte(p.date) <= pEnd && inShops(p)) || p.campaign === c.id) as (Piece | PostMeta)[])
    .concat(mpo.posts.filter((p) => (p.status === 'Publié' && p.date >= pStart && p.date <= pEnd && inShops(p)) || p.campaign === c.id))
    .sort((a, b) => (texte(b.date) + texte(b.time)).localeCompare(texte(a.date) + texte(a.time)))
  const postRows = cand.map((p) => ({
    on: p.campaign === c.id,
    el: ligne(
      'post',
      p,
      texte(p.title),
      `${dShort(texte(p.date))}${p.time ? ` ${p.time}` : ''} · ${
        p.origin === 'meta'
          ? `${p.accountName || ''} · ${p.ig ? 'publié sur Instagram' : 'publié sur la Page Facebook'}`
          : `${libelleBoutiques(etat, p.shops as string[] | 'all' | undefined)} · ${p.status} (module)`
      }`,
      (p.img ? imageSocial(texte(p.img)) : '') || avatar(texte(p.accountName) || texte(p.title), p.ig ? 'instagram' : 'facebook'),
    ),
  }))
  const adRows = ads
    .filter((a) => a.campaign === c.id || ((a.start || '0000') <= pEnd && (a.end || a.start || '9999') >= pStart))
    .map((a) => ({
      on: a.campaign === c.id,
      el: ligne(
        'ad',
        a,
        texte(a.name),
        `${a.origin === 'meta' ? 'Campagne Meta · ' : 'Publicité du module · '}${a.status} · ${eur(Number(a.spent) || 0)} dépensés${
          a.start ? ` · ${dShort(a.start)}${a.end ? ` → ${dShort(a.end)}` : ''}` : ''
        }`,
        imageSocial('img/illus/customer-facing/webshop.png'),
      ),
    }))
  const rows = rtTab === 'ads' ? adRows : postRows

  const lienMarketing = c.lien || opsLien
  const faits = [
    {
      label: 'Période',
      value: c.start ? `${dShort(c.start)}${c.end ? ` → ${dShort(c.end)}` : ''}` : '—',
      sub: !c.start ? 'à fixer dans le BO' : c.end ? `${daysBetween(c.start, c.end) + 1} jours` : 'Continue',
      cls: '',
    },
    {
      label: 'Objectif',
      value: !goal ? '—' : goal.unit === 'EUR' || goal.metric === 'CA additionnel' ? eur(goal.value) : fmt(goal.value),
      sub: goal ? texte(goal.metric) : 'aucun levier chiffré dans le BO',
      cls: '',
    },
    {
      label: 'Réalisé (estimé)',
      value: goalNow ? eur(goalNow.caAdd) : '—',
      sub: goalNow ? `${pct(goalNow.att)} de l’objectif${c.status === 'en cours' ? ' au prorata' : ''}` : 'Pas encore de données',
      color: goalNow ? RAG[goalNow.rag].fg : '#7a736a',
    },
    { label: 'Budget total', value: eur(c.budget), sub: `${eur(spent)} dépensés · ${pct(budget ? spent / budget : 0)}`, cls: '' },
    {
      label: 'ROAS',
      value: goalNow && goalNow.roas != null ? `${fmt(goalNow.roas, 1)} ×` : '—',
      sub: 'CA additionnel / dépense',
      color: goalNow ? (goalNow.roas != null && goalNow.roas >= 3 ? '#0F6B4A' : goalNow.roas != null && goalNow.roas >= 1.6 ? '#7A5207' : '#8D1D2C') : '#7a736a',
    },
  ]

  return (
    <section className="camp__fiche">
      <div className="card camp__entete">
        <div className="camp__entete-haut">
          <div className="camp__titre">
            <span className="camp__icone camp__icone--grande" style={{ background: `${t.color}22` }}>
              <img src={imageSocial(t.icon)} alt="" />
            </span>
            <div className="camp__titre-texte">
              <span className="camp__nom">{c.name}</span>
              <span className="camp__badges">
                <span className="camp__tag" style={{ background: t.color, color: '#fff' }}>
                  {t.name}
                </span>
                <Levier nom={lev.name} couleur={lev.color} />
                <span className="muted">KPI attendu : {t.kpi}</span>
                <span className="camp__tag">Marketing · {texte(c.boStatus) || '—'}</span>
              </span>
            </div>
          </div>
          <div className="camp__actions">
            <a className="btn btn--sm" {...aller('post')}>
              + Post
            </a>
            <a className="btn btn--sm" {...aller('ads', `new=1&c=${encodeURIComponent(c.id)}`)}>
              + Publicité
            </a>
            <a className="btn btn--sm" href={lienMarketing} title="La campagne dans le Marketing : son suivi, son assistant">
              Voir dans le Marketing →
            </a>
            <a className="btn btn--sm" {...aller('roi', `c=${encodeURIComponent(c.id)}`)}>
              Retour sur opération →
            </a>
          </div>
        </div>
        <div className="camp__faits">
          {faits.map((k) => (
            <div key={k.label} className="camp__fait">
              <span className="camp__fait-label">{k.label}</span>
              <span className="camp__fait-valeur" style={k.color ? { color: k.color } : undefined}>
                {k.value}
              </span>
              <span className="muted">{k.sub}</span>
            </div>
          ))}
        </div>
        <div className="camp__deux">
          <div>
            <span className="camp__label">Boutiques concernées · {c.shops.length}</span>
            <div className="camp__puces">
              {c.shops.map((id) => (
                <span key={id} className="camp__tag">
                  {nomBoutique(id)}
                </span>
              ))}
            </div>
          </div>
          <div>
            <span className="camp__label">Produits et gammes</span>
            <div className="camp__puces">
              {((c.products ?? []).length ? (c.products as string[]) : ['aucun produit dans l’offre du BO']).map((p) => (
                <span key={p} className="camp__tag camp__tag--produit">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {plan}

      <div className="card camp__bloc">
        <div className="camp__bloc-tete">
          <span>Répartition du budget par boutique</span>
          <span style={{ color: !allocated ? '#7a736a' : left === 0 ? '#0F6B4A' : left > 0 ? '#7A5207' : '#8D1D2C' }}>
            {!allocated
              ? 'Pas de budget par boutique dans le BO'
              : left === 0
                ? `Budget entièrement réparti · ${eur(allocated)}`
                : left > 0
                  ? `${eur(left)} non réparti (BO)`
                  : `Dépassement de ${eur(-left)} sur le budget total (BO)`}
          </span>
        </div>
        {split.map((b) => (
          <div key={b.id} className="camp__split">
            <span>{b.name}</span>
            <span className="camp__piste">
              <span className="camp__alloue" style={{ width: `${b.pct}%` }} />
              <span className="camp__depense" style={{ width: `${b.spentPct}%` }} />
            </span>
            <span className="num">{b.v ? eur(b.v) : '—'}</span>
            <span className="num muted">{eur(b.sp)} dépensés</span>
          </div>
        ))}
        <span className="camp__legende">
          <span>
            <span className="camp__carre camp__depense" />
            Dépensé
          </span>
          <span>
            <span className="camp__carre camp__alloue" />
            Alloué
          </span>
        </span>
      </div>

      <div className="card camp__bloc">
        <div className="camp__bloc-tete">
          <span>Vue chronologique</span>
          <span className="muted">
            {postsFrise.length} posts · {adsOp.length} publicités
          </span>
        </div>
        <div className="camp__frise">
          <div className="camp__frise-axe">
            {ticks.map((tk, i) => (
              <span key={i} style={{ left: tk.x }}>
                {tk.label}
              </span>
            ))}
          </div>
          <div className="camp__frise-corps">
            {today >= start && today <= end && (
              <span className="camp__aujourdhui" style={{ left: X(today) }}>
                <span>Aujourd'hui</span>
              </span>
            )}
            <div className="camp__frise-posts">
              <span className="camp__frise-titre">Posts organiques</span>
              {postsFrise.map((p, i) => {
                const st = texte(p.status)
                const lien = (p as { href?: string }).href
                const ring = st === 'Publié' ? '#3f7a52' : st === 'Programmé' ? '#B0792A' : st === 'Échec' ? '#8D1D2C' : '#B8B2A8'
                const props = lien ? { href: lien, target: '_blank', rel: 'noreferrer' } : aller('post', `id=${encodeURIComponent(p.id)}`)
                return (
                  <a
                    key={p.id}
                    {...props}
                    className="camp__marque"
                    title={`${dShort(texte(p.date))} · ${texte(p.title)} · ${st}`}
                    style={{ left: X(texte(p.date)), top: `${i % 2 ? 30 : 4}px`, borderColor: ring }}
                  >
                    <img src={(p.img ? imageSocial(texte(p.img)) : '') || avatar(texte(p.accountName) || texte(p.title), p.ig ? 'instagram' : 'facebook')} alt="" />
                  </a>
                )
              })}
            </div>
            <div className="camp__frise-ads" style={{ minHeight: `${Math.max(44, adsOp.length * 28 + 16)}px` }}>
              <span className="camp__frise-titre camp__frise-titre--ads">Publicités</span>
              {adsOp.map((a, i) => {
                const sc = AD_STATUS[texte(a.status)] ?? AD_STATUS.Active
                const x0 = (daysBetween(start, texte(a.start) || start) / span) * 100
                const x1 = (daysBetween(start, a.end || end) / span) * 100
                const actif = a.status === 'Active'
                return (
                  <a
                    key={a.id}
                    {...aller('ads', `ad=${encodeURIComponent(a.id)}`)}
                    className="camp__barre"
                    title={`${texte(a.name)} — ${eur(Number(a.spent) || 0)} dépensés`}
                    style={{
                      left: `${Math.max(0, x0)}%`,
                      width: `${Math.max(4, Math.min(100, x1) - Math.max(0, x0))}%`,
                      top: `${8 + i * 28}px`,
                      background: actif ? '#8D1D2C' : sc.bg,
                      color: actif ? '#fff' : sc.fg,
                    }}
                  >
                    {texte(a.name)} · {texte(a.status)}
                  </a>
                )
              })}
              {adsOp.length === 0 && <span className="muted camp__frise-vide">Aucune publicité rattachée.</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="card camp__bloc">
        <div className="camp__bloc-tete">
          <span>Rattacher des posts et des publicités</span>
          <div className="seg">
            <button type="button" className={rtTab === 'posts' ? 'is-on' : ''} onClick={() => setRtTab('posts')}>
              Posts · {postRows.filter((x) => x.on).length}/{postRows.length}
            </button>
            <button type="button" className={rtTab === 'ads' ? 'is-on' : ''} onClick={() => setRtTab('ads')}>
              Publicités · {adRows.filter((x) => x.on).length}/{adRows.length}
            </button>
          </div>
        </div>
        <span className="muted camp__aide">
          {rtTab === 'ads'
            ? 'Publicités du module et campagnes récupérées chez Meta qui tournent pendant l’opération : rattachées, leur dépense et leurs résultats comptent dans le Retour sur opération.'
            : 'Posts du module et publications déjà en ligne sur les Pages (lues chez Meta) pendant l’opération, dans ses boutiques. Cochez pour les rattacher à cette campagne du Marketing.'}
        </span>
        {rtTab === 'posts' && mpo.loading && <span className="muted">Lecture des publications des Pages chez Meta…</span>}
        {rtTab === 'posts' && mpo.err && <span className="error">Publications des Pages illisibles : {mpo.err}</span>}
        {!rows.length && !(rtTab === 'posts' && mpo.loading) && (
          <span className="muted">{rtTab === 'ads' ? 'Aucune publicité pendant la période.' : 'Aucun post pendant la période.'}</span>
        )}
        <div className="camp__rt-liste">{rows.map((x) => x.el)}</div>
      </div>
    </section>
  )
}

interface PlanProps {
  refSection: RefObject<HTMLDivElement | null>
  c: Operation
  per: { dur: string; du: string; au: string; debut: string; campOk: boolean; demain: string } | null
  pl: PlanReglage
  setPl: (p: Partial<PlanReglage>) => void
  opts: PlanOptions | null
  res: { key: string; loading?: boolean; data?: PlanPropose; err?: string }
  busy: boolean
  done: { cid: string; crees: number; retires: number; first: string } | null
  err: string
  vides: number
  creer: (n: number, vides: number, premier: string) => void
  aller: Aller
}

/** Plan de posts : durée, réseaux et rythme, mix → liste aux meilleurs jours et heure → brouillons au calendrier. */
function Plan({ refSection, c, per, pl, setPl, opts, res, busy, done, err: plErr, vides, creer, aller }: PlanProps) {
  if (!per) return null
  const o = opts ?? {}
  const sem = (a: string, b: string) => Math.ceil((daysBetween(a, b) + 1) / 7)
  const durs = [
    {
      v: 'camp',
      l: per.campOk
        ? `Toute la campagne · ${dShort(per.debut)} → ${dShort(c.end)} (${sem(per.debut, c.end as string)} sem.)`
        : 'Toute la campagne (sans fin dans le BO : 4 semaines)',
    },
    ...[1, 2, 3, 4, 6, 8].map((n) => ({ v: String(n), l: `${n}${n > 1 ? ' semaines' : ' semaine'} à partir du ${dShort(per.debut)}` })),
    { v: 'dates', l: 'Dates choisies…' },
  ]
  const mixes = o.mix ? Object.keys(o.mix).map((k) => ({ v: k, l: o.mix![k].libelle })) : [{ v: pl.mix, l: 'Chargement des mix…' }]
  const compo = o.mix && o.mix[pl.mix] ? o.mix[pl.mix].composition.map((x) => `${x.sujet} · ${x.part} %`) : []
  const d = res.data
  const posts = d ? d.posts : []
  const lundi = (x: string) => addDays(x, -((d2(x).getDay() + 6) % 7))
  const parReseau = d
    ? Object.keys(d.resume.parReseau)
        .map((k) => {
          const n = d.resume.parReseau[k]
          return `${n} ${k === 'story' ? (n > 1 ? 'stories' : 'story') : net(k)[1]}`
        })
        .join(' · ')
    : ''
  const jours =
    d && d.creneaux.jours.some((j) => j.indice !== 1)
      ? d.creneaux.jours.map((j) => ({
          t: `${j.jour.slice(0, 3)}. ×${fmt(j.indice, 1)}`,
          cls: j.indice >= 1.1 ? 'is-fort' : j.indice <= 0.9 ? 'is-faible' : '',
        }))
      : [{ t: 'répartis sur la semaine', cls: '' }]
  const n = posts.length
  const err = plErr || res.err || (o.err && !d ? `Plan indisponible : ${o.err}` : '')
  const remplLabel = `Remplacer les ${vides} brouillon${vides > 1 ? 's' : ''} encore vide${vides > 1 ? 's' : ''} du plan précédent`
  const doneLabel = done
    ? `${done.crees} brouillon${done.crees > 1 ? 's' : ''} ajouté${done.crees > 1 ? 's' : ''} au calendrier${
        done.retires
          ? ` · ${done.retires} brouillon${done.retires > 1 ? 's' : ''} vide${done.retires > 1 ? 's' : ''} du plan précédent retiré${done.retires > 1 ? 's' : ''}`
          : ''
      }.`
    : ''

  return (
    <div ref={refSection} id="sec-plan" className="card camp__bloc">
      <div className="camp__bloc-tete">
        <span className="camp__plan-titre">
          <span>Plan de posts de la campagne</span>
          <span className="muted">
            Choisissez la durée, les réseaux et le mix : la liste des posts se place aux meilleurs jours et à la meilleure heure de vos publications,
            puis s’ajoute au calendrier en brouillons rattachés à la campagne.
          </span>
        </span>
        <span className="camp__tag">
          {dShort(per.du)} → {dShort(per.au)} · {sem(per.du, per.au)} sem.
        </span>
      </div>
      <div className="camp__plan-reglages">
        <div className="camp__champ">
          <span className="camp__label">Durée</span>
          <select
            value={per.dur}
            onChange={(e) => {
              const v = e.target.value
              setPl(v === 'dates' ? { dur: v, du: per.du, au: per.au } : { dur: v })
            }}
          >
            {durs.map((x) => (
              <option key={x.v} value={x.v}>
                {x.l}
              </option>
            ))}
          </select>
          {per.dur === 'dates' && (
            <span className="camp__dates">
              du{' '}
              <input type="date" value={per.du} min={per.demain} onChange={(e) => e.target.value && setPl({ dur: 'dates', du: e.target.value })} />
              au <input type="date" value={per.au} min={per.du} onChange={(e) => e.target.value && setPl({ dur: 'dates', au: e.target.value })} />
            </span>
          )}
        </div>
        <div className="camp__champ">
          <span className="camp__label">Mix de posts</span>
          <select value={pl.mix} onChange={(e) => setPl({ mix: e.target.value })}>
            {mixes.map((x) => (
              <option key={x.v} value={x.v}>
                {x.l}
              </option>
            ))}
          </select>
          <span className="camp__puces">
            {compo.map((k) => (
              <span key={k} className="camp__tag camp__tag--produit">
                {k}
              </span>
            ))}
          </span>
        </div>
      </div>
      <div className="camp__champ">
        <span className="camp__label">Réseaux et rythme</span>
        <div className="camp__reseaux">
          {NETS.map(([k, label, sub]) => (
            <label key={k} className={`camp__reseau${pl.on[k] ? ' is-on' : ''}`}>
              <input type="checkbox" checked={!!pl.on[k]} onChange={(e) => setPl({ on: { ...pl.on, [k]: e.target.checked } })} />
              <span className="camp__reseau-texte">
                <span>{label}</span>
                <span className="muted">{sub}</span>
              </span>
              <select value={String(pl.n[k])} onChange={(e) => setPl({ n: { ...pl.n, [k]: Number(e.target.value) }, on: { ...pl.on, [k]: true } })}>
                {[1, 2, 3, 4, 5, 6, 7].map((x) => (
                  <option key={x} value={String(x)}>
                    {x} / sem.
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      {!!res.loading && !err && <span className="muted">Calcul du plan…</span>}
      {!!err && <span className="error">{err}</span>}
      {d && n > 0 && (
        <div className="camp__plan-res">
          <div className="camp__plan-resume">
            <span className="camp__plan-titre">
              <span>
                {n} posts sur {d.resume.semaines} semaine{d.resume.semaines > 1 ? 's' : ''}
                {parReseau ? ` : ${parReseau}` : ''}
              </span>
              <span className="muted">
                Heure : {d.creneaux.heure}
                {d.creneaux.creneau ? ` (${d.creneaux.creneau.toLowerCase()})` : ''} — {d.creneaux.source}
              </span>
            </span>
            <span className="camp__puces">
              <span className="muted">Meilleurs jours :</span>
              {jours.map((j) => (
                <span key={j.t} className={`camp__tag camp__jour ${j.cls}`}>
                  {j.t}
                </span>
              ))}
            </span>
          </div>
          <div className="camp__plan-table">
            <table className="table">
              <thead>
                <tr>
                  {['Date', 'Heure', 'Réseau', 'Format', 'Sujet', 'Type de post', 'Pourquoi ce jour'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {posts.map((x, i) => {
                  const [, lab, , bg, fg] = net(x.reseau)
                  const semaine = i > 0 && lundi(x.date) !== lundi(posts[i - 1].date)
                  return (
                    <tr key={`${x.date}-${i}`} className={semaine ? 'is-semaine' : ''}>
                      <td className="camp__nowrap">
                        {DAYS[d2(x.date).getDay()]} {dShort(x.date)}
                      </td>
                      <td>{x.heure}</td>
                      <td>
                        <span className="camp__tag" style={{ background: bg, color: fg }}>
                          {lab}
                        </span>
                      </td>
                      <td className="camp__td--sec">{x.format}</td>
                      <td>{x.sujetLibelle}</td>
                      <td className="camp__td--sec">{x.type}</td>
                      <td className="muted">{x.raison}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="camp__plan-pied">
            {vides ? (
              <label className="camp__case">
                <input type="checkbox" checked={pl.remplacer} onChange={(e) => setPl({ remplacer: e.target.checked })} />
                {remplLabel}
              </label>
            ) : (
              <span className="muted">Les brouillons ne partent pas : on les complète (visuel, texte) et on les programme depuis le calendrier.</span>
            )}
            <button type="button" className={`btn btn--primary${busy ? ' is-busy' : ''}`} disabled={busy || !n} onClick={() => creer(n, vides, posts[0].date)}>
              {busy ? 'Ajout au calendrier…' : `Ajouter ${n} brouillon${n > 1 ? 's' : ''} au calendrier`}
            </button>
          </div>
        </div>
      )}
      {done && (
        <div className="camp__fait-ok">
          <span>{doneLabel}</span>
          <a {...aller('cal', `operation=${encodeURIComponent(c.id)}&date=${done.first}`)}>Voir dans le calendrier →</a>
        </div>
      )}
    </div>
  )
}
