import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import '../social/social.css'
import '../social/grille.css'
import './calendrier-franchise.css'
import {
  DAYS,
  MONTHS,
  STATUS,
  addDays,
  annulerPost,
  at,
  d2,
  dLabel,
  dShort,
  iso,
  langues,
  lienFranchise,
  media,
  remplir,
  relire,
  useFranchise,
} from '../../lib/franchise/store'
import type { EtatFranchise, PostFranchise } from '../../lib/franchise/store'
import { lireBoosts, lireCalendrier, lireChiffresPublication, lireMaSemaine, lireReposts, lireSuivi, lireVues, proposerBoost, repondreRepost } from '../../lib/franchise/api'
import { Barres, C, Courbe, court, fmtG as fmt, incomplets, lg, plages, signe } from '../social/GrilleGraphes'
import type { Survol } from '../social/GrilleGraphes'

export interface CalendrierFranchiseViewProps {
  /** « Publier un post », « + » d'un jour, « Refaire avec ce modèle » : l'écran Créer un post (`date=…`, `template=…`). */
  onPublier?: (query?: string) => void
  /** « À traiter » de Ma semaine : les commentaires. */
  onCommentaires?: () => void
  /** « Avis Google » de Ma semaine. */
  onGoogle?: () => void
  /** « Opération · … » d'un post : Publicités et opérations. */
  onOperations?: () => void
}

type Vue = 'month' | 'week' | 'list' | 'suivi' | 'analyse'

interface CompteMeta {
  key: string
  type: 'facebook' | 'instagram' | string
  name: string
  username?: string
  picture?: string | null
  link?: string
  reseau?: boolean
  erreur?: string | null
}
interface PubliMeta {
  id: string
  channel: 'Facebook' | 'Instagram' | string
  account: string
  accountName?: string
  date: string
  time: string
  type?: string
  title?: string
  text?: string
  img?: string
  status: string
  permalink?: string
  stats?: { reactions?: number | null; comments?: number | null; shares?: number | null }
  campaign?: string | null
}
interface CalMeta {
  du: string
  au: string
  le?: string
  erreurs?: string[]
  message?: string | null
  posts?: PubliMeta[]
  comptes?: CompteMeta[]
}
interface Chiffres {
  id: string
  loading?: boolean
  err?: string
  vues?: number | null
  personnes?: number | null
  motif?: string | null
}
type Ligne = (PostFranchise & { meta: false }) | (PubliMeta & { meta: true; own: false; serie?: undefined; story?: undefined; fb?: boolean; refus?: undefined; reason?: undefined; promo?: undefined; template?: undefined; textNl?: undefined })

interface Boost {
  metaId: string
  statut: 'attente' | 'boostee' | 'refusee' | string
  le?: string
  traiteLe?: string | null
  reponse?: string
}
interface Boosts {
  demandes?: Boost[]
  attente?: number
  max?: number
  permis?: boolean
}
interface Repost {
  source: string
  img?: string | null
  publieLe?: string
  type?: string
  mode?: string
  instagram?: boolean
  texte?: string
  texteBoutique?: string
  permalink?: string
  limite?: string | null
  sansReponse?: string
}
interface Reposts {
  attente?: Repost[]
  marque?: string
}
interface MaSemaine {
  du: string
  au: string
  boutiques?: number
  classement?: boolean
  ligne?: { quotaUtilise: number; quota: number; posts: number; enRetard?: number; dansDelaiPct?: number | null; note?: number | null; avisGagnes?: number | null; avis5Requis?: number; abonnesNet?: number | null; rang?: number }
  moyenne?: { posts?: number; abonnesNet?: number }
}
interface SuiviR {
  du: string
  au: string
  jours: number
  devise?: string
  message?: string | null
  lignes?: {
    facebook?: { followers?: number | null; gagnes?: number | null; perdus?: number | null; net?: number | null; serie?: Record<string, { gagnes: number; perdus: number }>; motif?: string | null }
    instagram?: { serie?: Record<string, { gagnes: number; perdus: number }>; motif?: string | null } | null
    depense?: number
    depenseJours?: Record<string, number>
    abonnesNet?: number | null
    coutParAbonne?: number | null
  }[]
}
interface CompteVues {
  key: string
  type: string
  name: string
  reseau?: boolean
  vues: { metrique?: string; serie?: Record<string, number>; total?: number | null; motif?: string | null }
  abonnes: { followers?: number | null; serie?: Record<string, { gagnes: number; perdus: number }> | null; gagnes?: number | null; perdus?: number | null; motif?: string | null }
  publicationsMotif?: string | null
}
interface VuesR {
  du: string
  au: string
  le?: string
  message?: string | null
  erreurs?: string[]
  comptes?: CompteVues[]
  publications?: (PubliMeta & { vues?: number | null; personnes?: number | null })[]
}

