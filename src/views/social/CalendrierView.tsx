import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import './social.css'
import './calendrier.css'
import { DAYS, MONTHS, addDays, d2, dLabel, dShort, fmt, iso } from '../../lib/social/format'
import { POST_TYPES, STATUS, imageSocial } from '../../lib/social/refs'
import { charger, effacerAvis, enregistrer, journaliser, libelleBoutiques, parId, rattacher, useSocial } from '../../lib/social/store'
import type { EtatSocial, Serveur } from '../../lib/social/store'
import { alertes, avatar, languesDe, libelleConnexion, pageSocial, remplir } from '../../lib/social/ecrans'
import { lireCalendriers, lireChiffresPost, relancerPost, supprimerPost } from '../../lib/social/api-calendrier'
import type { Calendriers, ChiffresPost, CompteMeta, PostCal } from '../../lib/social/api-calendrier'

export interface CalendrierViewProps {
  /** « Nouveau post » (et « Créer un post » sur un jour) : l'écran Créer un post, éventuellement à une date. */
  onCreerPost?: (date?: string) => void
  /** « Modifier » / « Voir » un post du module : l'écran Créer un post sur ce post. */
  onOuvrirPost?: (id: string) => void
  /** « Contrôler → » : l'écran Contrôle (le post est aussi posé dans sessionStorage `sa.ctrl`). */
  onControler?: (post: unknown) => void
  /** « Créer la publicité → » d'un dark post : l'assistant des Publicités sur ce post. */
  onCreerPub?: (postId: string) => void
  /** « Rétablir les connexions → » : les Paramètres du module (connexions). */
  onParametres?: () => void
}

type Vue = 'month' | 'week' | 'list'
type Chiffres = (ChiffresPost & { id: string; loading?: boolean; err?: string }) | null

const DOT: Record<string, string> = {
  Brouillon: '#B8B2A8',
  'À valider': '#B0792A',
  Programmé: '#D97B29',
  Publié: '#3f7a52',
  Échec: '#8D1D2C',
  Partiel: '#C96A6E',
  'Dark post': '#1c1a17',
}
const LEGENDE: [string, string][] = [
  ['Brouillon', DOT.Brouillon],
  ['À valider', DOT['À valider']],
  ['Programmé', DOT.Programmé],
  ['Publié', DOT.Publié],
  ['Partiel', DOT.Partiel],
  ['Échec', DOT.Échec],
  ['Dark post', DOT['Dark post']],
]
const DOW = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const LIST_HEAD = ['Date', 'Heure', '', 'Post', 'Type', 'Boutiques', 'Canaux', 'Opération', 'Statut']

const param = (k: string) => new URLSearchParams(window.location.search).get(k)
const statutDe = (p: PostCal) => (p.partial?.ko?.length ? 'Partiel' : p.status)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'erreur'

/** La période affichée : le mois complet en semaines entières, ou la semaine. */
function periode(vue: Vue, curseur: string): [string, string] {
  if (vue === 'week') {
    const off = (d2(curseur).getDay() + 6) % 7
    const a = addDays(curseur, -off)
    return [a, addDays(a, 6)]
  }
  const cur = d2(curseur)
  const first = new Date(cur.getFullYear(), cur.getMonth(), 1)
  const off = (first.getDay() + 6) % 7
  const a = addDays(iso(first), -off)
  const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
  return [a, addDays(a, Math.ceil((off + last.getDate()) / 7) * 7 - 1)]
}

/**
 * Calendrier éditorial — l'écran « Calendrier » du module Social, réécrit dans le Marketing
 * (docs/PORTAILS.md, étape 2f). Les posts du module (état `/state`) et les publications faites
 * hors du module, lues en direct chez Meta (`/meta/calendriers`) : mois, semaine ou liste, filtres,
 * déplacement par glisser-déposer, validation, relance, duplication, suppression, rattachement à une
 * opération, chiffres d'une publication Meta et contrôle d'un post de boutique.
 */
export default function CalendrierView({ onCreerPost, onOuvrirPost, onControler, onCreerPub, onParametres }: CalendrierViewProps = {}) {
  const { etat, serveur, erreur, chargement, avis } = useSocial()
  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>
  return (
    <Calendrier
      etat={etat}
      serveur={serveur}
      avis={avis}
      props={{ onCreerPost, onOuvrirPost, onControler, onCreerPub, onParametres }}
    />
  )
}