const VUES: Record<string, Vue> = { semaine: 'week', liste: 'list', mois: 'month', suivi: 'suivi', analyse: 'analyse' }
const PARAM: Record<Vue, string> = { week: 'semaine', list: 'liste', month: 'mois', suivi: 'suivi', analyse: 'analyse' }
const META_C: Record<string, string> = { Facebook: '#1877F2', Instagram: '#C13584' }
const DOW = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const param = (k: string) => new URLSearchParams(window.location.search).get(k)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'erreur'
const ini = (t: string, bg: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" rx="26" fill="${bg}"/><text x="26" y="33" font-family="Arial" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${t}</text></svg>`)}`
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** La période affichée : le mois en semaines entières, la semaine, ou (suivi, analyse) les N derniers jours jusqu'à hier. */
function periode(vue: Vue, curseur: string, today: string, jours: number): [string, string] {
  if (vue === 'suivi' || vue === 'analyse') {
    const au = addDays(today, -1)
    return [addDays(au, -(jours - 1)), au]
  }
  if (vue === 'week') {
    const a = addDays(curseur, -((d2(curseur).getDay() + 6) % 7))
    return [a, addDays(a, 6)]
  }
  const c = d2(curseur)
  const first = new Date(c.getFullYear(), c.getMonth(), 1)
  const off = (first.getDay() + 6) % 7
  const a = addDays(iso(first), -off)
  const last = new Date(c.getFullYear(), c.getMonth() + 1, 0)
  return [a, addDays(a, Math.ceil((off + last.getDate()) / 7) * 7 - 1)]
}

/**
 * « Mes réseaux » de l'espace franchisé — Calendrier.dc.html, réécrit dans le Marketing : le calendrier de la
 * boutique (ses posts, ceux du réseau, et les publications de sa Page et de l'Instagram lues en direct chez Meta),
 * en mois, semaine ou liste ; « Ma semaine », les reposts proposés par le réseau, la fiche d'une publication
 * (chiffres, boost, annulation) ; et deux onglets lus chez Meta : « Vues et abonnés » et « Suivi de ma boutique ».
 * (L'ancienne page « Mes promotions » mène à la vue Liste : `?vue=liste`.)
 */
export default function CalendrierFranchiseView(props: CalendrierFranchiseViewProps = {}) {
  const { etat, erreur, chargement } = useFranchise()
  if (chargement === 'attente') return <p className="muted">Lecture de votre espace…</p>
  if (!etat) return <p className="error">{erreur || 'Chargement impossible.'}</p>
  return <Calendrier etat={etat} props={props} />
}

function Calendrier({ etat, props }: { etat: EtatFranchise; props: CalendrierFranchiseViewProps }) {
  const st = etat
  const r = st.rules
  const TODAY = st.today
  const [vue, setVue] = useState<Vue>(() => {
    const v = VUES[param('vue') || '']
    if (v === 'suivi' && r.voirSuivi === false) return 'month'
    if (v === 'analyse' && r.voirAnalyse === false) return 'month'
    return v || 'month'
  })
  const [calVue, setCalVue] = useState<Vue>('month')
  const [curseur, setCurseur] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(param('date') || '') ? String(param('date')) : TODAY))
  const [jours, setJours] = useState(() => ([7, 28, 90].includes(Number(param('jours'))) ? Number(param('jours')) : 28))
  const [selId, setSelId] = useState<string | null>(() => param('post'))
  const [hide, setHide] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const toastT = useRef<number | undefined>(undefined)
  const [mp, setMp] = useState<CalMeta | null>(null)
  const [mpLoading, setMpLoading] = useState(false)
  const [mpErr, setMpErr] = useState('')
  const mc = useRef<Record<string, CalMeta>>({})
  const [ps, setPs] = useState<Chiffres | null>(null)
  const psc = useRef<Record<string, Chiffres>>({})
  const [ms, setMs] = useState<MaSemaine | null>(null)
  const [boostL, setBoostL] = useState<Boosts | null>(null)
  const [boostFor, setBoostFor] = useState<string | null>(null)
  const [boostMsg, setBoostMsg] = useState('')
  const [boostSending, setBoostSending] = useState(false)
  const [boostErr, setBoostErr] = useState('')
  const [rp, setRp] = useState<Reposts | null>(null)
  const [rpRefus, setRpRefus] = useState<string | null>(null)
  const [rpMotif, setRpMotif] = useState('')
  const [rpBusy, setRpBusy] = useState(false)
  const [sv, setSv] = useState<SuiviR | null>(null)
  const [svLoading, setSvLoading] = useState(false)
  const [svErr, setSvErr] = useState('')
  const svc = useRef<Record<number, SuiviR>>({})
  const [va, setVa] = useState<VuesR | null>(null)
  const [vaLoading, setVaLoading] = useState(false)
  const [vaErr, setVaErr] = useState('')
  const vac = useRef<Record<number, VuesR>>({})
  const [hov, setHov] = useState<Survol | null>(null)

  const dire = useCallback((m: string) => {
    window.clearTimeout(toastT.current)
    setToast(m)
    toastT.current = window.setTimeout(() => setToast(''), 5000)
  }, [])
  useEffect(() => () => window.clearTimeout(toastT.current), [])

  const aller = (page: 'pub', query?: string) => {
    if (props.onPublier) props.onPublier(query)
    else window.location.assign(lienFranchise(page, query))
  }

  // À l'ouverture : Ma semaine, les boosts, les reposts ; et le message d'un post tout juste programmé.
  useEffect(() => {
    lireMaSemaine<MaSemaine>().then(setMs).catch(() => {})
    lireBoosts<Boosts>().then(setBoostL).catch(() => {})
    lireReposts<Reposts>().then(setRp).catch(() => {})
    const ok = param('ok')
    if (ok) {
      const n = Number(param('n')) || 1
      const f = ({ story: 'Story', post_story: 'Post + story' } as Record<string, string>)[param('f') || ''] || ''
      dire(
        (f ? `${f} · ` : '') +
          (ok === 'valider'
            ? `Envoyé : le réseau valide ${n > 1 ? `chacune des ${n} dates` : 'votre post'} avant publication.`
            : `Programmé${n > 1 ? ` : ${n} dates, chacune à l’heure prévue.` : ' : il partira à l’heure prévue.'}`),
      )
    }
  }, [dire])

  const [du, au] = periode(vue, curseur, TODAY, jours)
  const horsCal = vue === 'suivi' || vue === 'analyse'

  // L'adresse garde la vue et la date : un lien partagé rouvre le même calendrier.
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('vue', PARAM[vue])
      u.searchParams.set('date', curseur)
      if (horsCal) u.searchParams.set('jours', String(jours))
      else u.searchParams.delete('jours')
      if (selId) u.searchParams.set('post', selId)
      else u.searchParams.delete('post')
      for (const k of ['ok', 'n', 'f']) u.searchParams.delete(k)
      if (u.toString() !== window.location.href) window.history.replaceState(window.history.state, '', u.toString())
    } catch {
      /* adresse inchangée */
    }
  }, [vue, curseur, jours, selId, horsCal])

  // Les publications de la Page (et de l'Instagram) sur la période, lues en direct chez Meta.
  const lireMeta = useCallback(
    (force: boolean) => {
      const key = `${du}_${au}`
      if (!force && mc.current[key]) {
        setMp(mc.current[key])
        setMpErr('')
        return () => {}
      }
      let vivant = true
      setMpLoading(true)
      setMpErr('')
      lireCalendrier<CalMeta>(du, au)
        .then((x) => {
          mc.current[key] = x
          if (!vivant) return
          setMp(x)
          setMpLoading(false)
          if (force) dire(`${(x.posts || []).length} publication(s) relue(s) chez Meta.`)
        })
        .catch((e) => {
          if (!vivant) return
          setMpLoading(false)
          setMpErr(message(e))
        })
      return () => {
        vivant = false
      }
    },
    [du, au, dire],
  )
  useEffect(() => {
    if (vue === 'analyse') return
    return lireMeta(false)
  }, [vue, lireMeta])

  // Le suivi (abonnés de la Page face au budget), lu quand l'onglet est ouvert.
  useEffect(() => {
    if (vue !== 'suivi') return
    if (svc.current[jours]) {
      setSv(svc.current[jours])
      setSvErr('')
      return
    }
    let vivant = true
    setSvLoading(true)
    setSvErr('')
    lireSuivi<SuiviR>(jours)
      .then((x) => {
        svc.current[jours] = x
        if (vivant) setSv(x)
      })
      .catch((e) => vivant && setSvErr(message(e)))
      .finally(() => vivant && setSvLoading(false))
    return () => {
      vivant = false
    }
  }, [vue, jours])

  // L'analyse des vues et des abonnés, lue quand l'onglet est ouvert.
  useEffect(() => {
    if (vue !== 'analyse') return
    setHov(null)
    if (vac.current[jours]) {
      setVa(vac.current[jours])
      setVaErr('')
      return
    }
    let vivant = true
    setVaLoading(true)
    setVaErr('')
    lireVues<VuesR>(jours)
      .then((x) => {
        vac.current[jours] = x
        if (vivant) setVa(x)
      })
      .catch((e) => vivant && setVaErr(message(e)))
      .finally(() => vivant && setVaLoading(false))
    return () => {
      vivant = false
    }
  }, [vue, jours])

  // Les chiffres (vues…) de la publication Meta ouverte, lus à l'ouverture de sa fiche.
  const pubMeta = selId && /^m(fb|ig)-/.test(selId) ? (mp?.posts || []).find((x) => x.id === selId) : undefined
  useEffect(() => {
    if (!pubMeta || pubMeta.status !== 'Publié') return
    const id = pubMeta.id
    if (psc.current[id]) {
      setPs(psc.current[id])
      return
    }
    let vivant = true
    setPs({ id, loading: true })
    lireChiffresPublication<Chiffres>(id, pubMeta.account)
      .then((x) => {
        psc.current[id] = { ...x, id }
        if (vivant) setPs(psc.current[id])
      })
      .catch((e) => vivant && setPs({ id, err: message(e) }))
    return () => {
      vivant = false
    }
  }, [pubMeta])

  const ouvrirJour = (d: string) => {
    setCalVue(horsCal ? calVue : vue)
    setVue('week')
    setCurseur(d)
    setHov(null)
  }

  // ----- Les sources : mes posts, ceux du réseau pour ma boutique, chaque compte Meta -----
  const comptes = mp?.comptes || []
  const accOf = (k: string) => comptes.find((c) => c.key === k) || null
  const META: Ligne[] = (mp?.posts || []).map((x) => ({ ...x, meta: true as const, own: false as const }))
  const all: Ligne[] = (st.posts.map((x) => ({ ...x, meta: false as const })) as Ligne[]).concat(META)
  const srcOf = (x: Ligne) => (x.meta ? x.account : x.own ? 'mine' : 'net')
  const shown = all.filter((x) => !hide.includes(srcOf(x)))
  const inP = (x: Ligne) => x.date >= du && x.date <= au
  const nowMs = at(TODAY, st.now)
  const couleurs = (x: Ligne) => (x.meta ? (x.status === 'Programmé' ? STATUS.Programmé : STATUS.Publié) : STATUS[x.status] || STATUS.Brouillon)

  const vueDe = (x: Ligne) => {
    const acc = x.meta ? accOf(x.account) : null
    const who = x.meta
      ? x.channel === 'Instagram'
        ? `Instagram${acc?.reseau ? ' réseau' : ''}`
        : 'Ma Page'
      : x.own
        ? `${x.story === 'seule' ? 'Ma story · ' : x.story === 'aussi' ? 'Mon post + story · ' : 'Mon post · '}${x.status}${x.serie ? ` · ↻ ${x.serie.rang}/${x.serie.n}` : ''}`
        : 'Réseau'
    const bar = x.meta
      ? META_C[x.channel] || '#1877F2'
      : x.own
        ? x.status === 'Refusé' || x.status === 'Échec'
          ? '#8D1D2C'
          : x.status === 'À valider'
            ? '#B0792A'
            : x.status === 'Publié'
              ? '#3f7a52'
              : '#D97B29'
        : '#B8B2A8'
    const s = (x.meta && x.stats) || {}
    const react = x.meta && s.reactions != null ? `♥ ${fmt(s.reactions)}${s.comments ? ` · ${fmt(s.comments)} commentaire(s)` : ''}` : ''
    const whoShort = x.meta ? (x.channel === 'Instagram' ? 'IG' : 'Page') : x.own ? 'moi' : 'réseau'
    const c = couleurs(x)
    return {
      id: x.id,
      title: x.title || '(sans texte)',
      time: x.time,
      who,
      whoShort,
      bar,
      img: media(x.img) || ini('AB', '#C9BFB3'),
      cls: x.meta ? 'is-meta' : x.own ? 'is-mien' : 'is-reseau',
      faible: x.status === 'Refusé',
      tip: `${x.title} — ${who} · ${dLabel(x.date)} à ${x.time}${react ? ` · ${react}` : ''}`,
      status: x.status,
      stBg: c.bg,
      stFg: c.fg,
      kind: x.meta ? x.type || x.channel : x.type || 'Post',
      react,
      dateLabel: dLabel(x.date),
    }
  }
  const parJour = (d: string) =>
    shown
      .filter((x) => x.date === d)
      .sort((a, b) => a.time.localeCompare(b.time))
      .map(vueDe)
  const ouvrir = (id: string) => {
    setSelId(id)
    setPs(null)
  }

  // « + » : créer un post ce jour-là, dans les règles du réseau.
  const minJ = iso(new Date(Date.now() + r.delaiMinHeures * 3600000))
  const maxJ = addDays(TODAY, r.horizonJours)
  const peutAjouter = (d: string) => d >= minJ && d <= maxJ && (r.jours || []).includes(d2(d).getDay())

  const m0 = d2(curseur)
  const cells: { d: string; inMonth: boolean }[] = []
  if (vue === 'month') for (let d = du; d <= au; d = addDays(d, 1)) cells.push({ d, inMonth: d2(d).getMonth() === m0.getMonth() })
  const listeRows = shown
    .filter((x) => (vue === 'list' ? x.date.slice(0, 7) === curseur.slice(0, 7) : inP(x)))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .map(vueDe)

  // Pastilles des sources.
  const compter = (k: string) => all.filter((x) => srcOf(x) === k && (vue === 'list' ? x.date.slice(0, 7) === curseur.slice(0, 7) : inP(x))).length
  const puces: { k: string; name: string; pic: string; net: string; netBg: string; tip: string }[] = [{ k: 'mine', name: 'Mes posts', pic: ini('MOI', '#8D1D2C'), net: '', netBg: '', tip: 'Vos posts publiés depuis cet espace (tous statuts)' }]
  if (r.voirReseau) puces.push({ k: 'net', name: 'Posts du réseau', pic: ini('AB', '#8A847C'), net: '', netBg: '', tip: 'Ce que le réseau a programmé pour votre boutique' })
  for (const c of comptes)
    puces.push({
      k: c.key,
      name: `${c.type === 'instagram' ? `@${c.username || c.name}` : c.name}${c.reseau ? ' · réseau' : ''}`,
      pic: c.picture || ini(c.type === 'instagram' ? 'IG' : 'f', c.type === 'instagram' ? '#C13584' : '#1877F2'),
      net: c.type === 'instagram' ? 'IG' : 'f',
      netBg: c.type === 'instagram' ? '#C13584' : '#1877F2',
      tip: `${c.type === 'instagram' ? `Instagram${c.reseau ? ' du réseau (compte unique)' : ''}` : 'Votre Page Facebook'} · lu chez Meta${c.erreur ? ` — ${c.erreur}` : ''}`,
    })

  // Indicateurs : la semaine affichée, sinon le mois.
  const mo = curseur.slice(0, 7)
  const ofM = (x: Ligne) => (vue === 'week' ? inP(x) : x.date.slice(0, 7) === mo)
  const own = st.posts.filter((x) => x.own)
  const perLabel = vue === 'week' ? `semaine du ${dShort(du)}` : MONTHS[m0.getMonth()]
  const pageM = META.filter((x) => x.meta && x.channel === 'Facebook' && x.status === 'Publié' && ofM(x))
  const modPub = st.posts.filter((x) => x.status === 'Publié' && x.fb && ofM({ ...x, meta: false }))
  const reac = pageM.reduce((n, x) => n + (x.meta ? (x.stats?.reactions || 0) + (x.stats?.comments || 0) + (x.stats?.shares || 0) : 0), 0)
  const avenir = all.filter((x) => at(x.date, x.time) >= nowMs && ['Programmé', 'À valider'].includes(x.status))
  const refused = own.filter((x) => x.status === 'Refusé').length

  // ----- La fiche -----
  const sp = all.find((x) => x.id === selId)
  const fiche = sp ? (
    <Fiche
      sp={sp}
      etat={st}
      acc={sp.meta ? accOf(sp.account) : null}
      ps={ps && ps.id === sp.id ? ps : null}
      nowMs={nowMs}
      couleurs={couleurs(sp)}
      boostL={boostL}
      boostOpen={boostFor === sp.id}
      boostMsg={boostMsg}
      boostSending={boostSending}
      boostErr={boostErr}
      onFermer={() => setSelId(null)}
      onOperations={props.onOperations}
      onRefaire={(tpl) => aller('pub', `template=${encodeURIComponent(tpl)}`)}
      onBoostOuvrir={() => {
        setBoostFor(sp.id)
        setBoostMsg('')
        setBoostErr('')
      }}
      onBoostAnnuler={() => {
        setBoostFor(null)
        setBoostErr('')
      }}
      setBoostMsg={setBoostMsg}
      onBoost={async () => {
        if (boostSending || !sp.meta) return
        setBoostSending(true)
        setBoostErr('')
        try {
          setBoostL(await proposerBoost<Boosts>({ id: sp.id, account: sp.account }, boostMsg.trim()))
          setBoostFor(null)
          setBoostMsg('')
          dire('Proposé au réseau : sa réponse s’affichera ici et dans « Publicités et opérations ».')
        } catch (e) {
          setBoostErr(message(e))
        } finally {
          setBoostSending(false)
        }
      }}
      onAnnuler={async (serie) => {
        if (!window.confirm(serie ? `Annuler toutes les dates à venir de « ${sp.title} » ?` : `Annuler « ${sp.title} »${!sp.meta && sp.serie ? ' (cette date seulement)' : ''} ?`)) return
        try {
          const n = await annulerPost(sp.id, serie)
          setSelId(null)
          dire(serie ? `${n} date(s) retirée(s) de votre calendrier.` : 'Post retiré de votre calendrier.')
        } catch (e) {
          dire(message(e))
        }
      }}
    />
  ) : null

  const avenirListe = all
    .filter((x) => at(x.date, x.time) >= nowMs && x.status !== 'Refusé' && !hide.includes(srcOf(x)))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .slice(0, 8)

  const label = vue === 'week' ? `Semaine du ${dShort(du)} au ${dShort(au)}` : majuscule(`${MONTHS[m0.getMonth()]} ${m0.getFullYear()}`)
  const decaler = (n: number) => {
    if (vue === 'week') setCurseur(addDays(curseur, 7 * n))
    else setCurseur(iso(new Date(m0.getFullYear(), m0.getMonth() + n, 1)))
  }
  const lu = mp?.le ? String(mp.le) : ''
  const mpNote = mpLoading
    ? 'Lecture chez Meta…'
    : mpErr
      ? `Meta illisible : ${mpErr}`
      : mp?.message
        ? mp.message
        : lu
          ? `Lu chez Meta le ${dShort(lu.slice(0, 10))} à ${lu.slice(11, 16)}${(mp?.erreurs || []).length ? ` · ${mp?.erreurs?.[0]}` : ''}`
          : ''
  const mpAlerte = !!(mpErr || mp?.erreurs?.length || mp?.message)

  const onglets: [Vue | 'cal', string][] = [['cal', 'Calendrier']]
  if (r.voirAnalyse !== false) onglets.push(['analyse', 'Vues et abonnés'])
  if (r.voirSuivi !== false) onglets.push(['suivi', 'Suivi de ma boutique'])
  const ongletActif = horsCal ? vue : 'cal'
  const choisirOnglet = (k: Vue | 'cal') => {
    if (k === 'cal') {
      if (horsCal) {
        setVue(calVue)
        setHov(null)
      }
      return
    }
    if (k !== vue) {
      if (!horsCal) setCalVue(vue)
      setVue(k)
      setSelId(null)
      setHov(null)
    }
  }

  const eyebrow =
    vue === 'analyse'
      ? `Vues et abonnés · L’Atelier By ${st.shop.name} · ce que vos clients voient de vous sur Facebook et Instagram`
      : vue === 'suivi'
        ? `Suivi · L’Atelier By ${st.shop.name} · vos abonnés, vos publications et les publicités du réseau`
        : `Calendrier Meta · L’Atelier By ${st.shop.name} · Facebook et Instagram`

  return (
    <div className="social-native fcal">
      {onglets.length > 1 ? (
        <div className="seg fcal__onglets" role="tablist">
          {onglets.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={ongletActif === k} className={ongletActif === k ? 'is-on' : ''} onClick={() => choisirOnglet(k)}>
              {l}
            </button>
          ))}
        </div>
      ) : null}

      <header className="fcal__tete">
        <div className="fcal__titre">
          <span className="fcal__etiquette">{eyebrow}</span>
          <h1>{vue === 'analyse' ? 'Vues et abonnés' : vue === 'suivi' ? 'Suivi de ma boutique' : label}</h1>
        </div>
        <div className="fcal__outils">
          {horsCal ? (
            <>
              <span className="muted fcal__petit">
                du {dShort(du)} au {dShort(au)}
              </span>
              <div className="seg">
                {[7, 28, 90].map((j) => (
                  <button
                    key={j}
                    type="button"
                    className={jours === j ? 'is-on' : ''}
                    onClick={() => {
                      setJours(j)
                      setHov(null)
                    }}
                  >
                    {j} j
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="seg" role="group" aria-label="Vue du calendrier">
                {(
                  [
                    ['month', 'Mois'],
                    ['week', 'Semaine'],
                    ['list', 'Liste'],
                  ] as [Vue, string][]
                ).map(([k, l]) => (
                  <button key={k} type="button" className={vue === k ? 'is-on' : ''} onClick={() => setVue(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="fcal__nav">
                <button type="button" className="btn btn--sm btn--icon" aria-label="Précédent" onClick={() => decaler(-1)}>
                  ‹
                </button>
                <button type="button" className="btn btn--sm" onClick={() => setCurseur(TODAY)}>
                  Aujourd’hui
                </button>
                <button type="button" className="btn btn--sm btn--icon" aria-label="Suivant" onClick={() => decaler(1)}>
                  ›
                </button>
              </div>
            </>
          )}
          <button type="button" className="btn btn--primary" onClick={() => aller('pub')}>
            Publier un post
          </button>
        </div>
      </header>

      {String(r.message || '').trim() ? <p className="fcal__message">{r.message}</p> : null}

      {!horsCal ? (
        <>
          <MaSemaineCarte ms={ms} etat={st} onPublier={() => aller('pub')} onCommentaires={props.onCommentaires} onGoogle={props.onGoogle} onAnalyse={() => choisirOnglet('analyse')} />

          {rp?.attente?.length ? (
            <section className="card fcal__repost">
              <div className="fcal__ligne-tete">
                <span className="fcal__bloc-titre">Le réseau vous propose {rp.attente.length > 1 ? `${rp.attente.length} publications` : 'une publication'}</span>
                <span className="muted fcal__petit">Reprendre sur votre Page Facebook ce que « {rp.marque} » vient de publier</span>
              </div>
              {rp.attente.map((x) => {
                const dt = (v?: string | null) => (v ? `${dShort(String(v).slice(0, 10))} à ${String(v).slice(11, 16)}` : '')
                const txt = String(x.texte || '')
                const refus = rpRefus === x.source
                const repondre = (accepter: boolean) => {
                  if (rpBusy) return
                  setRpBusy(true)
                  repondreRepost<Reposts>(x.source, accepter, accepter ? '' : rpMotif)
                    .then((n) => {
                      setRp(n)
                      setRpRefus(null)
                      setRpMotif('')
                      dire(accepter ? 'Publié sur votre Page : il apparaît dans votre calendrier.' : 'Refusé : le réseau voit votre motif.')
                      void relire()
                      mc.current = {}
                      lireMeta(true)
                    })
                    .catch((e) => dire(message(e)))
                    .finally(() => setRpBusy(false))
                }
                return (
                  <div key={x.source} className="fcal__repost-ligne">
                    {x.img ? <img src={x.img} alt="" className="fcal__repost-img" /> : null}
                    <div className="fcal__repost-texte">
                      <span className="muted fcal__petit">
                        {dt(x.publieLe)} · {x.type} · {x.mode === 'copie' ? 'copié sur votre Page' : 'partagé sur votre Page'}
                        {x.instagram ? ' et votre Instagram' : ''}
                      </span>
                      <span className="fcal__pre">{txt.length > 400 ? `${txt.slice(0, 400).trim()}…` : txt}</span>
                      {x.texteBoutique ? <span className="fcal__petit">Ajouté pour votre boutique : {x.texteBoutique}</span> : null}
                      <a href={x.permalink || '#'} target="_blank" rel="noopener noreferrer" className="fcal__petit">
                        Voir la publication de la marque ↗
                      </a>
                      {x.limite ? (
                        <span className="fcal__petit is-or">
                          Répondez avant le {dt(x.limite)}
                          {x.sansReponse === 'publier' ? ' : sans réponse, il sera publié quand même.' : ' : sans réponse, rien ne sera publié.'}
                        </span>
                      ) : null}
                      {refus ? (
                        <span className="fcal__refus">
                          <textarea className="fcal__champ" rows={2} value={rpMotif} placeholder="Pourquoi ? (le réseau le lit)" aria-label="Motif du refus" onChange={(e) => setRpMotif(e.target.value)} />
                          <button type="button" className="btn btn--sm" disabled={rpBusy} onClick={() => repondre(false)}>
                            Confirmer le refus
                          </button>
                        </span>
                      ) : null}
                    </div>
                    <div className="fcal__repost-actions">
                      <button type="button" className="btn btn--sm" disabled={rpBusy} onClick={() => repondre(true)}>
                        Publier sur ma Page
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setRpRefus(refus ? null : x.source)
                          setRpMotif('')
                        }}
                      >
                        Refuser
                      </button>
                    </div>
                  </div>
                )
              })}
            </section>
          ) : null}

          <div className="kpi-row card fcal__kpis">
            <Kpi label="Publications de ma Page" value={mp ? String(pageM.length + modPub.length) : '…'} note={`${perLabel} · lues chez Meta`} />
            <Kpi label="Réactions sur ma Page" value={mp ? fmt(reac) : '…'} note={`j’aime, commentaires, partages · ${perLabel}`} />
            <Kpi label="À venir" value={String(avenir.length)} note="programmé ici ou chez Meta" />
            <Kpi label="À valider" value={String(own.filter((x) => x.status === 'À valider').length)} note="en attente du réseau" />
            {refused ? <Kpi label="Refusés" value={String(refused)} note="voir le motif" alerte /> : null}
          </div>

          <div className="card fcal__sources">
            <span className="fcal__etiquette">Afficher</span>
            {puces.map((a) => {
              const off = hide.includes(a.k)
              return (
                <button key={a.k} type="button" className={`fcal__source${off ? ' is-off' : ''}`} title={a.tip} onClick={() => setHide(off ? hide.filter((x) => x !== a.k) : hide.concat(a.k))}>
                  <span className="fcal__source-pic">
                    <img src={a.pic} alt="" />
                    {a.net ? (
                      <span className="fcal__source-net" style={{ background: a.netBg }}>
                        {a.net}
                      </span>
                    ) : null}
                  </span>
                  <span className="fcal__source-nom">{a.name}</span>
                  <span className="fcal__source-n">{compter(a.k)}</span>
                </button>
              )
            })}
            <span className="fcal__sources-fin">
              <span className={`fcal__petit${mpAlerte ? ' is-or' : ' muted'}`}>{mpNote}</span>
              <button
                type="button"
                className="btn btn--sm"
                title="Relit chez Meta les publications et la programmation de votre Page (et de l’Instagram) pour la période affichée."
                onClick={() => lireMeta(true)}
              >
                {mpLoading ? 'Lecture…' : 'Relire chez Meta'}
              </button>
            </span>
          </div>

          <div className="fcal__corps">
            <section className="fcal__gauche">
              {vue === 'month' ? (
                <div className="card fcal__mois">
                  <div className="fcal__dows">
                    {DOW.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <div className="fcal__grille">
                    {cells.map(({ d, inMonth }) => (
                      <div key={d} className={`fcal__cellule${inMonth ? '' : ' is-hors'}`}>
                        <div className="fcal__cellule-tete">
                          <span className={`fcal__num${d === TODAY ? ' is-auj' : ''}`}>{d2(d).getDate()}</span>
                          {peutAjouter(d) ? (
                            <button type="button" className="fcal__plus" title="Créer un post ce jour-là" onClick={() => aller('pub', `date=${d}`)}>
                              +
                            </button>
                          ) : null}
                        </div>
                        {parJour(d).map((x) => (
                          <button key={x.id} type="button" className={`fcal__item ${x.cls}${x.faible ? ' is-faible' : ''}`} style={{ borderLeftColor: x.bar }} title={x.tip} onClick={() => ouvrir(x.id)}>
                            <img src={x.img} alt="" />
                            <span className="fcal__item-texte">
                              <span className="muted">
                                <span className="fcal__point" style={{ background: x.bar }} />
                                {x.time} · {x.whoShort}
                              </span>
                              <span>{x.title}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {vue === 'week' ? (
                <div className="fcal__semaine">
                  {Array.from({ length: 7 }, (_, i) => addDays(du, i)).map((d) => {
                    const dd = d2(d)
                    return (
                      <div key={d} className={`card fcal__jour${d === TODAY ? ' is-auj' : ''}`}>
                        <div className="fcal__jour-tete">
                          <span className="fcal__etiquette">{DAYS[dd.getDay()]}</span>
                          <span className="fcal__jour-num">
                            <span>{dd.getDate()}</span>
                            {peutAjouter(d) ? (
                              <button type="button" className="fcal__plus" title="Créer un post ce jour-là" onClick={() => aller('pub', `date=${d}`)}>
                                +
                              </button>
                            ) : null}
                          </span>
                        </div>
                        <div className="fcal__jour-items">
                          {parJour(d).map((x) => (
                            <button key={x.id} type="button" className={`fcal__carte${x.faible ? ' is-faible' : ''}`} style={{ borderTopColor: x.bar }} title={x.tip} onClick={() => ouvrir(x.id)}>
                              <img src={x.img} alt="" />
                              <span className="fcal__carte-texte">
                                <span className="muted">
                                  <span className="fcal__point" style={{ background: x.bar }} />
                                  {x.time} · {x.who}
                                </span>
                                <span className="fcal__carte-titre">{x.title}</span>
                                <span className="fcal__statut" style={{ background: x.stBg, color: x.stFg }}>
                                  {x.status}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}

              {vue === 'list' ? (
                <div className="card table-card fcal__liste">
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          {['Date', 'Heure', '', 'Publication', 'Où', 'Type', 'Réactions', 'Statut'].map((h, i) => (
                            <th key={i} className={i === 1 || (i >= 4 && i <= 6) ? 'fcal__cache-mob' : ''}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {listeRows.map((x) => (
                          <tr key={x.id} className={x.id === selId ? 'is-sel' : ''} onClick={() => ouvrir(x.id)}>
                            <td>{x.dateLabel}</td>
                            <td className="muted fcal__cache-mob">{x.time}</td>
                            <td>
                              <img src={x.img} alt="" className="fcal__mini" />
                            </td>
                            <td className="fcal__liste-titre">{x.title}</td>
                            <td className="fcal__cache-mob">
                              <span className="fcal__point" style={{ background: x.bar }} />
                              {x.who}
                            </td>
                            <td className="muted fcal__cache-mob">{x.kind}</td>
                            <td className="fcal__cache-mob">{x.react}</td>
                            <td>
                              <span className="fcal__statut" style={{ background: x.stBg, color: x.stFg }}>
                                {x.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!listeRows.length ? <p className="muted fcal__vide">Rien sur ce mois.</p> : null}
                </div>
              ) : null}
              <span className="muted fcal__petit" title="Y compris celles faites hors de cet espace (Meta Business Suite, application) et ce qui y est programmé. Rien n’est copié.">
                Les publications de votre Page (et de l’Instagram) sont lues en direct chez Meta pour la période affichée.
              </span>
            </section>

            <aside className="fcal__droite">
              {fiche}
              <div className="card fcal__bloc">
                <span className="fcal__etiquette">À venir</span>
                {!avenirListe.length ? <span className="muted fcal__petit">Rien de prévu.</span> : null}
                {avenirListe.map((x) => {
                  const w = vueDe(x)
                  return (
                    <button key={x.id} type="button" className="fcal__avenir" onClick={() => ouvrir(x.id)}>
                      <img src={w.img} alt="" />
                      <span>
                        <span>{w.title}</span>
                        <span className="muted">
                          {dShort(x.date)} {x.time} · {w.who}
                        </span>
                      </span>
                      <span className="fcal__statut" style={{ background: w.stBg, color: w.stFg }}>
                        {x.status}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="fcal__legende">
                {[
                  ['#8D1D2C', 'Mes posts'],
                  ['#B8B2A8', 'Posts du réseau'],
                  ['#1877F2', 'Ma Page (lu chez Meta)'],
                  ['#C13584', 'Instagram (lu chez Meta)'],
                ].map(([c, n]) => (
                  <span key={n}>
                    <span className="fcal__point" style={{ background: c }} />
                    {n}
                  </span>
                ))}
              </div>
            </aside>
          </div>
        </>
      ) : null}

      {vue === 'suivi' ? <Suivi sv={sv} loading={svLoading} err={svErr} etat={st} meta={META} onJour={ouvrirJour} /> : null}
      {vue === 'analyse' ? <Analyse va={va} loading={vaLoading} err={vaErr} hov={hov} setHov={setHov} onJour={ouvrirJour} /> : null}

      {toast ? (
        <div className="fcal__toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  )
}

function Kpi({ label, value, note, alerte }: { label: string; value: string; note: string; alerte?: boolean }) {
  return (
    <div className={`kpi${alerte ? ' fcal__kpi-alerte' : ''}`}>
      <div className={`kpi__value${alerte ? ' is-alerte' : ''}`}>{value}</div>
      <div className="kpi__label">{label}</div>
      <div className="kpi__note">{note}</div>
    </div>
  )
}

/** Ma semaine : régularité, ce qui attend, avis Google, abonnés ; et le rang de la boutique dans le réseau. */
function MaSemaineCarte({
  ms,
  etat,
  onPublier,
  onCommentaires,
  onGoogle,
  onAnalyse,
}: {
  ms: MaSemaine | null
  etat: EtatFranchise
  onPublier: () => void
  onCommentaires?: () => void
  onGoogle?: () => void
  onAnalyse: () => void
}) {
  const l = ms?.ligne
  if (!ms || !l) return null
  const moy = ms.moyenne || {}
  const al = etat.alertes || {}
  const aMoi = (al.com?.pourBoutique || 0) + (al.google?.pourBoutique || 0)
  const ord = (n: number) => (n === 1 ? '1er' : `${n}e`)
  const allerA = (page: 'com' | 'google', f?: () => void) => () => (f ? f() : window.location.assign(lienFranchise(page)))
  const tuiles: [string, string, string, boolean, () => void][] = [
    [
      'Posts de la boutique',
      `${l.quotaUtilise} / ${l.quota}`,
      `cette semaine · ${l.posts} publiés en 7 j avec le réseau${moy.posts != null ? ` (autres boutiques : ${String(moy.posts).replace('.', ',')})` : ''}`,
      l.quotaUtilise >= l.quota,
      onPublier,
    ],
    [
      'À traiter',
      String(aMoi),
      `${l.enRetard ? `${l.enRetard} en retard · ` : ''}${l.dansDelaiPct != null ? `${l.dansDelaiPct} % traités dans le délai` : 'commentaires et avis Google'}`,
      !aMoi,
      allerA('com', onCommentaires),
    ],
    [
      'Avis Google',
      l.note != null ? `${Number(l.note).toFixed(2).replace('.', ',')} ★` : '—',
      `${l.avisGagnes != null ? `${l.avisGagnes > 0 ? '+' : ''}${l.avisGagnes} avis en 7 j` : 'suivi en cours'}${l.avis5Requis ? ` · objectif ${l.avis5Requis} avis 5★` : ''}`,
      false,
      allerA('google', onGoogle),
    ],
    [
      'Abonnés',
      l.abonnesNet != null ? `${l.abonnesNet > 0 ? '+' : ''}${Number(l.abonnesNet).toLocaleString('fr-BE')}` : '—',
      `en 7 j${moy.abonnesNet != null ? ` (autres boutiques : ${moy.abonnesNet > 0 ? '+' : ''}${String(moy.abonnesNet).replace('.', ',')})` : ''}`,
      false,
      onAnalyse,
    ],
  ]
  const conseil =
    aMoi > 0
      ? `Commencez par répondre : ${aMoi} commentaire${aMoi > 1 ? 's' : ''} ou avis vous attend${aMoi > 1 ? 'ent' : ''}.`
      : l.quotaUtilise < Math.min(1, l.quota)
        ? 'Aucun post de votre boutique cette semaine : un modèle du réseau prend deux minutes (« Publier un post »).'
        : (l.avis5Requis || 0) > 0
          ? 'Votre note progresse avec chaque avis 5★ : imprimez l’affiche « Laissez-nous un avis » (Avis Google).'
          : 'Belle semaine : continuez comme ça.'
  return (
    <section className="fcal__semaine-carte">
      <div className="fcal__ligne-tete">
        <span className="fcal__etiquette is-clair">
          Ma semaine · du {dShort(ms.du)} au {dShort(ms.au)}
        </span>
        {ms.classement && l.rang ? (
          <span className={`fcal__rang${l.rang === 1 ? ' is-premier' : ''}`}>
            {ord(l.rang)} sur {ms.boutiques} boutiques
          </span>
        ) : null}
      </div>
      <div className="fcal__tuiles">
        {tuiles.map(([lab, val, sub, bon, f]) => (
          <button key={lab} type="button" className="fcal__tuile" onClick={f}>
            <span className="fcal__tuile-lab">{lab}</span>
            <span className={`fcal__tuile-val${bon ? ' is-bon' : ''}`}>{val}</span>
            <span className="fcal__tuile-sub">{sub}</span>
          </button>
        ))}
      </div>
      <span className="fcal__conseil">{conseil}</span>
    </section>
  )
}

/** La fiche d'une publication : un post de l'espace (ou du réseau), ou une publication lue chez Meta. */
function Fiche(p: {
  sp: Ligne
  etat: EtatFranchise
  acc: CompteMeta | null
  ps: Chiffres | null
  nowMs: number
  couleurs: { bg: string; fg: string }
  boostL: Boosts | null
  boostOpen: boolean
  boostMsg: string
  boostSending: boolean
  boostErr: string
  onFermer: () => void
  onOperations?: () => void
  onRefaire: (tpl: string) => void
  onBoostOuvrir: () => void
  onBoostAnnuler: () => void
  setBoostMsg: (m: string) => void
  onBoost: () => void
  onAnnuler: (serie: boolean) => void
}) {
  const { sp, etat, acc, ps, nowMs, couleurs: c } = p
  const op = sp.campaign ? (etat.campaigns || []).find((x) => x.id === sp.campaign) : null
  const lienOp = op ? (
    p.onOperations ? (
      <button type="button" className="btn btn--ghost btn--sm fcal__lien" onClick={p.onOperations}>
        Opération · {op.name} →
      </button>
    ) : (
      <a href={lienFranchise('camp')} className="fcal__petit">
        Opération · {op.name} →
      </a>
    )
  ) : null
  let corps: ReactNode
  if (sp.meta) {
    const s = sp.stats || {}
    const tuiles: [string, string, boolean, string][] = [
      [fmt(s.reactions), sp.channel === 'Instagram' ? 'J’aime' : 'Réactions', false, ''],
      [fmt(s.comments), 'Commentaires', false, ''],
    ]
    if (sp.channel === 'Facebook') tuiles.push([fmt(s.shares), 'Partages', false, ''])
    if (ps && !ps.loading && !ps.err) tuiles.push([fmt(ps.vues), 'Vues', true, 'Lu chez Meta à l’ouverture de la fiche'], [fmt(ps.personnes), 'Personnes touchées', true, ''])
    // Proposer un boost : une publication en ligne d'un compte de la boutique (pas d'un compte du réseau).
    const bl = p.boostL
    const metaId = String(sp.id).replace(/^m(fb|ig)-/, '')
    const dem = bl ? (bl.demandes || []).find((d) => d.metaId === metaId) : null
    const propre = !!acc && !acc.reseau && sp.status === 'Publié'
    const permis = bl ? bl.permis !== false : etat.rules.proposerBoost !== false
    const peut = propre && permis && !!bl && (!dem || dem.statut === 'refusee')
    const etatBoost = !dem
      ? ''
      : dem.statut === 'attente'
        ? `Proposé au réseau le ${dShort(String(dem.le).slice(0, 10))} : en attente de sa décision.`
        : dem.statut === 'boostee'
          ? `Boosté par le réseau${dem.traiteLe ? ` le ${dShort(String(dem.traiteLe).slice(0, 10))}` : ''} : il est sponsorisé autour de votre boutique.`
          : `Le réseau n’a pas retenu ce boost${dem.reponse ? ` : « ${dem.reponse} »` : ''}. Vous pouvez le reproposer.`
    corps = (
      <>
        <div className="fcal__compte">
          <img src={acc?.picture || ini(sp.channel === 'Instagram' ? 'IG' : 'f', sp.channel === 'Instagram' ? '#C13584' : '#1877F2')} alt="" />
          <span>
            <span>
              {acc ? (acc.type === 'instagram' ? `@${acc.username || acc.name}` : acc.name) : sp.accountName}
              {acc?.reseau ? ' · compte du réseau' : ''}
            </span>
            <span className="muted">{sp.type || sp.channel}</span>
          </span>
        </div>
        <span className="muted fcal__petit">
          {dLabel(sp.date)} à {sp.time} · {sp.channel} · lu chez Meta
        </span>
        {lienOp}
        {sp.status === 'Publié' ? (
          <div className="fcal__chiffres">
            {tuiles.map(([v, l, bleu, tip]) => (
              <div key={l} className={bleu ? 'is-bleu' : ''} title={tip || undefined}>
                <span>{v}</span>
                <span>{l}</span>
              </div>
            ))}
          </div>
        ) : null}
        {ps && (ps.loading || ps.err || ps.motif) ? <span className="muted fcal__petit">{ps.loading ? 'Lecture des vues chez Meta…' : ps.err ? `Vues illisibles : ${ps.err}` : ps.motif}</span> : null}
        <p className="fcal__pre">{sp.text || ''}</p>
        {sp.permalink ? (
          <a href={sp.permalink} target="_blank" rel="noopener noreferrer" className="fcal__petit">
            {sp.channel === 'Instagram' ? 'Voir sur Instagram ↗' : 'Voir sur Facebook ↗'}
          </a>
        ) : null}
        {dem ? <div className={`fcal__boost-etat is-${dem.statut}`}>{etatBoost}</div> : null}
        {peut ? (
          p.boostOpen ? (
            <div className="fcal__boost" title={`Le réseau peut sponsoriser ce post autour de votre boutique : il décide, et sa réponse s’affiche ici.${bl?.attente ? ` ${bl.attente} demande(s) en attente sur ${bl.max} possibles.` : ''}`}>
              <textarea className="fcal__champ" rows={2} value={p.boostMsg} placeholder="Pourquoi le booster ? (facultatif)" onChange={(e) => p.setBoostMsg(e.target.value)} />
              <div className="fcal__actions">
                <button type="button" className="btn btn--sm" disabled={p.boostSending} onClick={p.onBoost}>
                  {p.boostSending ? 'Envoi…' : 'Proposer au réseau'}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={p.onBoostAnnuler}>
                  Annuler
                </button>
              </div>
              {p.boostErr ? <span className="error fcal__petit">{p.boostErr}</span> : null}
            </div>
          ) : (
            <button type="button" className="btn btn--sm" onClick={p.onBoostOuvrir}>
              Proposer au réseau de booster ce post
            </button>
          )
        ) : null}
        <span className="muted fcal__petit">
          {sp.status === 'Programmé'
            ? 'Programmé dans Meta Business Suite : il partira à l’heure prévue. En lecture seule ici.'
            : `Publication lue en direct chez Meta (faite ${acc?.reseau ? 'par le réseau' : 'sur votre Page, depuis Meta Business Suite ou l’application'}). En lecture seule ici.`}
        </span>
      </>
    )
  } else {
    const L = langues(etat)[0]
    const tpl = etat.templates.find((t) => t.id === sp.template)
    const canaux = [sp.fb ? 'Facebook' : '', sp.ig ? 'Instagram' : ''].filter(Boolean).join(' + ') || '—'
    const ch = sp.story === 'seule' ? `Story ${canaux}` : sp.story === 'aussi' ? `${canaux} · post + story` : canaux
    const futur = at(sp.date, sp.time) > nowMs
    const annulable = sp.own && ['À valider', 'Programmé', 'Refusé'].includes(sp.status) && futur
    const serieAnnulable =
      !!(sp.own && sp.serie) &&
      etat.posts.filter((x) => x.serie && x.serie.id === sp.serie?.id && ['À valider', 'Programmé', 'Refusé', 'Brouillon'].includes(x.status) && at(x.date, x.time) > nowMs).length > 1
    const freq = sp.serie ? ({ jour: 'chaque jour', semaine: 'chaque semaine', '2semaines': 'toutes les 2 semaines', mois: 'chaque mois' } as Record<string, string>)[sp.serie.freq] || '' : ''
    corps = (
      <>
        <span className="muted fcal__petit">
          {dLabel(sp.date)} à {sp.time} · {ch} · {sp.own ? 'votre post' : 'post du réseau'}
        </span>
        {sp.own && sp.serie ? (
          <span className="fcal__petit">
            ↻ Post récurrent · date {sp.serie.rang} sur {sp.serie.n} · {freq}
          </span>
        ) : null}
        {lienOp}
        {sp.promo ? (
          <span className="fcal__statut is-or">
            {sp.promo.label}
            {sp.promo.from ? ` · du ${dShort(sp.promo.from)} au ${dShort(sp.promo.to)}` : ''}
          </span>
        ) : null}
        {sp.refus ? <div className="fcal__refuse">Refusé par le réseau : {sp.refus}</div> : null}
        {sp.reason ? <div className="fcal__refuse">Publication en échec : {sp.reason}</div> : null}
        {sp.own && sp.status === 'À valider' ? <div className="fcal__attente">En attente de validation par le réseau. S’il est validé, il part à l’heure prévue.</div> : null}
        <p className="fcal__pre">{remplir(etat, L === 'nl' && sp.textNl ? sp.textNl : sp.text, L)}</p>
        <div className="fcal__actions">
          {serieAnnulable ? (
            <button type="button" className="btn btn--danger btn--sm" onClick={() => p.onAnnuler(true)}>
              Annuler toute la série
            </button>
          ) : null}
          {annulable ? (
            <button type="button" className="btn btn--danger btn--sm" onClick={() => p.onAnnuler(false)}>
              {sp.status === 'Refusé' ? 'Retirer' : sp.serie ? 'Annuler cette date' : 'Annuler ce post'}
            </button>
          ) : null}
          {sp.own && tpl ? (
            <button type="button" className="btn btn--sm" onClick={() => p.onRefaire(String(sp.template || ''))}>
              Refaire avec ce modèle
            </button>
          ) : null}
        </div>
      </>
    )
  }
  return (
    <div className="card fcal__fiche">
      <div className="fcal__fiche-img">
        {sp.img ? <img src={media(sp.img)} alt="" style={{ objectFit: sp.meta ? 'cover' : 'contain' }} /> : null}
        <button type="button" className="fcal__fermer" title="Fermer" aria-label="Fermer" onClick={p.onFermer}>
          ×
        </button>
      </div>
      <div className="fcal__fiche-corps">
        <div className="fcal__ligne-tete">
          <span className="fcal__fiche-titre">{sp.title || '(sans texte)'}</span>
          <span className="fcal__statut" style={{ background: c.bg, color: c.fg }}>
            {sp.meta ? (sp.status === 'Programmé' ? 'Programmé chez Meta' : 'En ligne') : sp.own ? sp.status : `Réseau · ${sp.status}`}
          </span>
        </div>
        {corps}
      </div>
    </div>
  )
}

/** Le suivi de la boutique : abonnés gagnés et perdus de sa Page, jour par jour, face au budget publicitaire et à ses publications. */
function Suivi({ sv: r, loading, err, etat, meta, onJour }: { sv: SuiviR | null; loading: boolean; err: string; etat: EtatFranchise; meta: Ligne[]; onJour: (d: string) => void }) {
  const pied = (
    <span className="muted fcal__petit">
      Chiffres lus en direct chez Meta pour la Page Facebook de votre boutique ; les publications sont celles de votre calendrier (lues chez Meta et publiées depuis cet espace). Le budget est celui des publicités du réseau qui mettent votre boutique en avant.
    </span>
  )
  if (err)
    return (
      <div className="fcal__onglet">
        <p className="warning">Suivi illisible pour l’instant : {err}</p>
        {pied}
      </div>
    )
  const x = r?.lignes?.[0]
  if (!r || !x)
    return (
      <div className="fcal__onglet">
        {loading ? <p className="muted">Lecture de votre Page chez Meta…</p> : r ? <p className="card muted">{r.message || 'Aucune donnée pour votre boutique.'}</p> : null}
        {pied}
      </div>
    )
  const money = (v: number | null | undefined, d = 0) => `${fmt(v, d)}${r.devise && r.devise !== 'EUR' ? ` ${r.devise}` : ' €'}`
  const signed = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '▲ +' : n < 0 ? '▼ ' : ''}${fmt(n)}`)
  const fb = x.facebook || {}
  const ig = x.instagram || null
  const dep = x.depenseJours || {}
  const days: string[] = []
  for (let d = r.du; d <= r.au; d = addDays(d, 1)) days.push(d)
  const pubs: Record<string, string[]> = {}
  const toutes: { date: string; title?: string; type?: string }[] = [
    ...meta.filter((p) => p.meta && p.channel === 'Facebook' && p.status === 'Publié'),
    ...etat.posts.filter((p) => p.status === 'Publié' && p.fb),
  ]
  for (const p of toutes) if (p.date >= r.du && p.date <= r.au) (pubs[p.date] = pubs[p.date] || []).push(p.title || p.type || 'Publication')
  const flux = (d: string) => {
    const f = fb.serie?.[d]
    const i = ig?.serie?.[d]
    return f || i ? { g: (f?.gagnes || 0) + (i?.gagnes || 0), p: f?.perdus || 0 } : null
  }
  const maxS = Math.max(1, ...Object.values(dep))
  const maxF = Math.max(1, ...days.map((d) => {
    const v = flux(d)
    return v ? Math.max(v.g, v.p) : 0
  }))
  const ds = days.map((d) => ({ d, v: dep[d] || 0, fl: flux(d), n: (pubs[d] || []).length }))
  const moy = (a: typeof ds) => (a.length ? a.reduce((t, d) => t + (d.fl ? d.fl.g - d.fl.p : 0), 0) / a.length : null)
  const mA = moy(ds.filter((d) => d.v > 0 && d.fl))
  const mS = moy(ds.filter((d) => d.v === 0 && d.fl))
  const mP = moy(ds.filter((d) => d.n > 0 && d.fl))
  const mN = moy(ds.filter((d) => d.n === 0 && d.fl))
  const insights = [
    mA == null && mS == null
      ? 'Les abonnés jour par jour ne sont pas encore disponibles : le total actuel et le budget s’affichent.'
      : `Les jours avec publicité, votre boutique gagne ${mA == null ? '—' : fmt(mA, 1)} abonnés par jour ; sans publicité, ${mS == null ? '—' : fmt(mS, 1)}.${mA != null && mS != null && mA > mS ? ` La publicité vous apporte ${fmt(mA - mS, 1)} abonnés de plus par jour.` : ''}`,
  ]
  if (mP != null && mN != null)
    insights.push(`Les jours où votre Page publie : ${fmt(mP, 1)} abonnés nets en moyenne ; les autres jours : ${fmt(mN, 1)}.${mP > mN ? ` Publier vous fait gagner ${fmt(mP - mN, 1)} abonné(s) de plus par jour.` : ''}`)
  const nPubs = Object.values(pubs).reduce((t, l) => t + l.length, 0)
  const motifs = [fb.motif, ig?.motif].filter(Boolean)
  const tip = (d: (typeof ds)[number]) =>
    `${dLabel(d.d)} · budget ${money(d.v, 2)}${d.fl ? ` · +${d.fl.g} / −${d.fl.p} abonnés` : ' · abonnés non mesurés'}${d.n ? ` · ${d.n} publication(s) : ${(pubs[d.d] || []).join(' · ')}` : ' · aucune publication'}`
  return (
    <div className="fcal__onglet">
      <div className="kpi-row card fcal__kpis">
        <Kpi label="Facebook" value={fmt(fb.followers)} note={fb.net == null ? 'abonnés' : `abonnés · +${fmt(fb.gagnes)} / −${fmt(fb.perdus)} sur ${r.jours} j`} />
        <div className="kpi">
          <div className={`kpi__value${x.abonnesNet == null ? '' : x.abonnesNet > 0 ? ' is-bon' : x.abonnesNet < 0 ? ' is-alerte' : ''}`}>{signed(x.abonnesNet)}</div>
          <div className="kpi__label">Gagnés nets · {r.jours} j</div>
          <div className="kpi__note">{ig ? 'Facebook + Instagram' : 'Page Facebook de la boutique'}</div>
        </div>
        <Kpi label="Publications de ma Page" value={fmt(nPubs)} note={`${Object.keys(pubs).length} jour(s) avec publication · ${r.jours} j`} />
        <Kpi label="Budget publicitaire" value={money(x.depense)} note={`${Object.keys(dep).length} jour(s) de diffusion`} />
        <Kpi label="Coût par abonné" value={x.coutParAbonne == null ? '—' : money(x.coutParAbonne, 2)} note="budget ÷ abonnés nets" />
      </div>
      <div className="card fcal__bloc">
        <div className="fcal__ligne-tete">
          <span className="fcal__bloc-titre">Jour par jour</span>
          <span className="fcal__legende">
            <span>
              <span className="fcal__point" style={{ background: '#8D1D2C' }} />
              budget publicitaire
            </span>
            <span>
              <span className="fcal__point" style={{ background: '#1877F2' }} />
              publications de la Page
            </span>
            <span>
              <span className="fcal__point" style={{ background: '#3f7a52' }} />
              abonnés gagnés
            </span>
            <span>
              <span className="fcal__point" style={{ background: '#b3261e' }} />
              perdus
            </span>
          </span>
        </div>
        <div className="fcal__suivi" title="Un jour s’ouvre au calendrier (semaine)">
          <div className="fcal__suivi-barres is-budget">
            {ds.map((d) => (
              <span key={d.d} title={tip(d)} onClick={() => onJour(d.d)}>
                <span style={{ height: `${Math.round((d.v / maxS) * 110)}px` }} />
              </span>
            ))}
          </div>
          <div className="fcal__suivi-barres is-pubs">
            {ds.map((d) => (
              <span key={d.d} title={tip(d)} onClick={() => onJour(d.d)}>
                <span style={{ width: d.n ? `${Math.min(13, 5 + d.n * 2)}px` : '0px', height: d.n ? `${Math.min(13, 5 + d.n * 2)}px` : '0px' }} />
              </span>
            ))}
          </div>
          <div className="fcal__suivi-barres is-flux">
            {ds.map((d) => (
              <span key={d.d} title={tip(d)} onClick={() => onJour(d.d)}>
                <span className="is-up" style={{ height: d.fl ? `${Math.round((d.fl.g / maxF) * 34)}px` : '0px' }} />
                <span className="is-down" style={{ height: d.fl ? `${Math.round((d.fl.p / maxF) * 28)}px` : '0px' }} />
              </span>
            ))}
          </div>
          <div className="fcal__suivi-dates muted">
            <span>{dShort(r.du)}</span>
            <span>{dShort(r.au)}</span>
          </div>
        </div>
        {insights.map((t) => (
          <span key={t} className="fcal__petit">
            {t}
          </span>
        ))}
        {motifs.length ? <span className="fcal__petit is-or">{motifs.join(' · ')}</span> : null}
      </div>
      {pied}
    </div>
  )
}

/**
 * L'analyse : les vues de la Page (et les comptes touchés sur Instagram) jour par jour, les vues de chaque
 * publication de la période et l'évolution des abonnés. Une série par graphique ; au survol, un repère commun.
 */
function Analyse({ va: r, loading, err, hov, setHov, onJour }: { va: VuesR | null; loading: boolean; err: string; hov: Survol | null; setHov: (h: Survol | null) => void; onJour: (d: string) => void }) {
  if (err)
    return (
      <div className="fcal__onglet">
        <p className="warning">Analyse illisible pour l’instant : {err}</p>
      </div>
    )
  if (!r) return <div className="fcal__onglet">{loading ? <p className="muted">Lecture de vos vues et de vos abonnés chez Meta…</p> : null}</div>
  if (r.message || !(r.comptes || []).length)
    return (
      <div className="fcal__onglet">
        <p className="card muted">{r.message || 'Aucun compte Meta n’est relié à votre boutique.'}</p>
      </div>
    )
  const days: string[] = []
  for (let d = r.du; d <= r.au; d = addDays(d, 1)) days.push(d)
  const n = days.length
  const fb = r.comptes?.find((c) => c.type === 'facebook') || null
  const ig = r.comptes?.find((c) => c.type === 'instagram') || null
  const pubs = r.publications || []
  const parJour = (c: CompteVues | null) => {
    const o: Record<string, typeof pubs> = {}
    if (c) for (const p of pubs.filter((x) => x.account === c.key && x.date >= r.du && x.date <= r.au)) (o[p.date] = o[p.date] || []).push(p)
    return o
  }
  const pF = parJour(fb)
  const pI = parJour(ig)
  const axe = { n, titre: (i: number) => dLabel(days[i]), court: (i: number) => court(days[i]), hov, setHov }
  const titres = (l?: typeof pubs) =>
    l && l.length ? l.slice(0, 2).map((p) => `Publié : « ${p.title || p.type} »`).concat(l.length > 2 ? [`… et ${l.length - 2} autre(s)`] : []) : ['aucune publication ce jour-là']
  const brutF = days.map((d) => (fb?.vues.serie?.[d] != null ? Number(fb.vues.serie[d]) : null))
  const brutI = days.map((d) => (ig?.vues.serie?.[d] != null ? Number(ig.vues.serie[d]) : null))
  const bF = incomplets(brutF)
  const bI = incomplets(brutI)
  const vF = brutF.map((v, i) => (bF[i] ? null : v))
  const vI = brutI.map((v, i) => (bI[i] ? null : v))
  const brut = (raw: (number | null)[], bad: boolean[], i: number, mot: string) => (bad[i] ? [`${fmt(raw[i])} ${mot} — chiffre incomplet chez Meta`] : [`${fmt(raw[i])} ${mot}`])
  const visites = fb?.vues.metrique === 'visites'
  const motVue = visites ? 'visites' : 'vues'
  const aF = fb ? fb.abonnes : null
  const aI = ig ? ig.abonnes : null
  const sF = aF?.serie || null
  const sI = aI?.serie || null
  const net = (d: string) => (sF && sF[d] ? (Number(sF[d].gagnes) || 0) - (Number(sF[d].perdus) || 0) : 0)
  const tot: (number | null)[] = days.map(() => null)
  if (aF && aF.followers != null && sF) {
    tot[n - 1] = aF.followers
    for (let i = n - 1; i > 0; i--) tot[i - 1] = Number(tot[i]) - net(days[i])
  }
  const netF = aF && aF.gagnes != null ? aF.gagnes - (aF.perdus || 0) : null
  const nomIg = ig ? `Instagram${ig.reseau ? ' du réseau' : ''}` : ''
  const reseauNote = ig?.reseau ? 'Instagram est commun à tout le réseau : ses chiffres ne sont pas ceux de votre seule boutique.' : ''
  const joindre = (...t: (string | null | undefined)[]) => t.filter(Boolean).join(' ')
  const somme = (a: (number | null)[]) => a.reduce<number>((t, v) => t + (v || 0), 0)
  const nb = (a: (number | null)[]) => a.filter((v) => v != null).length
  const avecVues = pubs.filter((p) => p.vues != null)
  const top = (avecVues.length ? avecVues : pubs).slice(0, 10)
  const maxV = Math.max(1, ...avecVues.map((p) => Number(p.vues)))
  const pm = (r.comptes || []).map((c) => c.publicationsMotif).filter(Boolean) as string[]
  const best = avecVues[0] || null
  const ouvrirSurvol = () => {
    if (hov) onJour(days[hov.i])
  }

  // Ce qu'il faut retenir.
  const insights: string[] = []
  const cite = (p: { title?: string; type?: string }) => `« ${String(p.title || p.type || '').replace(/[\s.!?…]+$/, '')} »`
  if (nb(vF)) {
    let bi = 0
    vF.forEach((v, i) => {
      if (v != null && v > (vF[bi] || 0)) bi = i
    })
    insights.push(`Votre meilleur jour : ${dLabel(days[bi])}, ${fmt(vF[bi])} ${motVue}${pF[days[bi]] ? `, le jour de ${cite(pF[days[bi]][0])}.` : '.'}`)
    const avec = vF.filter((v, i) => v != null && pF[days[i]])
    const sans = vF.filter((v, i) => v != null && !pF[days[i]])
    if (avec.length && sans.length) {
      const a = somme(avec) / avec.length
      const b = somme(sans) / sans.length
      insights.push(`Les jours où votre Page publie, elle fait ${fmt(a)} ${motVue} en moyenne, contre ${fmt(b)} les autres jours${b > 0 && a > b * 1.1 ? ` : publier multiplie vos ${motVue} par ${fmt(a / b, 1)}.` : '.'}`)
    }
    if (n >= 14) {
      const t = [0, 0, 0, 0, 0, 0, 0]
      const c = [0, 0, 0, 0, 0, 0, 0]
      vF.forEach((v, i) => {
        if (v != null) {
          const w = d2(days[i]).getDay()
          t[w] += v
          c[w]++
        }
      })
      let bw = -1
      t.forEach((v, w) => {
        if (c[w] && (bw < 0 || v / c[w] > t[bw] / c[bw])) bw = w
      })
      if (bw >= 0) insights.push(`Le ${JOURS[bw]} est votre meilleur jour de la semaine : ${fmt(t[bw] / c[bw])} ${motVue} en moyenne. Un bon jour pour publier.`)
    }
  }
  if (aF && aF.gagnes != null) insights.push(`Votre Page : +${fmt(aF.gagnes)} abonnés, −${fmt(aF.perdus)} désabonnements, soit ${signe(netF)} en ${n} jours.`)
  if (aI && aI.gagnes != null) insights.push(`${nomIg} : +${fmt(aI.gagnes)} nouveaux abonnés${ig?.reseau ? ' pour tout le réseau.' : '.'}`)
  if (!insights.length) insights.push('Meta ne partage pas encore les chiffres jour par jour de vos comptes : les totaux s’affichent.')
  const le = String(r.le || '')

  return (
    <div className="fcal__onglet">
      <div className="kpi-row card fcal__kpis">
        {fb ? <Kpi label={`${visites ? 'Visites' : 'Vues'} · Page`} value={fmt(fb.vues.total)} note={`${n} jours${nb(vF) ? ` · ${fmt(somme(vF) / nb(vF))} / jour` : ''}`} /> : null}
        {ig ? <Kpi label={`Vues · ${nomIg}`} value={fmt(ig.vues.total)} note={ig.vues.total != null ? `${n} jours · ${ig.name}` : 'non partagées par Meta'} /> : null}
        {fb && aF ? <Kpi label="Abonnés · Page" value={fmt(aF.followers)} note={aF.gagnes != null ? `+${fmt(aF.gagnes)} / −${fmt(aF.perdus)} · net ${signe(netF)} en ${n} j` : 'historique non partagé'} /> : null}
        {ig && aI ? <Kpi label={`Abonnés · ${nomIg}`} value={fmt(aI.followers)} note={aI.gagnes != null ? `+${fmt(aI.gagnes)} nouveaux` : 'historique non partagé'} /> : null}
        <Kpi label="Publication la plus vue" value={best ? fmt(best.vues) : '—'} note={best ? `« ${best.title || best.type} » · ${dShort(best.date)}` : pubs.length ? 'vues non partagées' : 'aucune publication'} />
      </div>

      <div className="fcal__graphes" onClick={ouvrirSurvol} title="Un jour cliqué s’ouvre au calendrier (semaine)">
        {fb ? (
          <Courbe
            {...axe}
            k="fbv"
            title={`${visites ? 'Visites' : 'Vues'} de votre Page Facebook, jour par jour`}
            serie={visites ? 'visites de la Page' : 'vues de la Page'}
            sub={`${fmt(fb.vues.total)} ${motVue} sur ${n} jours${nb(vF) ? ` · ${fmt(somme(vF) / nb(vF))} par jour en moyenne` : ''} · ${fb.name}`}
            note={joindre(fb.vues.motif, visites ? 'Meta ne donne plus les vues de cette Page : ce sont les visites de la Page.' : '', plages(bF, days))}
            vide={fb.vues.motif || 'Meta ne donne pas encore les vues jour par jour de votre Page.'}
            vals={vF}
            color={C.fb}
            marque={(i) => !!pF[days[i]]}
            lignes={(i) => brut(brutF, bF, i, motVue).concat(titres(pF[days[i]]))}
          />
        ) : null}
        {ig ? (
          <Courbe
            {...axe}
            k="igv"
            title={`${nomIg} · comptes touchés, jour par jour`}
            serie="comptes touchés"
            sub={joindre(ig.vues.total != null ? `${fmt(ig.vues.total)} vues sur la période ·` : '', ig.name)}
            note={joindre(ig.vues.motif, plages(bI, days), reseauNote)}
            vide={joindre(ig.vues.motif || 'Meta ne donne pas encore les comptes touchés jour par jour de cet Instagram.', reseauNote)}
            vals={vI}
            color={C.ig}
            marque={(i) => !!pI[days[i]]}
            lignes={(i) => brut(brutI, bI, i, 'comptes touchés').concat(titres(pI[days[i]]))}
          />
        ) : null}
      </div>

      <div className="card grille__graphe">
        <div className="grille__graphe-tete">
          <span className="grille__graphe-nom">
            <span>Vues par publication</span>
            <span className="muted">
              {pubs.length
                ? `${top.length < pubs.length ? `les ${top.length} plus vues sur ${pubs.length}` : `${pubs.length} publication(s)`} depuis le ${court(r.du)} · vues depuis la mise en ligne`
                : `depuis le ${court(r.du)}`}
            </span>
          </span>
          <span className="grille__legende">
            {[fb ? lg.barre(C.fb, 'Page Facebook') : null, ig ? lg.barre(C.ig, nomIg) : null].filter(Boolean).map((l) => (
              <span key={l?.n}>
                <span style={{ width: l?.w, height: l?.h, borderRadius: l?.r, background: l?.c }} />
                {l?.n}
              </span>
            ))}
          </span>
        </div>
        {top.map((p) => (
          <a key={p.id} href={p.permalink || '#'} target="_blank" rel="noopener noreferrer" className="fcal__top" title={`${p.title || ''} — ${fmt(p.vues)} vues${p.personnes != null ? ` · ${fmt(p.personnes)} personnes touchées` : ''}`}>
            <img src={media(p.img) || `${import.meta.env.BASE_URL}img/logo.png`} alt="" />
            <span className="fcal__top-nom">
              <span>{p.title || p.type || 'Publication'}</span>
              <span className="muted">
                {dLabel(p.date)} · {p.channel === 'Instagram' ? nomIg || 'Instagram' : 'Page'} · {p.type}
              </span>
            </span>
            <span className="fcal__top-barre">
              <span style={{ width: p.vues != null ? `${Math.max(1, (Number(p.vues) / maxV) * 100).toFixed(1)}%` : '0%', background: p.channel === 'Instagram' ? C.ig : C.fb }} />
            </span>
            <span className="fcal__top-val">{fmt(p.vues)}</span>
          </a>
        ))}
        {!pubs.length ? <span className="muted fcal__petit">Aucune publication sur la période.</span> : null}
        {pm.length ? <span className="grille__note">{!avecVues.length ? pm[0] : 'Une partie des vues n’est pas partagée par Meta.'}</span> : null}
      </div>

      <div className="fcal__graphes" onClick={ouvrirSurvol}>
        {fb && aF ? (
          <Courbe
            {...axe}
            k="fbt"
            title="Abonnés de votre Page : évolution"
            serie="abonnés de la Page"
            zero={false}
            sub={`${fmt(aF.followers)} abonnés aujourd’hui${netF != null ? ` · ${signe(netF)} en ${n} jours` : ''}`}
            vide={aF.followers != null ? `${fmt(aF.followers)} abonnés aujourd’hui. ${aF.motif || 'Meta ne donne pas encore l’historique des abonnés de votre Page.'}` : aF.motif || 'Abonnés illisibles pour l’instant.'}
            vals={tot}
            color={C.fb}
            marque={(i) => !!pF[days[i]]}
            lignes={(i) => [`${fmt(tot[i])} abonnés`, sF && sF[days[i]] ? `+${fmt(sF[days[i]].gagnes)} / −${fmt(sF[days[i]].perdus)} ce jour-là` : 'pas de chiffre ce jour-là'].concat(titres(pF[days[i]]).slice(0, 1))}
          />
        ) : null}
        {fb && aF && sF ? (
          <Barres
            {...axe}
            k="fbg"
            title="Abonnés gagnés et perdus, jour par jour"
            sub={`Page Facebook · +${fmt(aF.gagnes)} gagnés, −${fmt(aF.perdus)} perdus sur ${n} jours`}
            vide="Meta ne donne pas encore les abonnés jour par jour."
            legend={[lg.barre(C.up, 'gagnés'), lg.barre(C.down, 'perdus')]}
            hauts={days.map((d) => (sF[d] ? Number(sF[d].gagnes) || 0 : null))}
            bas={days.map((d) => (sF[d] ? Number(sF[d].perdus) || 0 : 0))}
            lignes={(i) => {
              const x = sF[days[i]]
              return x ? [`+${fmt(x.gagnes)} gagnés`, `${signe(-(Number(x.perdus) || 0))} perdus`, `net ${signe((Number(x.gagnes) || 0) - (Number(x.perdus) || 0))}`] : ['pas de chiffre ce jour-là']
            }}
          />
        ) : null}
        {ig && aI ? (
          <Barres
            {...axe}
            k="igg"
            title={`${nomIg} · nouveaux abonnés, jour par jour`}
            sub={`${fmt(aI.followers)} abonnés aujourd’hui${aI.gagnes != null ? ` · +${fmt(aI.gagnes)} nouveaux` : ''} · ${ig.name}`}
            note={joindre(aI.motif, sI ? 'Instagram ne donne pas les désabonnements jour par jour.' : '', reseauNote)}
            vide={joindre(aI.motif || 'Meta ne donne pas encore les nouveaux abonnés de cet Instagram.', reseauNote)}
            legend={[]}
            hauts={days.map((d) => (sI && sI[d] ? Number(sI[d].gagnes) || 0 : null))}
            bas={null}
            lignes={(i) => {
              const x = sI && sI[days[i]]
              return x ? [`+${fmt(x.gagnes)} nouveaux abonnés`] : ['pas de chiffre ce jour-là']
            }}
          />
        ) : null}
      </div>

      <div className="card fcal__bloc">
        <span className="fcal__bloc-titre">Ce qu’il faut retenir</span>
        {insights.map((t) => (
          <span key={t} className="fcal__petit">
            {t}
          </span>
        ))}
      </div>

      <details className="card fcal__details">
        <summary>Voir les chiffres jour par jour</summary>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                {['Jour', visites ? 'Visites Page' : 'Vues Page', 'Touchés IG', 'Gagnés Page', 'Perdus Page', 'Nouveaux IG', 'Publications'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days
                .map((d, i) => ({ d, i }))
                .reverse()
                .map(({ d, i }) => {
                  const pp = (pF[d] || []).concat(pI[d] || []).map((p) => p.title || p.type).join(' · ') || '—'
                  return (
                    <tr key={d}>
                      <td>{dLabel(d)}</td>
                      <td>
                        {fmt(brutF[i])}
                        {bF[i] ? ' (incomplet)' : ''}
                      </td>
                      <td>
                        {fmt(brutI[i])}
                        {bI[i] ? ' (incomplet)' : ''}
                      </td>
                      <td>{fmt(sF && sF[d] ? sF[d].gagnes : null)}</td>
                      <td>{fmt(sF && sF[d] ? sF[d].perdus : null)}</td>
                      <td>{fmt(sI && sI[d] ? sI[d].gagnes : null)}</td>
                      <td className="fcal__liste-titre" title={pp}>
                        {pp}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </details>
      <span className="muted fcal__petit">
        Chiffres lus en direct chez Meta{le ? ` le ${dShort(le.slice(0, 10))} à ${le.slice(11, 16)}` : ''} pour la Page Facebook de votre boutique
        {ig ? (ig.reseau ? ' et l’Instagram du réseau' : ' et son Instagram') : ''}. Les chiffres d’un jour sont complets le lendemain : la période s’arrête hier. Rien n’est copié.
        {(r.erreurs || []).length ? ` · ${r.erreurs?.[0]}` : ''}
      </span>
    </div>
  )
}