function Calendrier({ etat, serveur, avis, props }: { etat: EtatSocial; serveur: Serveur; avis: string | null; props: CalendrierViewProps }) {
  const TODAY = serveur.today
  const [vue, setVue] = useState<Vue>(() => {
    const v = param('view')
    if (v === 'month' || v === 'week' || v === 'list') return v
    return param('status') ? 'list' : 'month'
  })
  const [curseur, setCurseur] = useState(() => {
    const dt = param('date')
    return /^\d{4}-\d{2}-\d{2}$/.test(dt || '') ? String(dt) : TODAY
  })
  const [fShops, setFShops] = useState<string[]>([])
  // Ouvert depuis un canal du Marketing (Facebook, Instagram) ou une campagne : déjà filtré.
  const [fNet, setFNet] = useState(() => {
    const n = param('reseau')
    return n === 'facebook' || n === 'instagram' ? n : ''
  })
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState(() => param('status') || '')
  const [fCamp, setFCamp] = useState(() => {
    const op = param('operation')
    return op && /^[\w-]{1,40}$/.test(op) ? op : ''
  })
  const [fAcc, setFAcc] = useState<string[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const drag = useRef<string | null>(null)
  const [toast, setToast] = useState('')
  const toastT = useRef<number | undefined>(undefined)
  const [retrying, setRetrying] = useState(false)
  // Publications lues chez Meta pour la période affichée (rien en base).
  const [mp, setMp] = useState<Calendriers | null>(null)
  const [mpLoading, setMpLoading] = useState(false)
  const [mpErr, setMpErr] = useState('')
  const [relire, setRelire] = useState(0)
  const mk = useRef('')
  const [ps, setPs] = useState<Chiffres>(null)
  const psCache = useRef<Record<string, NonNullable<Chiffres>>>({})
  const psKey = useRef('')
  // Duplication
  const [dupOpen, setDupOpen] = useState(false)
  const [dupDates, setDupDates] = useState<string[]>([])
  const [dupShops, setDupShops] = useState<string[]>([])
  // Suppression
  const [delOpen, setDelOpen] = useState(false)
  const [delMeta, setDelMeta] = useState(true)
  const [delBusy, setDelBusy] = useState(false)
  const [delErrs, setDelErrs] = useState<{ text: string }[]>([])
  const [delDone, setDelDone] = useState<string[]>([])

  const dire = useCallback((m: string) => {
    window.clearTimeout(toastT.current)
    setToast(m)
    toastT.current = window.setTimeout(() => setToast(''), 2600)
  }, [])
  useEffect(() => () => window.clearTimeout(toastT.current), [])

  const [du, au] = periode(vue, curseur)

  // Les publications des Pages et Instagram de la période, lues en direct chez Meta.
  useEffect(() => {
    const key = `${du}_${au}_${relire}`
    mk.current = key
    setMpLoading(true)
    setMpErr('')
    lireCalendriers(du, au)
      .then((r) => {
        if (mk.current === key) {
          setMp(r)
          setMpLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (mk.current === key) {
          setMpLoading(false)
          setMpErr(message(e))
        }
      })
  }, [du, au, relire])

  const SHOPS = useMemo(() => etat.shops.filter((x) => !x.test), [etat.shops])
  const metaPosts = useMemo(() => mp?.posts ?? [], [mp])
  const comptes: CompteMeta[] = mp?.comptes ?? []
  const modulePosts = etat.posts as unknown as PostCal[]
  const all = useMemo(() => modulePosts.concat(metaPosts), [modulePosts, metaPosts])
  const camps = etat.campaigns
  const nomBoutique = (id: string) => parId(etat.shops, id)?.name ?? id

  // Les chiffres (vues…) de la publication Meta ouverte, lus en direct à l'ouverture de sa fiche.
  useEffect(() => {
    if (!selId || !/^m(fb|ig)-/.test(selId)) return
    if (psKey.current === selId) {
      // Déjà lue (ou en lecture) : la fiche rouverte reprend ses chiffres.
      if (psCache.current[selId]) setPs(psCache.current[selId])
      return
    }
    const sp = metaPosts.find((p) => p.id === selId)
    if (!sp || sp.status !== 'Publié') return
    psKey.current = sp.id
    if (psCache.current[sp.id]) {
      setPs(psCache.current[sp.id])
      return
    }
    setPs({ id: sp.id, loading: true })
    lireChiffresPost(sp)
      .then((r) => {
        psCache.current[sp.id] = { ...r, id: sp.id }
        if (psKey.current === sp.id) setPs(psCache.current[sp.id])
      })
      .catch((e: unknown) => {
        if (psKey.current === sp.id) setPs({ id: sp.id, err: message(e) })
      })
  }, [selId, metaPosts])

  const shopsOf = (p: PostCal): string[] => (p.shops === 'all' ? SHOPS.map((x) => x.id) : p.shops || [])
  const idsOf = (sid: string) => etat.meta.ids?.[sid] ?? {}
  const igReseau = String(((serveur.brand as { ids?: Record<string, string> } | null)?.ids ?? {}).instagram_user_id ?? '')
  // Les comptes d'un post : le sien pour une publication Meta ; ceux des boutiques visées pour un post du module.
  const accountsOf = (p: PostCal): string[] => {
    if (p.origin === 'meta') return [String(p.account)]
    const out: string[] = []
    for (const sid of shopsOf(p)) {
      const ch = p.ch?.[sid] ?? {}
      const ids = idsOf(sid)
      if ((ch.fb ?? p.fb) && ids.page_id) out.push(`fb:${ids.page_id}`)
      const ig = ids.instagram_user_id || igReseau // Instagram unique du réseau
      if ((ch.ig ?? p.ig) && ig && !out.includes(`ig:${ig}`)) out.push(`ig:${ig}`)
    }
    return out
  }

  const sansCompte = all
    .filter((p) => {
      if (fShops.length && !shopsOf(p).some((id) => fShops.includes(id))) return false
      if (fNet === 'facebook' && !p.fb) return false
      if (fNet === 'instagram' && !p.ig) return false
      if (fType && p.type !== fType) return false
      if (fStatus && statutDe(p) !== fStatus) return false
      if (fCamp === 'none' && p.campaign) return false
      if (fCamp && fCamp !== 'none' && p.campaign !== fCamp) return false
      return true
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  const filtered = fAcc.length ? sansCompte.filter((p) => accountsOf(p).some((k) => fAcc.includes(k))) : sansCompte

  const shortShops = (p: PostCal) => {
    if (p.origin === 'meta') return String(p.accountName || '').replace(/^l[’']atelier\s*by\s*[-–·]?\s*/i, '') || 'Marque'
    const ids = shopsOf(p)
    return ids.length === SHOPS.length ? 'Réseau' : ids.length > 1 ? `${ids.length} boutiques` : nomBoutique(ids[0])
  }
  // Un post du module peut viser la Page de la marque (seule, ou avec des boutiques).
  const shopsLabel = (p: PostCal) =>
    p.origin === 'meta' && !(Array.isArray(p.shops) ? p.shops : []).length
      ? p.marque
        ? 'Marque'
        : '—'
      : p.marque
        ? ['Marque'].concat((Array.isArray(p.shops) ? p.shops : []).length ? [libelleBoutiques(etat, shopsOf(p))] : []).join(' + ')
        : libelleBoutiques(etat, shopsOf(p))

  const imgOf = (p: PostCal) => {
    const meta = p.origin === 'meta'
    const acc = meta ? comptes.find((c) => c.key === p.account) : null
    return p.img ? imageSocial(p.img) : acc?.picture || avatar(p.accountName, meta && p.ig ? 'instagram' : 'facebook')
  }
  const stLabel = (p: PostCal) => {
    const k = statutDe(p)
    return k === 'Partiel' && p.partial ? `Partiel · ${p.partial.ok.length}/${p.partial.ok.length + p.partial.ko.length}` : k
  }
  const channelsShort = (p: PostCal) =>
    p.dark ? 'Pub uniquement' : [p.fb ? 'FB' : '', p.ig ? 'IG' : ''].filter(Boolean).join(' · ') + (p.origin === 'meta' ? ' · Meta' : '')
  const verrouille = (p: PostCal) => p.status === 'Publié' || !!p.dark || p.origin === 'meta'

  const updatePost = (id: string, patch: Partial<PostCal>) =>
    enregistrer({ posts: etat.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  const move = (id: string, date: string) => {
    const p = modulePosts.find((x) => x.id === id)
    // Un dark post n'a pas de date de publication : il ne se déplace pas.
    if (!p || p.status === 'Publié' || p.dark || p.date === date) return
    if (date < TODAY) {
      dire('Impossible de programmer un post dans le passé.')
      return
    }
    updatePost(id, { date })
    journaliser('Déplacement', `« ${p.title} » déplacé au ${dShort(date)}`)
    dire(`« ${p.title} » déplacé au ${dLabel(date)}.`)
  }

  const jour = (d: string) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      if (dragOver !== d) setDragOver(d)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      const id = drag.current
      drag.current = null
      setDragOver(null)
      if (id) move(id, d)
    },
  })
  const glisser = (p: PostCal) => ({
    draggable: !verrouille(p),
    onDragStart: (e: DragEvent) => {
      drag.current = p.id
      try {
        e.dataTransfer.setData('text/plain', p.id)
        e.dataTransfer.effectAllowed = 'move'
      } catch {
        /* navigateur sans dataTransfer */
      }
    },
  })
  const classeCarte = (p: PostCal) =>
    [
      selId === p.id ? 'is-sel' : '',
      statutDe(p) === 'Échec' ? 'is-echec' : '',
      p.origin === 'meta' ? (p.ig ? 'is-meta is-ig' : 'is-meta') : '',
      verrouille(p) ? 'is-fixe' : '',
      selId && selId !== p.id ? 'is-estompe' : '',
    ]
      .filter(Boolean)
      .join(' ')
  const tipOf = (p: PostCal) => `${p.title} — ${statutDe(p)}${p.origin === 'meta' ? ` · ${p.channel} ${p.accountName || ''} (hors module)` : ''}`

  // Trous : les 7 prochains jours.
  const g0 = addDays(TODAY, 1)
  const g1 = addDays(TODAY, 7)
  const fenetre = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i + 1))
  const planned = (sid: string, d: string) => all.filter((p) => p.date === d && shopsOf(p).includes(sid) && ['Programmé', 'À valider'].includes(p.status))
  const coverage = SHOPS.map((sh) => {
    const days = fenetre.map((d) => {
      const pp = planned(sh.id, d)
      const prog = pp.some((p) => p.status === 'Programmé')
      return { d, cls: prog ? 'is-prog' : pp.length ? 'is-valider' : '', tip: `${dLabel(d)}${pp.length ? ` · ${pp.map((p) => p.title).join(', ')}` : ' · rien de prévu'}` }
    })
    const n = fenetre.reduce((a, d) => a + planned(sh.id, d).length, 0)
    const prog = fenetre.reduce((a, d) => a + planned(sh.id, d).filter((p) => p.status === 'Programmé').length, 0)
    return { id: sh.id, name: sh.name, days, n, prog }
  })
  const gapIds = coverage.filter((c) => c.prog === 0).map((c) => c.id)
  const gapForDay = (d: string) => (d >= g0 && d <= g1 ? gapIds.filter((id) => planned(id, d).length === 0) : [])

  // Mois
  const cur = d2(curseur)
  const y = cur.getFullYear()
  const m = cur.getMonth()
  const first = new Date(y, m, 1)
  const offset = (first.getDay() + 6) % 7
  const start = addDays(iso(first), -offset)
  const last = new Date(y, m + 1, 0)
  const totalCells = Math.ceil((offset + last.getDate()) / 7) * 7
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const d = addDays(start, i)
    const dt = d2(d)
    return { d, day: dt.getDate(), inMonth: dt.getMonth() === m, gp: gapForDay(d).map(nomBoutique) }
  })
  // Semaine
  const wOff = (d2(curseur).getDay() + 6) % 7
  const wStart = addDays(curseur, -wOff)
  const wEnd = addDays(wStart, 6)
  const weekCols = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(wStart, i)
    const dt = d2(d)
    return { d, dow: DAYS[dt.getDay()], day: `${dt.getDate()} ${MONTHS[dt.getMonth()].slice(0, 3)}.`, gp: gapForDay(d) }
  })
  const dansMois = (p: PostCal) => d2(p.date).getMonth() === m && d2(p.date).getFullYear() === y
  const inPeriod = vue === 'week' ? filtered.filter((p) => p.date >= wStart && p.date <= wEnd) : filtered.filter(dansMois)
  const periodTitle =
    vue === 'week'
      ? `Semaine du ${d2(wStart).getDate()} au ${d2(wEnd).getDate()} ${MONTHS[d2(wEnd).getMonth()]}`
      : ((t: string) => t.charAt(0).toUpperCase() + t.slice(1))(`${MONTHS[m]} ${y}`)

  // Indicateurs
  const next7 = all.filter((p) => p.date >= g0 && p.date <= g1 && p.status === 'Programmé').length
  const toVal = all.filter((p) => p.status === 'À valider').length
  const fails = all.filter((p) => p.status === 'Échec' || p.partial?.ko?.length).length
  const nGaps = gapIds.length

  // Sélection
  const sp = all.find((p) => p.id === selId) ?? null
  const delKind = !sp ? '' : sp.origin === 'meta' ? 'meta' : sp.status === 'Publié' ? 'publie' : 'local'
  const delWhere =
    !sp || delKind === 'local'
      ? ''
      : delKind === 'meta'
        ? `${sp.channel} · ${sp.accountName || ''}`
        : `${(sp.partial?.ok ? sp.partial.ok : shopsOf(sp).concat(sp.marque ? ['marque'] : []))
            .map((id) => (id === 'marque' ? (sp.marque ? 'Marque' : 'Instagram du réseau') : nomBoutique(id)))
            .join(', ')} · ${[sp.fb ? 'Facebook' : '', sp.ig ? 'Instagram' : ''].filter(Boolean).join(' + ')}`
  const delAds = !sp
    ? []
    : etat.ads
        .filter((a) => a.post === sp.id && !['Terminée', 'Refusée', 'Budget épuisé'].includes(String(a.status)))
        .map((a) => ({ id: a.id, name: String(a.name ?? ''), status: String(a.status ?? '') }))
  const delMetaReel = delKind === 'meta' || (delKind === 'publie' && delMeta)
  const delAdsVus = delKind !== 'meta' && (delKind !== 'publie' || delMeta) ? delAds : []

  const alerts = alertes(etat, serveur)
  const hasFilters = !!(fShops.length || fNet || fType || fStatus || fCamp || fAcc.length)
  const isEmpty = inPeriod.length === 0
  const shift = (dir: number) => {
    if (vue === 'week') setCurseur(addDays(curseur, 7 * dir))
    else setCurseur(iso(new Date(y, m + dir, 1)))
  }
  const clearFilters = () => {
    setFShops([])
    setFNet('')
    setFType('')
    setFStatus('')
    setFCamp('')
    setFAcc([])
  }

  // Les pastilles des comptes Meta : une par Page et par Instagram, avec le nombre de posts de la période.
  const nParCompte: Record<string, number> = {}
  sansCompte.filter((p) => p.date >= du && p.date <= au).forEach((p) => accountsOf(p).forEach((k) => (nParCompte[k] = (nParCompte[k] || 0) + 1)))

  const mpNote = mpLoading
    ? 'Lecture des Pages et comptes Instagram chez Meta…'
    : mpErr
      ? `Lecture chez Meta impossible : ${mpErr}`
      : mp
        ? `Lu en direct chez Meta à ${String(mp.le || '').slice(11, 16)} · ${metaPosts.length} publication(s) hors module${(mp.erreurs || []).length ? ` · ${(mp.erreurs || []).length} erreur(s)` : ''}`
        : ''
  const mpEnErreur = !!mpErr || !!mp?.erreurs?.length

  // Actions sur le post choisi
  const retry = () => {
    if (!sp) return
    setRetrying(true)
    // Le serveur republie les Pages en échec et rend le résultat de Meta.
    relancerPost(sp.id)
      .then((p) => {
        const left = p.status === 'Échec' ? (p.failedShops || []).length : p.partial ? p.partial.ko.length : 0
        journaliser('Relance', `« ${sp.title} » relancé${left ? ` — ${left} échec(s) persistant(s)` : ' — publié'}`)
        setRetrying(false)
        void charger()
        dire(left ? `Relance effectuée, ${left} échec(s) persistant(s) : voir le motif.` : 'Publication relancée avec succès.')
      })
      .catch((e: unknown) => {
        setRetrying(false)
        dire(`Relance impossible : ${message(e)}`)
      })
  }
  const approve = () => {
    if (!sp) return
    updatePost(sp.id, { status: 'Programmé', refus: null })
    journaliser('Validation', `« ${sp.title} » approuvé`)
    dire('Post approuvé et programmé.')
  }
  const reject = () => {
    if (!sp) return
    // Un post proposé depuis l'espace franchisé : la boutique voit le motif du refus.
    if (sp.origin === 'franchise') {
      const motif = window.prompt('Motif du refus, visible par la boutique dans son espace :', '')
      if (motif === null) return
      updatePost(sp.id, { status: 'Brouillon', refus: motif.trim() || 'Refusé par le franchiseur' })
      journaliser('Refus', `« ${sp.title} » (${sp.author || 'boutique'}) refusé${motif.trim() ? ` : ${motif.trim()}` : ''}`)
      dire('Refusé : la boutique voit le motif dans son espace.')
      return
    }
    updatePost(sp.id, { status: 'Brouillon' })
    journaliser('Refus', `« ${sp.title} » renvoyé en brouillon`)
    dire('Post renvoyé en brouillon à la boutique.')
  }
  // Rattacher le post (du module, ou lu chez Meta) à une campagne du Marketing.
  const setOp = (v: string | null) => {
    if (!sp) return
    const name = v ? parId(camps, v)?.name ?? '' : ''
    rattacher('post', sp.id, v)
      .then(() => {
        if (sp.origin === 'meta') setMp((x) => (x ? { ...x, posts: x.posts.map((p) => (p.id === sp.id ? { ...p, campaign: v } : p)) } : x))
        dire(v ? `Rattaché à « ${name} ».` : 'Détaché de son opération.')
      })
      .catch((e: unknown) => dire(`Rattachement impossible : ${message(e)}`))
  }
  const toCtrl = () => {
    if (!sp) return
    const meta = sp.origin === 'meta'
    const fiche = {
      id: sp.id,
      shop: shopsOf(sp)[0],
      title: sp.title || (sp.text || '').slice(0, 40) || 'Publication',
      img: sp.img || '',
      date: sp.date,
      time: sp.time || '',
      channel: meta ? sp.channel : sp.fb ? 'Facebook' : 'Instagram',
      text: sp.text || '',
      link: sp.permalink || '',
      account: sp.accountName || '',
      origin: meta ? 'Publié sur la Page' : 'Espace franchisé',
    }
    try {
      sessionStorage.setItem('sa.ctrl', JSON.stringify(fiche))
    } catch {
      /* stockage indisponible */
    }
    if (props.onControler) props.onControler(fiche)
    else window.location.href = pageSocial('SA Controle.dc.html')
  }
  const openDel = () => {
    if (!sp) return
    setDelOpen(true)
    setDelMeta(true)
    setDelBusy(false)
    setDelErrs([])
    setDelDone([])
  }
  const doDel = () => {
    if (!sp || delBusy) return
    const meta = delMetaReel
    const titre = sp.title || 'Publication'
    const lab = (l: { shopName?: string; channel: string }[] | undefined) => (l || []).map((e) => `${e.shopName ? `${e.shopName} · ` : ''}${e.channel}`)
    setDelBusy(true)
    setDelErrs([])
    supprimerPost(sp, meta)
      .then((r) => {
        if (!r?.ok) {
          setDelBusy(false)
          setDelDone((x) => x.concat(lab(r?.supprimees)))
          setDelErrs((r?.erreurs || []).map((e) => ({ text: `${e.shopName ? `${e.shopName} · ` : ''}${e.channel} — ${e.reason}` })))
          return
        }
        if (sp.origin === 'meta') setMp((x) => (x ? { ...x, posts: x.posts.filter((p) => p.id !== sp.id) } : x))
        else void charger()
        const tout = (r.supprimees || []).concat(delDone.map((x) => ({ channel: /Instagram$/.test(x) ? 'Instagram' : 'Facebook', shopName: x })))
        const nb = (c: string) => tout.filter((e) => e.channel === c).length
        // Peu de publications : on les nomme ; beaucoup : on les compte par réseau.
        const ou =
          tout.length <= 3
            ? delDone.concat(lab(r.supprimees)).join(', ')
            : [nb('Facebook') ? `Facebook (${nb('Facebook')} Pages)` : '', nb('Instagram') ? `Instagram (${nb('Instagram')} comptes)` : ''].filter(Boolean).join(' et ')
        setDelOpen(false)
        setDelBusy(false)
        setDelErrs([])
        setDelDone([])
        setSelId(null)
        dire(`« ${titre} » supprimé${ou ? ` — retiré de ${ou}` : ''}${r.enLigne ? ` — ${r.enLigne} publication(s) restent en ligne` : ''}.`)
      })
      .catch((e: unknown) => {
        setDelBusy(false)
        setDelErrs([{ text: message(e) }])
      })
  }
  const openDup = () => {
    if (!sp) return
    setDupOpen(true)
    setDupDates([addDays(sp.date < TODAY ? TODAY : sp.date, 7)])
    setDupShops(shopsOf(sp).slice())
  }
  const doDup = () => {
    if (!sp || !dupDates.length || !dupShops.length) return
    const copies = dupDates.map((d, i) => ({ ...sp, id: `p${Date.now()}${i}`, date: d, shops: dupShops.slice(), status: 'Programmé', partial: null, error: null }))
    enregistrer({ posts: etat.posts.concat(copies) })
    journaliser('Duplication', `« ${sp.title} » dupliqué ×${copies.length}`)
    setDupOpen(false)
    dire(copies.length > 1 ? `${copies.length} copies créées.` : `${copies.length} copie créée.`)
  }

  const creerPost = (date?: string) => props.onCreerPost?.(date)
  const lienNouveau = pageSocial('SA Post.dc.html')

  const Nouveau = ({ primaire }: { primaire?: boolean }) =>
    props.onCreerPost ? (
      <button type="button" className={`btn${primaire ? ' btn--primary' : ''}`} onClick={() => creerPost()}>
        Nouveau post
      </button>
    ) : (
      <a className={`btn${primaire ? ' btn--primary' : ''}`} href={lienNouveau}>
        Nouveau post
      </a>
    )

  return (
    <div className="social-native cal">
      {avis ? (
        <p className="warning cal__avis">
          {avis}{' '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={effacerAvis}>
            Fermer
          </button>
        </p>
      ) : null}

      {alerts.length ? (
        <div className="cal__alerte">
          <span>
            {alerts.length} {alerts.length > 1 ? 'connexions à rétablir' : 'connexion à rétablir'} ·{' '}
            {alerts.map((a) => `${a.shop} : ${a.what.toLowerCase()} ${libelleConnexion(a.st).toLowerCase()}`).join(' · ')}
          </span>
          {props.onParametres ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={props.onParametres}>
              Rétablir les connexions →
            </button>
          ) : (
            <a href={pageSocial('SA Parametres.dc.html')}>Rétablir les connexions →</a>
          )}
        </div>
      ) : null}

      <div className="filters">
        <div className="filters__row">
          <span className="cal__periode">{periodTitle}</span>
          <span className="media__spacer" />
          <div className="seg" role="group" aria-label="Vue du calendrier">
            {(
              [
                ['month', 'Mois'],
                ['week', 'Semaine'],
                ['list', 'Liste'],
              ] as [Vue, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" className={vue === k ? 'is-on' : ''} aria-pressed={vue === k} onClick={() => setVue(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="cal__nav">
            <button type="button" className="btn btn--sm btn--icon" title="Précédent" onClick={() => shift(-1)}>
              ‹
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setCurseur(TODAY)}>
              Aujourd'hui
            </button>
            <button type="button" className="btn btn--sm btn--icon" title="Suivant" onClick={() => shift(1)}>
              ›
            </button>
          </div>
          <Nouveau primaire />
        </div>
      </div>

      <div className="kpi-row cal__kpis">
        <button
          type="button"
          className="kpi cal__kpi"
          onClick={() => {
            setFStatus('Programmé')
            setVue('list')
          }}
        >
          <div className="kpi__value">{next7}</div>
          <div className="kpi__label">Programmés · 7 jours</div>
          <div className="kpi__note">posts</div>
        </button>
        <button
          type="button"
          className={`kpi cal__kpi${toVal ? ' is-or' : ''}`}
          onClick={() => {
            setFStatus('À valider')
            setVue('list')
          }}
        >
          <div className={`kpi__value${toVal ? ' is-moyen' : ''}`}>{toVal}</div>
          <div className="kpi__label">À valider</div>
          <div className="kpi__note">propositions des boutiques</div>
        </button>
        <button
          type="button"
          className={`kpi cal__kpi${fails ? ' is-alerte-bord' : ''}`}
          onClick={() => {
            setFType('')
            setVue('list')
            setFStatus(all.some((p) => p.status === 'Échec') ? 'Échec' : 'Partiel')
          }}
        >
          <div className={`kpi__value${fails ? ' is-alerte' : ''}`}>{fails}</div>
          <div className="kpi__label">Échecs à traiter</div>
          <div className="kpi__note">dont partiels</div>
        </button>
        <div className={`kpi cal__kpi${nGaps ? ' is-or' : ''}`}>
          <div className={`kpi__value${nGaps ? ' is-alerte' : ' is-bon'}`}>{nGaps}</div>
          <div className="kpi__label">Boutiques sans post</div>
          <div className="kpi__note">sur 7 jours</div>
        </div>
      </div>

      <div className="filters">
        <div className="filters__row cal__filtres">
          <span className="cal__etiquette">Boutiques</span>
          {SHOPS.map((sh) => {
            const on = fShops.includes(sh.id)
            return (
              <button
                key={sh.id}
                type="button"
                className={`cal__puce${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => setFShops(on ? fShops.filter((x) => x !== sh.id) : fShops.concat(sh.id))}
              >
                {sh.name}
              </button>
            )
          })}
          <span className="cal__sep" />
          <select value={fNet} onChange={(e) => setFNet(e.target.value)} aria-label="Réseau">
            <option value="">Facebook et Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
          </select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Type">
            <option value="">Tous les types</option>
            {POST_TYPES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Statut">
            <option value="">Tous les statuts</option>
            <option value="Brouillon">Brouillon</option>
            <option value="À valider">À valider</option>
            <option value="Programmé">Programmé</option>
            <option value="Publié">Publié</option>
            <option value="Partiel">Publication partielle</option>
            <option value="Échec">Échec</option>
            <option value="Dark post">Dark post (pub uniquement)</option>
          </select>
          <select value={fCamp} onChange={(e) => setFCamp(e.target.value)} aria-label="Opération">
            <option value="">Toutes opérations</option>
            <option value="none">Hors opération</option>
            {camps.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {hasFilters ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>
              Effacer
            </button>
          ) : null}
          <span className="media__spacer" />
          <span className="muted cal__compte">
            {inPeriod.length}
            {inPeriod.length > 1 ? ' posts' : ' post'} sur la période
          </span>
        </div>
        <div className="filters__row cal__filtres">
          <span className="cal__etiquette">Comptes</span>
          {comptes.map((c) => {
            const on = fAcc.includes(c.key)
            const ig = c.type === 'instagram'
            const tip = `${ig ? 'Instagram' : 'Page Facebook'} · ${c.name}${c.shop === 'marque' ? ' (marque)' : c.shop ? ` (${nomBoutique(c.shop)})` : ''}${c.erreur ? ` — ${c.erreur}` : ''} — cliquer pour filtrer`
            return (
              <button
                key={c.key}
                type="button"
                title={tip}
                className={`cal__compte-puce${on ? ' is-on' : ''}${c.erreur ? ' is-erreur' : ''}${fAcc.length && !on ? ' is-estompe' : ''}`}
                aria-pressed={on}
                onClick={() => setFAcc(on ? fAcc.filter((x) => x !== c.key) : fAcc.concat(c.key))}
              >
                <span className="cal__profil">
                  <img src={c.picture || avatar(c.name, c.type)} alt="" />
                  <span className={`cal__reseau${ig ? ' is-ig' : ''}`}>{ig ? '◎' : 'f'}</span>
                </span>
                <span>{ig && c.username ? `@${c.username}` : c.name}</span>
                <span className="cal__nb">{nParCompte[c.key] || 0}</span>
              </button>
            )
          })}
          <span className="media__spacer" />
          <span className={`cal__mpnote${mpEnErreur ? ' is-alerte' : ' muted'}`} title={mp ? (mp.erreurs || []).join('\n') : mpErr}>
            {mpNote}
          </span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={mpLoading}
            title="Relit chez Meta les publications et la programmation de toutes les Pages et de tous les comptes Instagram pour la période affichée (rien n’est copié en base)."
            onClick={() => setRelire((n) => n + 1)}
          >
            {mpLoading ? 'Lecture…' : 'Actualiser'}
          </button>
        </div>
      </div>

      <div className="cal__corps">
        <section className="cal__zone">
          {isEmpty ? (
            <div className="card cal__vide">
              <img src={imageSocial('img/illus/decorative/bubble.png')} alt="" />
              <span>Aucun post sur cette période</span>
              <span className="muted">Aucun post ne correspond aux filtres choisis. Élargissez les filtres ou planifiez un nouveau post.</span>
              <div className="cal__actions">
                <button type="button" className="btn" onClick={clearFilters}>
                  Effacer les filtres
                </button>
                <Nouveau />
              </div>
            </div>
          ) : null}

          {!isEmpty && vue === 'month' ? (
            <>
              <div className="card cal__mois">
                <div className="cal__dow">
                  {DOW.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
                <div className="cal__grille">
                  {cells.map((c) => {
                    const posts = filtered.filter((p) => p.date === c.d)
                    const gap = c.gp.length > 0 && !fShops.length
                    return (
                      <div
                        key={c.d}
                        className={`cal__cellule${c.inMonth ? '' : ' is-hors'}${c.d < TODAY ? ' is-passe' : ''}${dragOver === c.d ? ' is-cible' : ''}`}
                        {...jour(c.d)}
                      >
                        <div className="cal__cellule-tete">
                          <span className={`cal__num${c.d === TODAY ? ' is-auj' : ''}`}>{c.day}</span>
                          {gap ? (
                            <span className="cal__trou" title={`Sans post : ${c.gp.join(', ')}`}>
                              {c.gp.length > 1 ? `${c.gp.length} sans post` : `${c.gp[0] || ''} sans post`}
                            </span>
                          ) : null}
                        </div>
                        {posts.map((p) => (
                          <div key={p.id} className={`cal__carte ${classeCarte(p)}`} title={tipOf(p)} onClick={() => setSelId(p.id)} {...glisser(p)}>
                            <img src={imgOf(p)} alt="" />
                            <span className="cal__carte-texte">
                              <span className="cal__carte-meta">
                                <span className="cal__point" style={{ background: DOT[statutDe(p)] }} />
                                {p.time} · {shortShops(p)}
                              </span>
                              <span className="cal__carte-titre">{p.title}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
              <p className="muted cal__aide">Glissez une carte vers un autre jour pour la déplacer. Les posts publiés sont verrouillés.</p>
            </>
          ) : null}

          {!isEmpty && vue === 'week' ? (
            <div className="cal__semaine">
              {weekCols.map((c) => {
                const posts = filtered.filter((p) => p.date === c.d)
                const gap = c.gp.length > 0 && !fShops.length
                return (
                  <div key={c.d} className={`card cal__colonne${dragOver === c.d ? ' is-cible' : ''}`} {...jour(c.d)}>
                    <div className="cal__colonne-tete">
                      <span className="muted">{c.dow}</span>
                      <span className={c.d === TODAY ? 'is-alerte' : ''}>{c.day}</span>
                      {gap ? (
                        <span className="cal__trou">
                          {c.gp.length} boutique{c.gp.length > 1 ? 's' : ''} sans post
                        </span>
                      ) : null}
                    </div>
                    {posts.map((p) => {
                      const st = STATUS[statutDe(p)] ?? STATUS.Brouillon
                      return (
                        <div key={p.id} className={`cal__carte cal__carte--haute ${classeCarte(p)}`} onClick={() => setSelId(p.id)} {...glisser(p)}>
                          <div className="cal__vignette">
                            <img src={imgOf(p)} alt="" />
                          </div>
                          <div className="cal__carte-texte">
                            <span className="cal__carte-meta">
                              {p.time} · {p.type}
                            </span>
                            <span className="cal__carte-titre">{p.title}</span>
                            <span className="muted cal__petit">{shopsLabel(p)}</span>
                            <span className="cal__statut" style={{ background: st.bg, color: st.fg }}>
                              {stLabel(p)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ) : null}

          {!isEmpty && vue === 'list' ? (
            <section className="card table-card">
              <div className="table-scroll">
                <table className="table cal__liste">
                  <thead>
                    <tr>
                      {LIST_HEAD.map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inPeriod.map((p) => {
                      const st = STATUS[statutDe(p)] ?? STATUS.Brouillon
                      return (
                        <tr key={p.id} className={selId === p.id ? 'is-sel' : ''} onClick={() => setSelId(p.id)}>
                          <td>{dLabel(p.date)}</td>
                          <td>{p.time}</td>
                          <td>
                            <img className="cal__mini" src={imgOf(p)} alt="" />
                          </td>
                          <td>{p.title}</td>
                          <td className="muted">{p.type}</td>
                          <td>{shopsLabel(p)}</td>
                          <td className="muted">{channelsShort(p)}</td>
                          <td className="muted">{p.campaign ? parId(camps, p.campaign)?.name : '—'}</td>
                          <td>
                            <span className="cal__statut" style={{ background: st.bg, color: st.fg }}>
                              {stLabel(p)}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </section>

        <aside className="cal__cote">
          {sp ? (
            <Fiche
              sp={sp}
              etat={etat}
              serveur={serveur}
              ps={ps}
              retrying={retrying}
              img={imgOf(sp)}
              stLabel={stLabel(sp)}
              shopsLabel={shopsLabel(sp)}
              shopsOf={shopsOf}
              onFermer={() => setSelId(null)}
              onRetry={retry}
              onApprove={approve}
              onReject={reject}
              onOp={setOp}
              onCtrl={toCtrl}
              onDel={openDel}
              onDup={openDup}
              props={props}
            />
          ) : null}

          <div className="card cal__couverture">
            <div className="cal__couverture-tete">
              <span>Posts prévus par boutique</span>
              <span className="muted">
                du {dShort(g0)} au {dShort(g1)}
              </span>
            </div>
            {coverage.map((cv) => (
              <div key={cv.id} className="cal__couverture-ligne">
                <span className="cal__couverture-nom">{cv.name}</span>
                <span className="cal__carres">
                  {cv.days.map((dd) => (
                    <span key={dd.d} className={dd.cls} title={dd.tip} />
                  ))}
                </span>
                <span className="muted">{cv.n}</span>
              </div>
            ))}
            <span className="muted cal__petit">Un carré par jour · rouge = post prévu · abricot = à valider</span>
          </div>

          <div className="cal__legende">
            {LEGENDE.map(([n, c]) => (
              <span key={n}>
                <span className="cal__point" style={{ background: c }} />
                {n}
              </span>
            ))}
          </div>
        </aside>
      </div>

      {delOpen && sp ? (
        <div className="cal__voile" onClick={() => !delBusy && setDelOpen(false)}>
          <div className="card cal__modale" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="cal__modale-tete">
              <span>Supprimer « {sp.title} » ?</span>
              <span className="muted">
                {delKind === 'meta'
                  ? 'Publiée hors du module : elle sera supprimée chez Meta. C’est définitif.'
                  : delKind === 'publie'
                    ? 'Ce post est publié. Choisissez s’il doit aussi disparaître des réseaux.'
                    : 'Le post sera retiré du calendrier et de la file de publication. Rien n’a encore été publié chez Meta.'}
              </span>
            </div>
            {delWhere ? (
              <div className="cal__encadre">
                <span className="muted">En ligne :</span> {delWhere}
              </div>
            ) : null}
            {delKind === 'publie' ? (
              <div className="cal__choix">
                <label className={delMeta ? 'is-on' : ''}>
                  <input type="radio" name="delmode" checked={delMeta} onChange={() => setDelMeta(true)} />
                  <span>
                    <span>Supprimer aussi de Facebook et d’Instagram</span>
                    <span className="muted">Définitif : la publication disparaît des Pages et des comptes, avec ses commentaires et ses réactions.</span>
                  </span>
                </label>
                <label className={!delMeta ? 'is-on' : ''}>
                  <input type="radio" name="delmode" checked={!delMeta} onChange={() => setDelMeta(false)} />
                  <span>
                    <span>Retirer seulement du module</span>
                    <span className="muted">La publication reste en ligne ; le calendrier la montrera ensuite comme publiée hors du module.</span>
                  </span>
                </label>
              </div>
            ) : null}
            {delAdsVus.map((a) => (
              <span key={a.id} className="warning">
                Utilisé par la publicité « {a.name} » ({a.status}) : le supprimer chez Meta arrête cette annonce.
              </span>
            ))}
            {delDone.length ? <span className="is-bon cal__petit">Déjà supprimé : {delDone.join(', ')}</span> : null}
            {delErrs.length ? (
              <div className="cal__erreurs">
                <span>Meta a refusé — le post reste au calendrier :</span>
                {delErrs.map((e, i) => (
                  <span key={i}>{e.text}</span>
                ))}
                <span className="muted">Sans la suppression par l’API, supprimez-la dans Meta Business Suite, puis « Retirer seulement du module ».</span>
              </div>
            ) : null}
            <div className="cal__actions cal__actions--fin">
              <button type="button" className="btn" disabled={delBusy} onClick={() => setDelOpen(false)}>
                Annuler
              </button>
              <button type="button" className="btn btn--primary" disabled={delBusy} onClick={doDel}>
                {delBusy ? 'Suppression…' : delErrs.length ? 'Réessayer' : delMetaReel ? 'Supprimer définitivement' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dupOpen && sp ? (
        <div className="cal__voile" onClick={() => setDupOpen(false)}>
          <div className="card cal__modale" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="cal__modale-tete">
              <span>Dupliquer « {sp.title} »</span>
              <span className="muted">Une copie par date, ciblant les boutiques choisies. Les copies sont créées au statut Programmé, à {sp.time}.</span>
            </div>
            <div className="cal__bloc">
              <span className="cal__etiquette">Dates</span>
              <div className="cal__dates">
                {dupDates.map((d) => (
                  <span key={d} className="cal__date">
                    {dLabel(d)}
                    <button type="button" aria-label="Retirer" onClick={() => setDupDates(dupDates.filter((x) => x !== d))}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="date"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (v && !dupDates.includes(v)) setDupDates(dupDates.concat(v).sort())
                  }}
                />
              </div>
            </div>
            <div className="cal__bloc">
              <span className="cal__etiquette">Boutiques</span>
              <div className="cal__cases">
                {SHOPS.map((sh) => {
                  const on = dupShops.includes(sh.id)
                  return (
                    <label key={sh.id}>
                      <input type="checkbox" checked={on} onChange={() => setDupShops(on ? dupShops.filter((x) => x !== sh.id) : dupShops.concat(sh.id))} />
                      {sh.name}
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="cal__actions cal__actions--fin">
              <button type="button" className="btn" onClick={() => setDupOpen(false)}>
                Annuler
              </button>
              <button type="button" className="btn btn--primary" disabled={!dupDates.length || !dupShops.length} onClick={doDup}>
                Créer {dupDates.length}
                {dupDates.length > 1 ? ' copies' : ' copie'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="cal__toast">{toast}</div> : null}
    </div>
  )
}

interface FicheProps {
  sp: PostCal
  etat: EtatSocial
  serveur: Serveur
  ps: Chiffres
  retrying: boolean
  img: string
  stLabel: string
  shopsLabel: string
  shopsOf: (p: PostCal) => string[]
  onFermer: () => void
  onRetry: () => void
  onApprove: () => void
  onReject: () => void
  onOp: (v: string | null) => void
  onCtrl: () => void
  onDel: () => void
  onDup: () => void
  props: CalendrierViewProps
}

/** Le panneau du post choisi : ses informations, ses chiffres (publication Meta) et ses gestes. */
function Fiche({ sp, etat, serveur, ps, retrying, img, stLabel, shopsLabel, shopsOf, onFermer, onRetry, onApprove, onReject, onOp, onCtrl, onDel, onDup, props }: FicheProps) {
  const meta = sp.origin === 'meta'
  const k = statutDe(sp)
  const st = STATUS[k] ?? STATUS.Brouillon
  const camps = etat.campaigns
  const partiel = k === 'Partiel' && sp.partial
  const nomKo = (shop: string) => (shop === 'marque' ? (sp.marque ? 'Marque' : 'Instagram du réseau') : parId(etat.shops, shop)?.name ?? shop)
  const langs = meta
    ? '—'
    : [...new Set(shopsOf(sp).flatMap((id) => languesDe(etat, id)))].map((L) => L.toUpperCase() + (L === 'nl' && !sp.textNl && sp.text ? ' (texte manquant)' : '')).join(' · ')
  const when = meta
    ? `${dLabel(sp.date)} · ${sp.time}${sp.status === 'Programmé' ? ' (programmé dans Meta Business Suite)' : ''}`
    : sp.dark
      ? `Créé le ${dLabel(sp.date)} · jamais publié sur la Page`
      : `${dLabel(sp.date)} · ${sp.time}`
  const channels = meta ? String(sp.channel ?? '') : sp.dark ? 'Publicité uniquement (dark post)' : [sp.fb ? 'Facebook' : '', sp.ig ? 'Instagram' : ''].filter(Boolean).join(' + ')
  const produit = (serveur.catalogue ?? []).find((x) => typeof x.name === 'string' && sp.title.indexOf(x.name) >= 0) as Parameters<typeof remplir>[4]
  const texte = meta ? sp.text || '' : remplir(etat, serveur, sp.text || '', shopsOf(sp)[0], produit)
  // Contrôle : posts déjà publiés par une boutique (sur sa Page hors module, ou depuis l'espace franchisé).
  const canCtrl =
    sp.status === 'Publié' && (meta ? !sp.marque && (Array.isArray(sp.shops) ? sp.shops : []).length === 1 : sp.origin === 'franchise') && !sp.dark
  const stt = sp.stats ?? {}
  const parts = meta
    ? [
        stt.reactions != null ? `${fmt(stt.reactions)}${sp.ig ? ' j’aime' : ' réactions'}` : '',
        stt.comments != null ? `${fmt(stt.comments)} commentaires` : '',
        stt.shares != null ? `${fmt(stt.shares)} partages` : '',
      ].filter(Boolean)
    : []

  // Chiffres de la publication (lus à l'ouverture) : vues en tête, puis l'engagement.
  let tuiles: { label: string; value: string; tip: string }[] = []
  let noteChiffres = ''
  let noteTip = ''
  if (meta && sp.status === 'Publié') {
    const c = ps && ps.id === sp.id ? ps : { loading: true as const }
    const enLecture = 'loading' in c && !!c.loading
    const n = (v: number | null | undefined) => (enLecture ? '…' : v == null ? '—' : fmt(v))
    const or = (a: number | null | undefined, b: number | null | undefined) => (a != null ? a : b)
    const v = c as ChiffresPost & { err?: string }
    const t: [string, number | null | undefined, string][] = [
      ['Vues', v.vues, 'Nombre de fois où la publication a été vue (« vues » Meta, ex-impressions)'],
      [sp.ig ? 'Comptes touchés' : 'Personnes touchées', v.personnes, 'Personnes différentes qui ont vu la publication'],
      [sp.ig ? 'J’aime' : 'Réactions', or(v.reactions, stt.reactions), ''],
      ['Commentaires', or(v.commentaires, stt.comments), ''],
      ['Partages', or(v.partages, stt.shares), ''],
      sp.ig ? ['Enregistrements', v.enregistrements, ''] : ['Clics', v.clics, 'Clics sur la publication (lien, photo, « voir plus »…)'],
    ]
    if (v.videos) t.push(['Vues de la vidéo', v.videos, ''])
    tuiles = t.map(([label, val, tip]) => ({ label, value: n(val), tip }))
    const motif = v.err ? `Chiffres illisibles : ${v.err}` : v.motif || ''
    noteTip = motif
    noteChiffres = /read_insights|instagram_manage_insights/.test(motif)
      ? `Vues indisponibles : le token Meta n’a pas la permission ${sp.ig ? 'instagram_manage_insights' : 'read_insights'}.`
      : motif
  }

  const lienModif = pageSocial('SA Post.dc.html', `id=${encodeURIComponent(sp.id)}`)
  const libModif = sp.status === 'Publié' ? 'Voir' : 'Modifier'

  return (
    <div className="card cal__fiche">
      <div className="cal__fiche-image">
        <img src={img} alt="" />
        <button type="button" className="btn btn--icon cal__fermer" title="Fermer" onClick={onFermer}>
          ×
        </button>
      </div>
      <div className="cal__fiche-corps">
        <div className="cal__fiche-tags">
          <span className="cal__statut" style={{ background: st.bg, color: st.fg }}>
            {stLabel}
          </span>
          <span className="muted cal__petit">{sp.type}</span>
        </div>
        <span className="cal__fiche-titre">{sp.title}</span>
        <div className="cal__fiche-grille">
          <span className="muted">Date</span>
          <span>{when}</span>
          <span className="muted">Boutiques</span>
          <span>{shopsLabel}</span>
          <span className="muted">Canaux</span>
          <span>{channels}</span>
          <span className="muted">Langues</span>
          <span>{langs}</span>
          <span className="muted">Opération</span>
          <select value={sp.campaign || ''} title="Rattacher ce post à une campagne du Marketing" onChange={(e) => onOp(e.target.value || null)}>
            <option value="">— aucune —</option>
            {camps.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.status === 'terminée' ? ' (terminée)' : o.boStatusCode === 'draft' ? ' (brouillon)' : ''}
              </option>
            ))}
          </select>
          {meta ? (
            <>
              <span className="muted">Compte</span>
              <span>
                {sp.accountName || ''}
                {sp.marque ? ' · marque' : ''}
              </span>
            </>
          ) : null}
          {parts.length > 0 && sp.status !== 'Publié' ? (
            <>
              <span className="muted">Réactions</span>
              <span>{parts.join(' · ')}</span>
            </>
          ) : null}
          {!meta && sp.author ? (
            <>
              <span className="muted">Proposé par</span>
              <span>{sp.author}</span>
            </>
          ) : null}
        </div>

        {tuiles.length ? (
          <div className="cal__tuiles-bloc">
            <div className="cal__tuiles">
              {tuiles.map((t, i) => (
                <div key={t.label} className={`cal__tuile${i ? '' : ' is-tete'}`} title={t.tip}>
                  <span className="cal__tuile-val">{t.value}</span>
                  <span className="cal__tuile-lib">{t.label}</span>
                </div>
              ))}
            </div>
            {noteChiffres ? (
              <span className="muted cal__petit" title={noteTip}>
                {noteChiffres}
              </span>
            ) : null}
          </div>
        ) : null}

        {texte ? <p className="cal__texte">{texte}</p> : null}

        {!meta && sp.status === 'Échec' ? (
          <div className="cal__erreurs">
            <span>Échec de publication</span>
            <span>{sp.error || ''}</span>
          </div>
        ) : null}
        {!meta && partiel && sp.partial ? (
          <div className="cal__erreurs">
            <span>
              Publié sur {sp.partial.ok.length} Pages sur {sp.partial.ok.length + sp.partial.ko.length}
            </span>
            {sp.partial.ko.map((x, i) => (
              <span key={i}>
                {nomKo(x.shop)} · {x.channel} — {x.reason}
              </span>
            ))}
          </div>
        ) : null}
        {retrying ? <span className="muted cal__petit">Relance en cours…</span> : null}

        <div className="cal__actions">
          {!meta && (sp.status === 'Échec' || k === 'Partiel') && !retrying ? (
            <button type="button" className="btn btn--sm btn--primary" onClick={onRetry}>
              Relancer
            </button>
          ) : null}
          {!meta && sp.status === 'À valider' ? (
            <>
              <button type="button" className="btn btn--sm btn--primary" onClick={onApprove}>
                Approuver
              </button>
              <button type="button" className="btn btn--sm" onClick={onReject}>
                Renvoyer en brouillon
              </button>
            </>
          ) : null}
          {!meta && sp.dark ? (
            props.onCreerPub ? (
              <button type="button" className="btn btn--sm" onClick={() => props.onCreerPub?.(sp.id)}>
                Créer la publicité →
              </button>
            ) : (
              <a className="btn btn--sm" href={pageSocial('SA Publicites.dc.html', `new=1&post=${encodeURIComponent(sp.id)}`)}>
                Créer la publicité →
              </a>
            )
          ) : null}
          {meta ? (
            <a className="btn btn--sm" href={sp.permalink || '#'} target="_blank" rel="noopener noreferrer">
              Voir sur {sp.channel} ↗
            </a>
          ) : props.onOuvrirPost ? (
            <button type="button" className="btn btn--sm" onClick={() => props.onOuvrirPost?.(sp.id)}>
              {libModif}
            </button>
          ) : (
            <a className="btn btn--sm" href={lienModif}>
              {libModif}
            </a>
          )}
          {!meta ? (
            <button type="button" className="btn btn--sm" onClick={onDup}>
              Dupliquer
            </button>
          ) : null}
          {/* Un dark post vit chez Meta pour ses publicités : il se retire depuis l'écran Publicités. */}
          {!sp.dark ? (
            <button type="button" className="btn btn--sm btn--danger" title="Supprimer le post — et, s’il est en ligne, de Facebook et d’Instagram" onClick={onDel}>
              Supprimer
            </button>
          ) : null}
          {canCtrl ? (
            <button type="button" className="btn btn--sm" title="Annoter ce post et l’envoyer à la boutique comme non conforme" onClick={onCtrl}>
              Contrôler →
            </button>
          ) : null}
        </div>
        {meta ? (
          <span className="muted cal__petit">
            Publiée hors du module (Meta Business Suite, application…) : lue en direct chez Meta. Elle ne se modifie pas ici, mais peut être supprimée.
          </span>
        ) : null}
      </div>
    </div>
  )
}
