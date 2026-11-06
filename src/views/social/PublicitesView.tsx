import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './social.css'
import './publicites.css'
import { MONTHS, addDays, argent, daysBetween, dLabel, dShort, devSym, eur, fmt, pct } from '../../lib/social/format'
import { AD_STATUS, imageSocial } from '../../lib/social/refs'
import { charger, effacerAvis, enregistrer, journaliser, libelleBoutiques, parId, rattacher, useSocial } from '../../lib/social/store'
import type { EtatSocial, Objet, Serveur } from '../../lib/social/store'
import { languesDe, pageSocial, remplir, uniquesReseau } from '../../lib/social/ecrans'
import {
  BOUTONS,
  CATEGORIES_SPECIALES,
  CENTRE_PAR_DEFAUT,
  ENCHERES_AVEC_MONTANT,
  GRAPH_BASE,
  LIBELLES_BOUTONS,
  OBJECTIFS,
  PLATEFORMES,
  STRATEGIES_ENCHERE,
  VERSION_API_DEFAUT,
  cents,
} from '../../lib/social/meta-refs'
import {
  enregistrerRegles,
  importerCampagnesMeta,
  lireCommentaires,
  lireComptesPub,
  lireDemandes,
  lireMeilleurs,
  lireRegles,
  masquerCommentaire,
  refuserDemande,
} from '../../lib/social/api-publicites'
import type { CommentaireDark, ComptesPub, DarkPost, Demandes, ImportMeta, Meilleurs, PostBoost, ReglesPause } from '../../lib/social/api-publicites'

export interface PublicitesViewProps {
  /** « Gérer les formulaires de leads → » : l'écran Leads du module. */
  onGererFormulaires?: () => void
}

/** Une publicité de l'état du module (créée ici, ou campagne récupérée chez Meta : `origin: 'meta'`). */
interface Pub extends Objet {
  name: string
  campaign?: string | null
  objective: string
  metaObjective?: string
  shops: string[]
  scope?: string
  budgetType?: string
  budget: number
  cap?: number | null
  spent: number
  start: string
  end?: string | null
  status: string
  radius?: number | null
  post?: string | null
  leadForm?: string | null
  dark?: boolean
  variants?: number
  devise?: string
  spec?: Assistant
  origin?: string
  reason?: string | null
  note?: string | null
  gone?: boolean
  insights?: { impressions?: number; reach?: number; clicks?: number; ctr?: number | null; cpc?: number | null; cpm?: number | null; frequency?: number | null; engagement?: number | null; videoViews?: number | null; leads?: number | null }
  clicks?: number | null
  impressions?: number | null
  account?: string
  accountName?: string
  thumb?: string
  lienMeta?: string
  syncedAt?: string
  nAds?: number
  nAdsets?: number
  stats?: { variant: string; impressions: number; clicks: number; ctr: number | null; spend: number }[]
  ab?: { statut?: string; texte?: string } | null
  autoPause?: { texte?: string; le?: string } | null
  autoPauseLevee?: boolean
  boost?: Boost | null
  budgetDemande?: number
}

interface Boost {
  metaId: string
  compte: string
  canal: string
  shop: string | null
  titre: string
  img: string | null
  permalink: string | null
  date: string
  demande: number | null
}

interface Variante {
  post: string
  message: string
  headline: string
  messageNl: string
  headlineNl: string
}

/** Les réglages de l'assistant (gardés tels quels sur la pub, `spec`, pour la reprendre). */
interface Assistant {
  name: string
  campaign: string
  account: 'boutique' | 'reseau'
  objective: string
  special: string[]
  budgetLevel: 'adset' | 'campaign'
  bid: string
  bidAmount: number
  spendCap: number
  status: 'PAUSED' | 'ACTIVE'
  goal: string
  dest: string
  budgetType: 'daily' | 'lifetime'
  amount: number
  start: string
  end: string
  shops: string[]
  radius: Record<string, number>
  ageMin: number
  ageMax: number
  gender: 'all' | 'men' | 'women'
  interests: string[]
  platforms: string[]
  advantage: boolean
  dsaB: string
  dsaP: string
  crea: 'existing' | 'new'
  post: string | null
  message: string
  headline: string
  messageNl: string
  headlineNl: string
  description: string
  lang: 'shop' | 'fr' | 'nl' | 'both'
  link: string
  cta: string
  urlTags: string
  leadForm: string
  adName: string
  adStatus: 'PAUSED' | 'ACTIVE'
  pixel: boolean
  variants: Variante[]
  boost?: Boost | null
}

/** Un post du module (pour le choix du visuel). */
interface PostPub extends Objet {
  title: string
  date: string
  status: string
  img?: string
  text?: string
  textNl?: string
  dark?: boolean
  shops?: string[] | 'all'
  frise?: { tiles?: unknown[] }
  media?: { kind?: string }[]
  montage?: { kind?: string; m?: { title?: string } }
}

interface Bst {
  tab: 'demandes' | 'meilleurs' | null
  show: boolean
  meilleurs: Meilleurs | null
  demandes: Demandes | null
  loading: boolean
  err: string
}

type Edit = { pauseActive: boolean; seuils: Record<string, { cpcMax: string | number; depenseMin: string | number }> }

const STATUTS: Record<string, [string, string][]> = {
  Active: [
    ['Active', 'Active'],
    ['En pause', 'Mettre en pause'],
    ['Arrêtée', 'Arrêter'],
  ],
  'En pause': [
    ['En pause', 'En pause'],
    ['Active', 'Reprendre'],
    ['Arrêtée', 'Arrêter'],
  ],
  'En revue': [
    ['En revue', 'En revue'],
    ['En pause', 'Mettre en pause'],
    ['Arrêtée', 'Arrêter'],
  ],
  'Budget épuisé': [
    ['Budget épuisé', 'Budget épuisé'],
    ['En pause', 'Mettre en pause'],
    ['Arrêtée', 'Arrêter'],
  ],
}
const ORDRE: Record<string, number> = { Refusée: 0, 'Budget épuisé': 1, 'En revue': 2, Active: 3, 'En pause': 4, Arrêtée: 5, Terminée: 6 }
const LANG_PUB: [Assistant['lang'], string][] = [
  ['shop', 'Selon la boutique'],
  ['fr', 'Français'],
  ['nl', 'Néerlandais'],
  ['both', 'Les deux'],
]
const INTERETS = ['Boulangerie', 'Pâtisserie', 'Brunch', 'Cuisine maison', 'Famille', 'Bio et local', 'Café', 'Anti-gaspillage']
const ETAPES: [string, string][] = [
  ['Campagne', 'campaigns'],
  ['Ad set', 'adsets'],
  ['Créa', 'adcreatives'],
  ['Pub', 'ads'],
  ['Récapitulatif', 'POST ×4'],
]
const BULLE = 'img/illus/decorative/bubble.png'

const param = (k: string) => new URLSearchParams(window.location.search).get(k)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'erreur'

/** Le format de pub qu'un post du module donne (comme le serveur : frise et panorama en carrousel à ordre fixe). */
function formatDe(p: PostPub | null | undefined) {
  if (!p) return { kind: 'image', n: 1, locked: false, label: 'Image' }
  if (p.frise && Array.isArray(p.frise.tiles) && p.frise.tiles.length === 3) return { kind: 'carousel', n: 3, locked: true, label: 'Carrousel 3 · ordre fixe' }
  const media = p.media || []
  const vid = media.some((m) => m.kind === 'video')
  const imgs = media.filter((m) => m.kind !== 'video').length
  const pano = !!(p.montage && p.montage.kind === 'pano')
  if (vid) return { kind: 'video', n: 1, locked: false, label: 'Vidéo' }
  if (imgs > 1) return { kind: 'carousel', n: Math.min(10, imgs), locked: pano, label: `Carrousel ${Math.min(10, imgs)}${pano ? ' · ordre fixe' : ''}` }
  return { kind: 'image', n: 1, locked: false, label: 'Image' }
}

/**
 * Publicités Meta — l'écran « Publicités » du module Social, réécrit dans le Marketing
 * (docs/PORTAILS.md, étape 2f). Les pubs créées ici et les campagnes récupérées chez Meta, leur
 * pilotage (statut, budget, plafond, opération), la règle de pause automatique, les posts à booster
 * (demandes des boutiques, meilleurs posts de la semaine), les dark posts et leurs commentaires, et
 * l'assistant de création en cinq étapes (campagne → ad set → créa → pub → récapitulatif). La pub
 * s'enregistre dans l'état du module (`POST /state`) : c'est le serveur qui la crée chez Meta.
 */
export default function PublicitesView({ onGererFormulaires }: PublicitesViewProps = {}) {
  const { etat, serveur, erreur, chargement, avis } = useSocial()
  if (chargement === 'attente') return <p className="muted">Lecture du module Social…</p>
  if (!etat || !serveur) return <p className="error">Module Social illisible : {erreur}</p>
  return <Publicites etat={etat} serveur={serveur} avis={avis} onGererFormulaires={onGererFormulaires} />
}

function Publicites({ etat, serveur, avis, onGererFormulaires }: { etat: EtatSocial; serveur: Serveur; avis: string | null; onGererFormulaires?: () => void }) {
  const TODAY = serveur.today
  const [selId, setSelId] = useState<string | null>(() => param('ad'))
  const [act, setAct] = useState<'active' | 'inactive' | 'all'>(() => (param('ad') ? 'all' : 'active'))
  const [src, setSrc] = useState<'all' | 'module' | 'meta'>(() => (param('src') === 'meta' ? 'meta' : 'all'))
  const [wizOpen, setWizOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [w, setW] = useState<Assistant | null>(null)
  const [err, setErr] = useState('')
  const [replaceId, setReplaceId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const toastT = useRef<number | undefined>(undefined)
  const boostT = useRef<number | undefined>(undefined)
  const [imp, setImp] = useState(false)
  const [importLu, setImportLu] = useState<ImportMeta | null>(null)
  const [comptesLus, setComptesLus] = useState<ComptesPub | null>(null)
  const [darkLus, setDarkLus] = useState<DarkPost[] | null>(null)
  const [com, setCom] = useState<{ ad: string; list: CommentaireDark[]; open: boolean; loading: boolean } | null>(null)
  const [bud, setBud] = useState<{ id: string; budget: number | string; cap: number | string } | null>(null)
  const [bst, setBst] = useState<Bst>({ tab: null, show: true, meilleurs: null, demandes: null, loading: false, err: '' })
  const [refus, setRefus] = useState<{ id: number; txt: string } | null>(null)
  const [reg, setReg] = useState<ReglesPause | null>(null)
  const [regEdit, setRegEdit] = useState<Edit | null>(null)
  const [regOpen, setRegOpen] = useState(false)
  const [regErr, setRegErr] = useState('')
  const [regSaving, setRegSaving] = useState(false)

  const dire = useCallback((m: string) => {
    window.clearTimeout(toastT.current)
    setToast(m)
    toastT.current = window.setTimeout(() => setToast(''), 3200)
  }, [])
  useEffect(
    () => () => {
      window.clearTimeout(toastT.current)
      window.clearTimeout(boostT.current)
    },
    [],
  )

  // ---- Référentiels du compte (lus dans etat.meta, jamais inventés) ----
  const metaEtat = etat.meta as EtatSocial['meta'] & { comptes?: ComptesPub; geo?: Record<string, [number, number]> }
  const IDS = metaEtat.ids ?? {}
  const RESEAU_ACC = metaEtat.networkAccount || ''
  const COMPTES: ComptesPub = comptesLus ?? metaEtat.comptes ?? {}
  const VERSION = metaEtat.version || VERSION_API_DEFAUT
  const DSA = metaEtat.dsa ?? {}
  const SHOPS = etat.shops.filter((x) => !x.test)
  const GEO = (sid: string): [number, number] => metaEtat.geo?.[sid] ?? CENTRE_PAR_DEFAUT
  const DARK: DarkPost[] = darkLus ?? ((serveur.darkPosts as unknown as DarkPost[]) || [])
  const IMPORT = importLu ?? ((serveur.metaImport as ImportMeta | null) || null)
  const nomBoutique = (id: string) => parId(etat.shops, id)?.name ?? id
  const nLangues = (lang: string | undefined, id: string) => (lang === 'fr' || lang === 'nl' ? 1 : lang === 'both' ? 2 : Math.max(1, languesDe(etat, id).length))

  const ads = etat.ads as unknown as Pub[]
  const posts = etat.posts as unknown as PostPub[]
  const camps = etat.campaigns

  // ---- Chargements ----
  /** « À booster » : les demandes des boutiques et les meilleurs posts de la semaine (lus chez Meta, gardés deux heures). */
  const loadBoost = useCallback(async (forcer: boolean) => {
    setBst((b) => ({ ...b, loading: true, err: '' }))
    const [dm, mb] = await Promise.all([
      lireDemandes().catch((e: unknown) => ({ erreur: message(e) })),
      lireMeilleurs(forcer).catch((e: unknown) => ({ erreur: message(e) })),
    ])
    const dmE = 'erreur' in dm ? dm.erreur : ''
    const mbE = 'erreur' in mb ? mb.erreur : ''
    setBst((b) => ({
      ...b,
      loading: false,
      demandes: dmE ? null : (dm as Demandes),
      meilleurs: mbE ? null : (mb as Meilleurs),
      err: [dmE ? `Demandes illisibles : ${dmE}` : '', mbE ? `Publications illisibles : ${mbE}` : ''].filter(Boolean).join(' · '),
      tab: b.tab || (!dmE && (dm as Demandes).attente ? 'demandes' : 'meilleurs'),
    }))
  }, [])

  const importMeta = async () => {
    if (imp) return
    setImp(true)
    try {
      const r = (await importerCampagnesMeta()) ?? {}
      setImportLu(r)
      await charger()
      const nc = (r.comptes || []).length
      const e = r.erreurs || []
      setImp(false)
      if (r.importees) setSrc('meta')
      dire(
        `${r.total ?? 0} campagne(s) Meta relue(s) dans ${nc} compte(s) — ${r.importees ?? 0} nouvelle(s), ${r.majs ?? 0} mise(s) à jour${r.disparues ? `, ${r.disparues} disparue(s)` : ''}.${e.length ? ` ${e.length} erreur(s) : voir sous les filtres.` : ''}`,
      )
    } catch (e) {
      setImp(false)
      dire(`Récupération impossible : ${message(e)}`)
    }
  }

  // ---- Assistant ----
  const assistantNeuf = (c: string, postId?: string | null): Assistant => {
    const radius: Record<string, number> = {}
    SHOPS.forEach((s) => (radius[s.id] = 8))
    const camp = c ? parId(camps, c) : null
    // Sans boutique dotée de son propre compte publicitaire, la pub passe par le compte réseau : un ad set par
    // boutique cochée (sa zone, sa Page). Les boutiques se cochent à l'étape 2 ; depuis un post, celles du post.
    const p = postId ? posts.find((x) => x.id === postId) : null
    const propres = etat.shops.filter((s) => s.ads === 'connected' && !s.test).map((s) => s.id)
    const account: Assistant['account'] = propres.length || !RESEAU_ACC ? 'boutique' : 'reseau'
    const pShops = p ? (p.shops === 'all' ? SHOPS.map((s) => s.id) : p.shops || []) : []
    const shops = account === 'boutique' ? propres : p ? SHOPS.map((s) => s.id).filter((id) => pShops.includes(id)) : []
    let a: Assistant = {
      name: `${camp ? camp.name : 'Campagne'} · trafic`,
      campaign: c || '',
      account,
      objective: 'OUTCOME_TRAFFIC',
      special: [],
      budgetLevel: 'adset',
      bid: 'LOWEST_COST_WITHOUT_CAP',
      bidAmount: 0.6,
      spendCap: 400,
      status: 'PAUSED',
      goal: 'LINK_CLICKS',
      dest: 'WEBSITE',
      budgetType: 'daily',
      amount: 10,
      start: addDays(TODAY, 1),
      end: addDays(TODAY, 15),
      shops,
      radius,
      ageMin: 25,
      ageMax: 60,
      gender: 'all',
      interests: ['Boulangerie', 'Brunch'],
      platforms: ['facebook', 'instagram'],
      advantage: false,
      dsaB: DSA.beneficiary ?? '',
      dsaP: DSA.payor ?? '',
      crea: 'existing',
      post: null,
      message: '',
      headline: '',
      messageNl: '',
      headlineNl: '',
      description: '',
      lang: 'shop',
      link: 'https://www.latelierby.be',
      cta: 'ORDER_NOW',
      urlTags: `utm_source=facebook&utm_medium=paid&utm_campaign=${c || 'hors-campagne'}`,
      leadForm: '',
      adName: '',
      adStatus: 'PAUSED',
      pixel: true,
      variants: [],
    }
    // Ouvert depuis « Créer un post » : le post choisi, ses textes ; un dark post part en « Dark post ».
    if (p) {
      const sid0 = shops[0] || SHOPS[0]?.id
      const title = p.montage?.m?.title || p.title || ''
      a = {
        ...a,
        crea: p.dark ? 'new' : 'existing',
        post: p.id,
        name: `${title} · ${p.dark ? 'dark post' : 'post sponsorisé'}`,
        message: remplir(etat, serveur, p.text || '', sid0, null, 'fr'),
        messageNl: remplir(etat, serveur, p.textNl || '', sid0, null, 'nl'),
        headline: title,
        adName: title + (p.dark ? ' · dark post' : ' · sponsorisé'),
      }
    }
    return a
  }
  const ouvrir = (a: Assistant, remplace: string | null = null) => {
    setW(a)
    setStep(1)
    setErr('')
    setReplaceId(remplace)
    setWizOpen(true)
    // Devise et minimums du compte, relus chez Meta au plus toutes les 12 h (le serveur les garde).
    lireComptesPub()
      .then((c) => c && setComptesLus(c))
      .catch(() => {})
  }
  const openWiz = (c: string, postId?: string | null) => ouvrir(assistantNeuf(c, postId))

  /** Booster un post de la Page ou de l'Instagram : l'assistant s'ouvre prérempli (engagement, la boutique du post). */
  const openBoost = (b: PostBoost, demande: number | null) => {
    const a = assistantNeuf('')
    const sh = b.shop ? etat.shops.find((x) => x.id === b.shop) : null
    const propre = !!(sh && sh.ads === 'connected' && !sh.test)
    const titre = String(b.titre || 'Publication').slice(0, 60)
    const eng = OBJECTIFS.find((o) => o.id === 'OUTCOME_ENGAGEMENT')
    ouvrir({
      ...a,
      account: b.shop ? (propre ? 'boutique' : 'reseau') : a.account,
      shops: b.shop ? [b.shop] : a.shops,
      crea: 'existing',
      post: null,
      variants: [],
      objective: 'OUTCOME_ENGAGEMENT',
      goal: eng ? eng.goals[0] : 'POST_ENGAGEMENT',
      dest: eng ? eng.dest[0] : 'ON_AD',
      cta: 'LEARN_MORE',
      interests: [],
      boost: {
        metaId: b.metaId,
        compte: b.compte,
        canal: b.canal,
        shop: b.shop || null,
        titre: b.titre || '',
        img: b.img || null,
        permalink: b.permalink || null,
        date: b.date || b.datePost || '',
        demande: demande || null,
      },
      name: `Boost · ${titre}`,
      adName: `Boost · ${titre}`,
      urlTags: 'utm_source=facebook&utm_medium=paid&utm_campaign=boost',
    })
  }
  // Une pub que Meta n'a pas créée : l'assistant rouvert avec ses réglages ; à l'envoi, la nouvelle remplace l'ancienne.
  const reprendre = (a: Pub) => {
    const spec = a.spec as Assistant
    // « Itinéraire » était le bouton par défaut du trafic : avec un lien vers un site, « Commander ».
    const cta = spec.cta === 'GET_DIRECTIONS' && spec.dest === 'WEBSITE' ? { cta: 'ORDER_NOW' } : {}
    ouvrir({ ...assistantNeuf(spec.campaign || ''), ...spec, adName: spec.adName || a.name, ...cta }, a.id)
  }

  // Ouverture : `?ad=` (suivi), `?new=1&c=&post=` (assistant), `?importer=1`.
  const monte = useRef(false)
  useEffect(() => {
    if (monte.current) return
    monte.current = true
    if (param('new')) openWiz(param('c') || '', param('post'))
    if (param('importer')) void importMeta()
    void loadBoost(false)
    lireRegles()
      .then(setReg)
      .catch(() => {
        /* le bouton reste « Pause auto » */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveRegles = async () => {
    const e = regEdit
    if (!e || regSaving) return
    const seuils: ReglesPause['seuils'] = {}
    Object.keys(e.seuils).forEach((dv) => {
      const x = e.seuils[dv]
      if (Number(x.cpcMax) > 0) seuils[dv] = { cpcMax: Number(x.cpcMax), depenseMin: Number(x.depenseMin) }
    })
    setRegSaving(true)
    setRegErr('')
    try {
      const r = await enregistrerRegles({ pauseActive: !!e.pauseActive, seuils })
      setReg(r)
      setRegEdit(null)
      setRegSaving(false)
      setRegOpen(false)
      dire(r.pauseActive ? 'Règle activée : vérifiée à chaque relecture horaire des pubs.' : 'Règle désactivée : aucune pub n’est mise en pause automatiquement.')
    } catch (er) {
      setRegSaving(false)
      setRegErr(message(er))
    }
  }

  const refuser = async (id: number, txt: string) => {
    try {
      const dm = await refuserDemande(id, txt || '')
      setRefus(null)
      setBst((b) => ({ ...b, demandes: dm }))
      dire('Demande refusée : la boutique voit votre réponse.')
    } catch (e) {
      dire(`Refus impossible : ${message(e)}`)
    }
  }

  const comments = async (ad: Pub, sync: boolean) => {
    const garde = com && com.ad === ad.id ? com.list : []
    setCom({ ad: ad.id, list: garde, open: true, loading: true })
    try {
      const r = await lireCommentaires(ad.id, sync)
      if (r.darkPosts) setDarkLus(r.darkPosts)
      setCom({ ad: ad.id, list: r.comments || [], open: true, loading: false })
      if (sync) {
        const e = r.synchro?.erreurs || []
        dire(e.length ? `Relu, avec des erreurs : ${e.join(' · ')}` : `${r.synchro ? r.synchro.lus ?? 0 : 0} commentaire(s) relu(s) chez Meta.`)
      }
    } catch (e) {
      setCom({ ad: ad.id, list: [], open: true, loading: false })
      dire(`Lecture des commentaires impossible : ${message(e)}`)
    }
  }
  const hideComment = async (c: CommentaireDark) => {
    try {
      await masquerCommentaire(c.id, !c.hidden)
      setCom((x) => (x ? { ...x, list: x.list.map((y) => (y.id === c.id ? { ...y, hidden: !c.hidden } : y)) } : x))
      dire(c.hidden ? 'Commentaire réaffiché.' : 'Commentaire masqué : son auteur et ses amis le voient encore, plus personne d’autre.')
    } catch (e) {
      dire(`Meta a refusé : ${message(e)}`)
    }
  }

  const upd = (id: string, patch: Partial<Pub>, logMsg?: string) => {
    enregistrer({ ads: etat.ads.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
    if (logMsg) journaliser('Publicité', logMsg)
  }

  // ---- Liste ----
  // Une campagne Meta sans date de fin court « en continu » : son total courant s'arrête à aujourd'hui.
  const endOf = (a: Pub) => a.end || (a.start > TODAY ? a.start : TODAY)
  const totalOf = (a: Pub) => (a.budgetType === 'quotidien' ? a.budget * (daysBetween(a.start, endOf(a)) + 1) : a.budget)
  const devOf = (a: Pub) => a.devise || (a.origin !== 'meta' && a.scope === 'reseau' ? COMPTES[RESEAU_ACC]?.devise : '') || 'EUR'
  const money = (a: Pub, v: number | null | undefined, dec = 0) => argent(v, devOf(a), dec)
  // Refusée avant toute création chez Meta : on la reprend dans l'assistant (la renvoyer telle quelle ne créerait rien).
  const nonCreee = (a: Pub) => a.origin !== 'meta' && !!a.spec && /^Non créée chez Meta/.test(a.reason || '')
  const period = (a: Pub) => `${dShort(a.start)} → ${a.end ? dShort(a.end) : 'en continu'}`
  // Actives par défaut ; « Non actives » = en pause, en revue, refusées, épuisées, arrêtées, terminées.
  const isAct = (a: Pub) => a.status === 'Active'
  const bySrc = (a: Pub) => src === 'all' || (src === 'meta') === (a.origin === 'meta')
  const byAct = (a: Pub) => act === 'all' || (act === 'active') === isAct(a)
  const sorted = ads.filter((a) => bySrc(a) && byAct(a)).sort((a, b) => (ORDRE[a.status] ?? 9) - (ORDRE[b.status] ?? 9) || b.start.localeCompare(a.start))
  const pilotable = (a: Pub) => !!STATUTS[a.status] && !a.gone && !nonCreee(a)
  const changerStatut = (a: Pub, v: string) => {
    if (v === a.status) return
    if (v === 'Arrêtée' && !window.confirm(`Arrêter « ${a.name} » ? Chez Meta, la campagne est archivée et ne pourra pas être relancée.`)) return
    upd(a.id, { status: v }, `« ${a.name} » : ${a.status} → ${v}`)
    dire(v === 'En pause' ? 'Mise en pause chez Meta.' : v === 'Active' ? 'Reprise chez Meta.' : 'Arrêtée chez Meta.')
  }
  // Le budget se change depuis la fiche (pas pour une pub non créée, arrêtée, terminée ou sans budget propre).
  const budEditable = (a: Pub) => !a.gone && !nonCreee(a) && a.budget > 0 && !['Refusée', 'Arrêtée', 'Terminée'].includes(a.status)
  const aRelancer = ads.filter(nonCreee)
  // Clics relus chez Meta (toutes les heures) : campagne récupérée de Meta (ses insights) ou pub créée ici (ses pubs cumulées).
  const clicsOf = (a: Pub) => {
    const ins = a.origin === 'meta' ? a.insights || {} : null
    const c = ins ? ins.clicks : a.clicks
    const im = ins ? ins.impressions : a.impressions
    if (c == null) return { clicks: '—', sub: a.status === 'Refusée' ? '' : 'relu toutes les heures', tip: 'Pas encore relu chez Meta' }
    const cpc = ins && ins.cpc != null ? ins.cpc : c > 0 && a.spent ? a.spent / c : null
    return {
      clicks: fmt(c),
      sub: c === 0 ? 'aucun clic' : [cpc != null ? `${money(a, cpc, 2)} / clic` : '', im ? pct(c / im, 1) : ''].filter(Boolean).join(' · '),
      tip: `${fmt(c)} clics${im ? ` pour ${fmt(im)} impressions (taux de clic ${pct(c / im, 2)})` : ''}${cpc != null ? ` · coût par clic ${money(a, cpc, 2)}` : ''}`,
    }
  }
  // Les comptes publicitaires n'ont pas tous la même devise : un total par devise.
  const sumMoney = (list: Pub[]) => {
    const by: Record<string, number> = {}
    list.forEach((a) => {
      const k = devOf(a)
      by[k] = (by[k] || 0) + (a.spent || 0)
    })
    const ks = Object.keys(by).sort((x, y) => (x === 'EUR' ? -1 : y === 'EUR' ? 1 : x.localeCompare(y)))
    return ks.length ? ks.map((k) => (k === 'EUR' ? eur(by[k]) : `${fmt(Math.round(by[k]))} ${k}`)).join(' + ') : eur(0)
  }
  const active = ads.filter(isAct)
  const monthAds = ads.filter((a) => endOf(a) >= `${TODAY.slice(0, 8)}01`)
  const nRefusees = ads.filter((a) => a.status === 'Refusée').length
  const nEpuise = ads.filter((a) => a.status === 'Budget épuisé').length

  const baseAct = ads.filter(bySrc)
  const nAct = baseAct.filter(isAct).length
  const baseSrc = ads.filter(byAct)
  const nMeta = baseSrc.filter((a) => a.origin === 'meta').length

  // ---- Suivi de la pub choisie ----
  const a = ads.find((x) => x.id === selId) ?? null

  // ---- Règle de pause : seuils par devise des comptes publicitaires ----
  const R = reg || { pauseActive: false, seuils: {} }
  const devs = Array.from(
    new Set(
      ['EUR'].concat(
        Object.values(COMPTES)
          .map((c) => c?.devise)
          .filter((x): x is string => !!x),
        Object.keys(R.seuils || {}),
        ads.filter((x) => x.origin !== 'meta').map(devOf),
      ),
    ),
  ).sort((x, y) => (x === 'EUR' ? -1 : y === 'EUR' ? 1 : x.localeCompare(y)))
  const ouvrirRegle = () => {
    setRegErr('')
    if (regOpen) {
      setRegOpen(false)
      setRegEdit(null)
      return
    }
    setRegOpen(true)
    setRegEdit({
      pauseActive: !!R.pauseActive,
      seuils: devs.reduce<Edit['seuils']>((o, dv) => {
        const x = R.seuils?.[dv]
        o[dv] = { cpcMax: x?.cpcMax || '', depenseMin: x?.depenseMin || 20 }
        return o
      }, {}),
    })
  }

  // ---- « À booster » ----
  const tab = bst.tab || 'meilleurs'
  const dm = bst.demandes || { demandes: [], attente: 0 }
  const mb = bst.meilleurs || { posts: [] as PostBoost[], erreurs: [] as string[] }
  const nb = (n: number, one: string, many: string) => `${fmt(n)} ${n > 1 ? many : one}`
  const factsM = (x: PostBoost) =>
    [x.interactions != null ? nb(x.interactions, 'interaction', 'interactions') : '', x.indice ? `×${String(x.indice).replace('.', ',')} son habitude` : '', x.date ? dShort(x.date) : '']
      .filter(Boolean)
      .join(' · ')
  const bstErr = [bst.err].concat((mb.erreurs || []).map((e) => `Meta : ${e}`)).filter(Boolean).join(' · ')
  const cartes = tab === 'demandes' ? dm.demandes : mb.posts

  const lienLeads = pageSocial('SA Leads.dc.html')

  return (
    <div className="social-native pub">
      {avis ? (
        <p className="warning pub__avis">
          {avis}{' '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={effacerAvis}>
            Fermer
          </button>
        </p>
      ) : null}

      <div className="filters">
        <div className="filters__row">
          <span className="muted pub__note">
            {IMPORT?.le
              ? `Dernière relecture Meta : ${dShort(IMPORT.le.slice(0, 10))} à ${IMPORT.le.slice(11, 16)} · ${(IMPORT.comptes || []).length} compte(s) pub`
              : 'Campagnes Meta jamais relues : cliquez pour récupérer celles de vos comptes publicitaires.'}
          </span>
          <span className="media__spacer" />
          <button
            type="button"
            className={`btn${R.pauseActive ? ' pub__regle-on' : ''}`}
            title="Mettre en pause automatiquement les pubs dont le coût par clic dépasse un seuil"
            onClick={ouvrirRegle}
          >
            <span className={`pub__point${R.pauseActive ? ' is-on' : ''}`} />
            {R.pauseActive ? 'Pause auto activée' : 'Pause auto'}
          </button>
          <button
            type="button"
            className={`btn${imp ? ' is-busy' : ''}`}
            title="Relit chez Meta les campagnes de vos comptes publicitaires (créées dans le Gestionnaire de publicités, par une agence…) et met à jour l’état et la dépense de toutes les pubs. Automatique toutes les heures."
            onClick={() => void importMeta()}
          >
            {imp ? 'Récupération…' : 'Récupérer les campagnes Meta'}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => openWiz('')}>
            Nouvelle publicité
          </button>
        </div>
      </div>

      <div className="kpi-row pub__kpis">
        <div className="kpi">
          <div className="kpi__value is-bon">{active.length}</div>
          <div className="kpi__label">Actives</div>
          <div className="kpi__note">{sumMoney(active)} dépensés</div>
        </div>
        <div className="kpi">
          <div className="kpi__value">{sumMoney(monthAds)}</div>
          <div className="kpi__label">Dépensé · pubs de {MONTHS[Number(TODAY.slice(5, 7)) - 1]}</div>
          <div className="kpi__note">cumul des pubs en cours ce mois-ci, tous comptes</div>
        </div>
        <div className="kpi">
          <div className="kpi__value is-moyen">{ads.filter((x) => x.status === 'En revue').length}</div>
          <div className="kpi__label">En revue Meta</div>
          <div className="kpi__note">validation en cours</div>
        </div>
        <div className={`kpi${nRefusees ? ' pub__kpi-alerte' : ''}`}>
          <div className="kpi__value is-alerte">{nRefusees}</div>
          <div className="kpi__label">Refusées</div>
          <div className="kpi__note">à corriger</div>
        </div>
        <div className={`kpi${nEpuise ? ' pub__kpi-or' : ''}`}>
          <div className="kpi__value is-alerte">{nEpuise}</div>
          <div className="kpi__label">Budget épuisé</div>
          <div className="kpi__note">diffusion suspendue</div>
        </div>
      </div>

      <div className="filters">
        <div className="filters__row pub__filtres">
          {(
            [
              ['active', `Actives (${nAct})`],
              ['inactive', `Non actives (${baseAct.length - nAct})`],
              ['all', `Toutes (${baseAct.length})`],
            ] as [typeof act, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" className={`pub__puce${act === id ? ' is-on' : ''}${id === 'active' ? ' is-vert' : ''}`} aria-pressed={act === id} onClick={() => setAct(id)}>
              <span className={`pub__point is-${id}`} />
              {label}
            </button>
          ))}
          <span className="pub__sep" />
          {(
            [
              ['all', `Toutes sources (${baseSrc.length})`],
              ['module', `Créées ici (${baseSrc.length - nMeta})`],
              ['meta', `Récupérées de Meta (${nMeta})`],
            ] as [typeof src, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" className={`pub__puce${src === id ? ' is-on' : ''}`} aria-pressed={src === id} onClick={() => setSrc(id)}>
              {label}
            </button>
          ))}
          {IMPORT?.erreurs?.length ? <span className="is-alerte pub__petit">Dernière relecture : {IMPORT.erreurs.join(' · ')}</span> : null}
        </div>
      </div>

      {aRelancer.map((x) => (
        <div key={x.id} className="pub__relancer">
          <span>
            <span>« {x.name} » n’a pas été créée chez Meta</span>
            <span className="pub__petit">{String(x.reason || '').replace(/^Non créée chez Meta — /, '')}</span>
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setSelId(x.id)
              reprendre(x)
            }}
          >
            Corriger et relancer
          </button>
        </div>
      ))}

      {regOpen && regEdit ? (
        <section className="card pub__regle">
          <div className="pub__bloc-tete">
            <span>Règle de pause automatique</span>
            <span className="muted pub__petit">
              {R.le ? `Réglée le ${dShort(R.le.slice(0, 10))} à ${R.le.slice(11, 16)}${R.par ? ` par ${R.par}` : ''}` : 'Jamais réglée : désactivée.'}
            </span>
          </div>
          <span className="muted pub__texte">
            Toutes les heures, à la relecture des pubs créées ici : une pub active dont le coût par clic dépasse le seuil, une fois la dépense minimale
            atteinte, est mise en pause chez Meta — le motif s’affiche dans son suivi. Reprise à la main, elle n’est plus jamais repausée. Ni les
            campagnes récupérées de Meta ni les pubs de notoriété (qui ne visent pas le clic) ne sont concernées. Les seuils se fixent par devise de
            compte publicitaire.
          </span>
          <label className="pub__case">
            <input type="checkbox" checked={regEdit.pauseActive} onChange={() => setRegEdit({ ...regEdit, pauseActive: !regEdit.pauseActive })} />
            Mettre en pause automatiquement les pubs trop chères
          </label>
          {devs.map((dv) => {
            const x = regEdit.seuils[dv] || { cpcMax: '', depenseMin: 20 }
            const setX = (patch: Partial<typeof x>) => setRegEdit((e) => (e ? { ...e, seuils: { ...e.seuils, [dv]: { ...x, ...patch } } } : e))
            const nA = ads.filter((y) => y.origin !== 'meta' && devOf(y) === dv && y.status === 'Active').length
            return (
              <div key={dv} className="pub__seuil">
                <span className="pub__devise">{dv}</span>
                <label>
                  Coût par clic au-delà de{' '}
                  <input type="number" min="0" step="0.05" value={x.cpcMax} placeholder="—" onChange={(e) => setX({ cpcMax: e.target.value })} />
                  {devSym(dv)}
                </label>
                <label>
                  une fois <input type="number" min="1" step="1" value={x.depenseMin} onChange={(e) => setX({ depenseMin: e.target.value })} />
                  {devSym(dv)} dépensés
                </label>
                <span className="muted pub__petit">
                  {Number(x.cpcMax) > 0 ? '' : 'vide : pas de règle · '}
                  {nA} pub(s) active(s) dans cette devise
                </span>
              </div>
            )
          })}
          {regErr ? <span className="error">{regErr}</span> : null}
          <div className="pub__actions">
            <button type="button" className="btn btn--sm" disabled={regSaving} onClick={() => void saveRegles()}>
              {regSaving ? 'Enregistrement…' : 'Enregistrer la règle'}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => {
                setRegOpen(false)
                setRegEdit(null)
                setRegErr('')
              }}
            >
              Fermer
            </button>
          </div>
        </section>
      ) : null}

      <section className="card pub__booster">
        <div className="pub__bloc-tete pub__bloc-tete--large">
          <div className="pub__bloc-titre">
            <span>À booster</span>
            <span className="muted pub__petit">
              {tab === 'demandes'
                ? 'Les publications que les boutiques vous proposent de booster, depuis le calendrier de leur espace. Vous décidez ; la pub part de leur compte publicitaire, ou du compte réseau.'
                : `La publication la plus engageante de chaque boutique ces 7 derniers jours, comparée à l’habitude de son compte${bst.meilleurs?.le ? ` · lu chez Meta le ${dShort(bst.meilleurs.le.slice(0, 10))} à ${bst.meilleurs.le.slice(11, 16)}` : ''}.`}
            </span>
          </div>
          <div className="pub__actions">
            {(
              [
                ['demandes', `Demandes des boutiques (${dm.attente || 0})`],
                ['meilleurs', `Meilleurs posts de la semaine (${(mb.posts || []).length})`],
              ] as ['demandes' | 'meilleurs', string][]
            ).map(([id, label]) => (
              <button key={id} type="button" className={`pub__puce${tab === id ? ' is-on' : ''}`} onClick={() => setBst((b) => ({ ...b, tab: id, show: true }))}>
                {label}
              </button>
            ))}
            <button
              type="button"
              className="btn btn--sm"
              disabled={bst.loading}
              title="Relit les publications de la semaine chez Meta (sinon gardées deux heures)"
              onClick={() => void loadBoost(true)}
            >
              {bst.loading ? 'Lecture chez Meta…' : 'Actualiser'}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setBst((b) => ({ ...b, show: !b.show }))}>
              {bst.show ? 'Masquer' : 'Afficher'}
            </button>
          </div>
        </div>
        {bst.show ? (
          <>
            {!cartes.length ? (
              <span className="muted pub__petit">
                {bst.loading && !bst.meilleurs
                  ? 'Lecture des publications de la semaine chez Meta…'
                  : tab === 'demandes'
                    ? 'Aucune demande des boutiques pour l’instant : elles proposent un post depuis le calendrier de leur espace.'
                    : 'Aucune publication mesurable cette semaine (rien de publié, ou Meta ne donne pas les interactions).'}
              </span>
            ) : null}
            {bstErr ? <span className="is-alerte pub__petit">{bstErr}</span> : null}
            <div className="pub__cartes">
              {tab === 'demandes'
                ? dm.demandes.map((x) => {
                    const refusing = refus?.id === x.id
                    const att = x.statut === 'attente'
                    return (
                      <div key={x.id} className={`pub__carte${att ? ' is-attente' : ''}`}>
                        <div className="pub__carte-tete">
                          <img src={x.img ? imageSocial(x.img) : imageSocial(BULLE)} alt="" />
                          <div>
                            <span className="muted pub__petit">
                              {x.shopNom} · {x.canal} · proposé le {dShort(String(x.le).slice(0, 10))}
                            </span>
                            <span className="pub__carte-titre">{x.titre}</span>
                            <span className="muted pub__petit">{x.datePost ? `Publié le ${dShort(x.datePost)}` : ''}</span>
                          </div>
                        </div>
                        {x.message ? (
                          <span className="pub__citation">
                            « {x.message} » — {x.par}
                          </span>
                        ) : null}
                        {!att ? (
                          <span className={`pub__tag${x.statut === 'boostee' ? ' is-vert' : ''}`}>
                            {x.statut === 'boostee' ? `Boostée${x.traitePar ? ` par ${x.traitePar}` : ''}` : `Refusée${x.reponse ? ` : ${x.reponse}` : ''}`}
                          </span>
                        ) : null}
                        {refusing ? (
                          <div className="pub__refus">
                            <input type="text" value={refus.txt} placeholder="Un mot pour la boutique (facultatif)" onChange={(e) => setRefus({ id: x.id, txt: e.target.value })} />
                            <div className="pub__actions">
                              <button type="button" className="btn btn--sm" onClick={() => void refuser(x.id, refus.txt)}>
                                Refuser la demande
                              </button>
                              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRefus(null)}>
                                Annuler
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <div className="pub__actions">
                          {att && !refusing ? (
                            <button type="button" className="btn btn--sm" onClick={() => openBoost(x, x.id)}>
                              Booster
                            </button>
                          ) : null}
                          {att && !refusing ? (
                            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRefus({ id: x.id, txt: '' })}>
                              Refuser
                            </button>
                          ) : null}
                          {x.permalink ? (
                            <a href={x.permalink} target="_blank" rel="noopener noreferrer" className="pub__petit">
                              Voir le post ↗
                            </a>
                          ) : null}
                        </div>
                      </div>
                    )
                  })
                : mb.posts.map((x) => (
                    <div key={`${x.compte}-${x.metaId}`} className="pub__carte">
                      <div className="pub__carte-tete">
                        <img src={x.img ? imageSocial(x.img) : imageSocial(BULLE)} alt="" />
                        <div>
                          <span className="muted pub__petit">
                            {x.shopNom} · {x.canal}
                          </span>
                          <span className="pub__carte-titre">{x.titre}</span>
                          <span className="muted pub__petit">{factsM(x)}</span>
                        </div>
                      </div>
                      {x.boostee ? <span className="pub__tag is-vert">Déjà boosté : « {x.boostee.nom} »</span> : null}
                      <div className="pub__actions">
                        <button type="button" className="btn btn--sm" onClick={() => openBoost(x, null)}>
                          {x.boostee ? 'Booster à nouveau' : 'Booster'}
                        </button>
                        {x.permalink ? (
                          <a href={x.permalink} target="_blank" rel="noopener noreferrer" className="pub__petit">
                            Voir le post ↗
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
            </div>
          </>
        ) : null}
      </section>

      <div className={`pub__corps${a ? ' has-sel' : ''}`}>
        <section className="card table-card pub__liste">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {['Publicité', 'Statut Meta', 'Clics', 'Budget', 'Dépensé / restant', 'Opération · boutiques'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((x) => {
                  const sc = AD_STATUS[x.status] || AD_STATUS.Active
                  const tot = Math.min(totalOf(x), x.cap || Infinity)
                  const p = posts.find((y) => y.id === x.post)
                  const ratio = tot ? x.spent / tot : 0
                  const isMeta = x.origin === 'meta'
                  const cl = clicsOf(x)
                  const hasReason = (!!x.reason && x.status === 'Refusée') || (!!x.note && (!isMeta || ['Active', 'En revue'].includes(x.status)))
                  const reason = x.status === 'Refusée' ? x.reason || '' : isMeta ? String(x.note || '').split(' : ')[0] : String(x.note || '')
                  return (
                    <tr key={x.id} className={x.id === selId ? 'is-sel' : ''} onClick={() => setSelId(x.id)}>
                      <td>
                        <span className="pub__nom">
                          <img src={imageSocial(p?.img || x.thumb || BULLE)} alt="" />
                          <span>
                            <span>{x.name}</span>
                            <span className="muted pub__petit">
                              {isMeta ? (
                                <span className="pub__tag pub__tag--meta" title="Créée hors du module, récupérée chez Meta">
                                  Meta
                                </span>
                              ) : null}
                              {x.objective}
                              {x.dark ? ' · dark post' : ''}
                              {(x.variants ?? 0) > 1 ? ` · ${x.variants} variantes` : ''}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>
                        {pilotable(x) ? (
                          <select
                            className="pub__statut-sel"
                            style={{ background: sc.bg, color: sc.fg }}
                            value={x.status}
                            title="Mettre en pause, reprendre ou arrêter chez Meta"
                            onChange={(e) => changerStatut(x, e.target.value)}
                          >
                            {(STATUTS[x.status] || []).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="pub__tag" style={{ background: sc.bg, color: sc.fg }}>
                            {x.status}
                          </span>
                        )}
                        {hasReason ? <span className="pub__raison">{reason}</span> : null}
                      </td>
                      <td title={cl.tip}>
                        <span className="pub__cellule">
                          <span>{cl.clicks}</span>
                          <span className="muted pub__petit">{cl.sub}</span>
                        </span>
                      </td>
                      <td>
                        <span className="pub__cellule">
                          <span>
                            {!x.budget ? (isMeta ? 'Budget dans les pubs' : '—') : x.budgetType === 'quotidien' ? `${money(x, x.budget)} / jour` : `${money(x, x.budget)} total`}
                          </span>
                          <span className="muted pub__petit">
                            {isMeta ? x.accountName || x.account || 'Compte Meta' : x.scope === 'reseau' ? 'Mutualisé réseau' : 'Par boutique'}
                          </span>
                          {budEditable(x) ? <span className="pub__lien pub__petit">Modifier ›</span> : null}
                        </span>
                      </td>
                      <td>
                        <span className="pub__cellule">
                          <span>{money(x, x.spent) + (tot ? ` / ${money(x, tot)} · reste ${money(x, Math.max(0, tot - x.spent))}` : ' dépensés')}</span>
                          <span className="pub__jauge">
                            <span className={ratio >= 0.9 && x.status === 'Active' ? 'is-or' : ''} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="pub__cellule">
                          <span>{x.campaign ? parId(camps, x.campaign)?.name : 'Hors opération'}</span>
                          <span className="muted pub__petit">{libelleBoutiques(etat, x.shops)}</span>
                          <span className="muted pub__petit">{period(x)}</span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {!sorted.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      {act === 'active' ? 'Aucune publicité active pour l’instant. Voir « Non actives » ou « Toutes ».' : act === 'inactive' ? 'Aucune publicité non active.' : 'Aucune publicité.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {a ? (
          <Suivi
            a={a}
            etat={etat}
            TODAY={TODAY}
            COMPTES={COMPTES}
            RESEAU_ACC={RESEAU_ACC}
            IDS={IDS}
            DARK={DARK}
            IMPORT={IMPORT}
            bud={bud}
            setBud={setBud}
            com={com && com.ad === a.id ? com : null}
            nLangues={nLangues}
            totalOf={totalOf}
            endOf={endOf}
            devOf={devOf}
            money={money}
            nonCreee={nonCreee}
            budEditable={budEditable}
            period={period}
            nomBoutique={nomBoutique}
            onFermer={() => setSelId(null)}
            upd={upd}
            dire={dire}
            reprendre={reprendre}
            comments={(sync) => void comments(a, sync)}
            fermerCommentaires={() => setCom((x) => (x ? { ...x, open: false } : x))}
            hideComment={(c) => void hideComment(c)}
          />
        ) : null}
      </div>

      {wizOpen && w ? (
        <Wizard
          w={w}
          setW={setW}
          step={step}
          setStep={setStep}
          err={err}
          setErr={setErr}
          etat={etat}
          serveur={serveur}
          TODAY={TODAY}
          COMPTES={COMPTES}
          RESEAU_ACC={RESEAU_ACC}
          IDS={IDS}
          VERSION={VERSION}
          DARK={DARK}
          GEO={GEO}
          totalOf={totalOf}
          nLangues={nLangues}
          lienLeads={lienLeads}
          onGererFormulaires={onGererFormulaires}
          onFermer={() => setWizOpen(false)}
          onEnvoyer={(ad, boost) => {
            // Reprise d'une pub que Meta n'a pas créée : la nouvelle remplace l'ancienne.
            enregistrer({ ads: etat.ads.filter((x) => x.id !== replaceId).concat(ad) })
            journaliser('Publicité', `« ${ad.name} » créée (${w.objective}${ad.dark ? ', dark post' : ''})`)
            if (boost?.demande) {
              window.clearTimeout(boostT.current)
              boostT.current = window.setTimeout(() => void loadBoost(false), 3000)
            }
            setWizOpen(false)
            setSelId(ad.id)
            dire(ad.status === 'En pause' ? 'Publicité créée en pause : activez-la quand vous êtes prêt.' : 'Publicité envoyée : en revue chez Meta.')
          }}
        />
      ) : null}

      {toast ? <div className="pub__toast">{toast}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Le suivi d'une publicité
// ---------------------------------------------------------------------------

interface SuiviProps {
  a: Pub
  etat: EtatSocial
  TODAY: string
  COMPTES: ComptesPub
  RESEAU_ACC: string
  IDS: Record<string, Record<string, string>>
  DARK: DarkPost[]
  IMPORT: ImportMeta | null
  bud: { id: string; budget: number | string; cap: number | string } | null
  setBud: (b: { id: string; budget: number | string; cap: number | string } | null) => void
  com: { ad: string; list: CommentaireDark[]; open: boolean; loading: boolean } | null
  nLangues: (lang: string | undefined, id: string) => number
  totalOf: (a: Pub) => number
  endOf: (a: Pub) => string
  devOf: (a: Pub) => string
  money: (a: Pub, v: number | null | undefined, dec?: number) => string
  nonCreee: (a: Pub) => boolean
  budEditable: (a: Pub) => boolean
  period: (a: Pub) => string
  nomBoutique: (id: string) => string
  onFermer: () => void
  upd: (id: string, patch: Partial<Pub>, logMsg?: string) => void
  dire: (m: string) => void
  reprendre: (a: Pub) => void
  comments: (sync: boolean) => void
  fermerCommentaires: () => void
  hideComment: (c: CommentaireDark) => void
}

function Suivi(P: SuiviProps) {
  const { a, etat, TODAY, money, devOf } = P
  const camps = etat.campaigns
  const sc = AD_STATUS[a.status] || AD_STATUS.Active
  const tot = Math.min(P.totalOf(a), a.cap || Infinity)
  const isMeta = a.origin === 'meta'
  const ins = a.insights || {}
  const acct = a.account || (a.scope === 'reseau' ? P.RESEAU_ACC : P.IDS[(a.shops || [])[0]]?.ad_account_id)
  const cptA = (acct && P.COMPTES[acct]) || {}
  const sp = a.spec
  const quot = a.budgetType === 'quotidien'
  const ed = P.bud && P.bud.id === a.id ? P.bud : { id: a.id, budget: a.budget, cap: a.cap || '' }
  const nSets = isMeta ? Math.max(1, a.nAdsets || 1) : Math.max(1, (sp?.shops || a.shops || []).reduce((x, id) => x + P.nLangues(sp?.lang, id), 0))
  const B = Number(ed.budget) || 0
  const C = Number(ed.cap) || 0
  const minTot = quot && cptA.minDaily ? cptA.minDaily * nSets : 0
  const change = Math.abs(B - (a.budget || 0)) > 0.004 || (C > 0 && C !== (a.cap || 0))
  const budErr =
    B <= 0
      ? 'Indiquez un montant.'
      : minTot && B < minTot - 0.004
        ? `Meta exige au moins ${money(a, cptA.minDaily, 2)} par jour et par ensemble : mettez au moins ${money(a, Math.ceil(minTot * 100) / 100, 2)} par jour (${nSets} ensemble${nSets > 1 ? 's' : ''}).`
        : C > 0 && cptA.minCap && C < cptA.minCap
          ? `Meta exige un plafond d’au moins ${money(a, cptA.minCap)} sur ce compte.`
          : ''
  const edit = (patch: Partial<typeof ed>) => P.setBud({ ...ed, ...patch })
  const saveBud = () => {
    if (!change || budErr) return
    const patch: Partial<Pub> = Math.abs(B - (a.budget || 0)) > 0.004 ? { budgetDemande: B } : {}
    if (C > 0 && C !== (a.cap || 0)) patch.cap = C
    P.upd(a.id, patch, `« ${a.name} » : budget ${money(a, a.budget)} → ${money(a, B)}${patch.cap ? `, plafond ${money(a, C)}` : ''}`)
    P.setBud(null)
    P.dire('Budget envoyé à Meta.')
  }
  // La dépense jour par jour n'est pas relue chez Meta : on montre la moyenne réelle face au budget du jour.
  const jours = Math.max(1, Math.min(daysBetween(a.start, P.endOf(a)) + 1, daysBetween(a.start, TODAY) + 1))
  const dailyCap = quot ? a.budget : tot / Math.max(1, daysBetween(a.start, P.endOf(a)) + 1)
  const moyenne = a.spent / jours
  const stats = Array.isArray(a.stats) ? a.stats : []
  const best = stats.reduce<(typeof stats)[number] | null>((b, x) => (x.ctr != null && x.impressions >= 300 && (!b || (b.ctr ?? 0) < x.ctr) ? x : b), null)
  const dark = P.DARK.filter((x) => x.ad === a.id)
  const multi = new Set(dark.map((x) => x.lang)).size > 1 || dark.some((x) => x.lang === 'nl')
  const nCom = dark.reduce((x, y) => x + (y.comments || 0), 0)
  const ab = a.ab || null
  const ap = a.autoPause
  const bo = a.boost || sp?.boost
  const quand = (t?: string) => (t ? `${dShort(String(t).slice(0, 10))} à ${String(t).slice(11, 16)}` : '')
  const metaFacts = isMeta
    ? [
        `${a.accountName ? `${a.accountName} · ` : ''}${a.account || ''}`,
        a.devise && a.devise !== 'EUR' ? `montants en ${a.devise}` : '',
        `${a.nAds || 0} pub(s) dans ${a.nAdsets || 0} ensemble(s)`,
        a.metaObjective || '',
        `relue ${a.syncedAt ? `le ${dShort(a.syncedAt.slice(0, 10))} à ${a.syncedAt.slice(11, 16)}` : '—'}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const metrics: [string, string][] = isMeta
    ? (
        [
          ['Impressions', fmt(ins.impressions || 0)],
          ['Couverture', fmt(ins.reach || 0)],
          ['Clics', fmt(ins.clicks || 0)],
          ['CTR', ins.ctr == null ? '—' : pct(ins.ctr, 2)],
          ['Coût / clic', ins.cpc == null ? '—' : money(a, ins.cpc, 2)],
          ['CPM', ins.cpm == null ? '—' : money(a, ins.cpm, 2)],
          ['Répétition', ins.frequency == null ? '—' : fmt(ins.frequency, 2)],
          ins.engagement != null ? ['Interactions', fmt(ins.engagement)] : null,
          ins.videoViews != null ? ['Vues vidéo', fmt(ins.videoViews)] : null,
          ins.leads != null ? ['Prospects', fmt(ins.leads)] : null,
        ] as ([string, string] | null)[]
      ).filter((x): x is [string, string] => !!x)
    : []
  const sym = devSym(devOf(a))
  const topUp = () =>
    isMeta
      ? P.upd(a.id, { cap: (a.cap || a.spent) + 100, status: 'Active' }, `« ${a.name} » : plafond relevé de 100`)
      : P.upd(a.id, { budgetDemande: a.budget + 100, cap: (a.cap || a.budget) + 100, status: 'Active' }, `« ${a.name} » : +100 ${sym} de budget`)
  const attach = (v: string | null) => {
    rattacher('ad', a.id, v)
      .then(() =>
        P.dire(v ? `Rattachée à « ${parId(camps, v)?.name || v} » : sa dépense et ses résultats Meta comptent dans le Retour sur opération.` : 'Détachée de l’opération.'),
      )
      .catch((e: unknown) => P.dire(`Rattachement impossible : ${message(e)}`))
  }
  const fixAd = () => {
    if (P.nonCreee(a)) {
      P.reprendre(a)
      return
    }
    P.upd(a.id, { status: 'En revue', reason: null }, `« ${a.name} » corrigée et resoumise`)
    P.dire('Publicité resoumise à Meta.')
  }
  const com = P.com
  const AB: Record<string, string> = { gagnante: 'is-vert', tendance: 'is-or', egalite: '', tot: '' }

  return (
    <aside className="card pub__suivi">
      <div className="pub__suivi-tete">
        <div>
          <span className="pub__suivi-nom">{a.name}</span>
          <span className="muted pub__petit">{[a.objective, a.radius ? `rayon ${a.radius} km` : '', isMeta ? P.period(a) : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="pub__actions">
          <span className="pub__tag" style={{ background: sc.bg, color: sc.fg }}>
            {a.status}
          </span>
          <button type="button" className="btn btn--icon" title="Fermer le suivi" aria-label="Fermer le suivi" onClick={P.onFermer}>
            ×
          </button>
        </span>
      </div>

      {P.budEditable(a) ? (
        <div className="pub__budget">
          <span>{(quot ? 'Budget quotidien' : 'Budget total') + (isMeta ? ' de la campagne' : '')}</span>
          <div className="pub__budget-ligne">
            <input type="number" min="0" step="0.5" value={ed.budget} onChange={(e) => edit({ budget: e.target.value })} />
            <span className="muted">{sym + (quot ? ' / jour' : ' au total')}</span>
            {(
              [
                ['−20 %', 0.8],
                ['+20 %', 1.2],
                ['+50 %', 1.5],
              ] as [string, number][]
            ).map(([label, f]) => (
              <button key={label} type="button" className="btn btn--sm" onClick={() => edit({ budget: Math.round(B * f * 100) / 100 })}>
                {label}
              </button>
            ))}
          </div>
          <label className="pub__budget-ligne">
            Plafond de dépense <input type="number" min="0" value={ed.cap} onChange={(e) => edit({ cap: e.target.value })} />
            <span className="muted">{sym}</span>
          </label>
          <span className="muted pub__petit">
            {(isMeta
              ? `Appliqué chez Meta au budget de la campagne, ou ${nSets > 1 ? `à ses ${nSets} ensembles au prorata de leur budget actuel.` : 'à son ensemble.'}`
              : `Réparti à parts égales entre ${nSets} ensemble${nSets > 1 ? 's' : ''} (boutiques et langues).`) +
              (quot && cptA.minDaily ? ` Minimum Meta : ${money(a, cptA.minDaily, 2)} par jour et par ensemble.` : '') +
              ' Plafond vide : inchangé.'}
          </span>
          {change && budErr ? <span className="error">{budErr}</span> : null}
          <button type="button" className="btn btn--sm btn--primary" disabled={!change || !!budErr} onClick={saveBud}>
            Appliquer chez Meta
          </button>
        </div>
      ) : null}
      {/^Meta : /.test(a.reason || '') && a.status !== 'Refusée' ? <span className="pub__alerte">{a.reason}</span> : null}

      <div className="pub__chiffres">
        <div className="suivi__fait">
          <span className="muted">Dépensé</span>
          <span>{money(a, a.spent)}</span>
        </div>
        <div className="suivi__fait">
          <span className="muted">Restant</span>
          <span>{tot ? money(a, Math.max(0, tot - a.spent)) : '—'}</span>
        </div>
      </div>
      <div className="pub__depense">
        <div className="pub__depense-tete">
          <span>Dépense quotidienne</span>
          <span className="muted">Plafond {a.cap ? money(a, a.cap) : '—'}</span>
        </div>
        <div className="pub__depense-ligne" title="Moyenne de la dépense relue chez Meta, rapportée aux jours de diffusion">
          <span className="pub__jauge">
            <span className={moyenne > dailyCap * 1.15 ? 'is-or' : ''} style={{ width: `${dailyCap ? Math.min(100, (moyenne / dailyCap) * 100) : 0}%` }} />
          </span>
          <span className="muted pub__petit">
            {a.spent ? `${money(a, moyenne, 2)} / jour en moyenne sur ${jours} jour${jours > 1 ? 's' : ''} · budget ${money(a, dailyCap, 2)} / jour` : 'Aucune dépense relue chez Meta.'}
          </span>
        </div>
      </div>
      {a.status === 'Active' && tot && a.spent / tot >= 0.85 ? (
        <span className="pub__alerte is-or">
          Alerte dépassement : {pct(a.spent / tot)}
          {a.cap ? ` du plafond consommé. La diffusion s’arrêtera automatiquement à ${money(a, a.cap)}.` : ' du budget prévu consommé.'}
        </span>
      ) : null}
      {a.status === 'Budget épuisé' ? <span className="pub__alerte">Budget épuisé : la diffusion est suspendue par Meta. Augmentez le budget ou arrêtez la publicité.</span> : null}
      {ap ? (
        <span className={`pub__alerte${a.autoPauseLevee ? ' is-neutre' : ' is-or'}`}>
          {a.autoPauseLevee ? `Reprise à la main après une pause automatique (${quand(ap.le)}) : la règle ne la repausera plus.` : `${ap.texte} — ${quand(ap.le)}.`}
        </span>
      ) : null}
      {bo ? (
        <span className="pub__alerte is-neutre">
          Post {bo.canal || ''} boosté : « {String(bo.titre || '').slice(0, 80)} »{bo.demande ? ', à la demande de la boutique.' : '.'}{' '}
          {bo.permalink ? (
            <a href={bo.permalink} target="_blank" rel="noopener noreferrer">
              Voir le post ↗
            </a>
          ) : null}
        </span>
      ) : null}
      {a.status === 'Refusée' ? (
        <span className="pub__alerte">
          <span>Refusée par Meta.</span> {a.reason || ''}
        </span>
      ) : null}

      <div className="pub__actions">
        {a.status === 'Active' ? (
          <button type="button" className="btn btn--sm" onClick={() => P.upd(a.id, { status: 'En pause' }, `« ${a.name} » mise en pause`)}>
            Mettre en pause
          </button>
        ) : null}
        {a.status === 'En pause' ? (
          <button type="button" className="btn btn--sm" onClick={() => P.upd(a.id, { status: 'Active' }, `« ${a.name} » reprise`)}>
            Reprendre
          </button>
        ) : null}
        {a.status === 'Budget épuisé' ? (
          <button type="button" className="btn btn--sm" onClick={topUp}>
            + 100 {sym}
            {isMeta ? ' de plafond' : ' de budget'}
          </button>
        ) : null}
        {a.status === 'Refusée' && !isMeta ? (
          <button type="button" className="btn btn--sm" onClick={fixAd}>
            {P.nonCreee(a) ? 'Corriger et relancer' : 'Corriger et resoumettre'}
          </button>
        ) : null}
        {['Active', 'En pause', 'Budget épuisé', 'En revue'].includes(a.status) ? (
          <button type="button" className="btn btn--sm btn--danger" onClick={() => P.upd(a.id, { status: 'Arrêtée' }, `« ${a.name} » arrêtée`)}>
            Arrêter
          </button>
        ) : null}
      </div>

      <label className="pub__champ">
        Campagne du Marketing (opération) — pour le Retour sur opération
        <select value={a.campaign || ''} onChange={(e) => attach(e.target.value || null)}>
          <option value="">Hors opération</option>
          {camps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.status === 'terminée' ? ' (terminée)' : ''}
            </option>
          ))}
        </select>
      </label>

      {isMeta ? (
        <div className="pub__encadre">
          <div className="pub__depense-tete">
            <span>Campagne Meta</span>
            <a href={a.lienMeta || '#'} target="_blank" rel="noopener noreferrer">
              Gestionnaire de publicités ↗
            </a>
          </div>
          <span className="muted pub__petit">{metaFacts}</span>
          {a.note || a.gone ? <span className="pub__petit pub__note-meta">{a.note || ''}</span> : null}
          <div className="pub__metriques">
            {metrics.map(([k, v]) => (
              <div key={k} className="suivi__fait">
                <span className="muted">{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
          <span className="muted pub__petit">
            Pause, reprise, arrêt, budget et plafond s’appliquent à la campagne chez Meta. Le reste (ciblage, créas) se règle dans le Gestionnaire de
            publicités ; relu toutes les heures.
          </span>
        </div>
      ) : null}

      {stats.length > 1 ? (
        <div className="pub__encadre">
          <span>Résultats par variante</span>
          <div className="pub__variantes">
            <span className="muted">Variante</span>
            <span className="muted">Impr.</span>
            <span className="muted">Clics</span>
            <span className="muted">CTR</span>
            <span className="muted">Dépense</span>
            {stats.map((x) => {
              const top = best && best.variant === x.variant
              return [
                <span key={`${x.variant}v`} className={top ? 'is-bon' : ''}>
                  {x.variant}
                  {top ? ' ★' : ''}
                </span>,
                <span key={`${x.variant}i`}>{fmt(x.impressions)}</span>,
                <span key={`${x.variant}c`}>{fmt(x.clicks)}</span>,
                <span key={`${x.variant}t`}>{x.ctr == null ? '—' : pct(x.ctr)}</span>,
                <span key={`${x.variant}s`}>{money(a, x.spend)}</span>,
              ]
            })}
          </div>
          {ab?.texte ? <span className={`pub__alerte ${AB[ab.statut || 'tot'] || ''}`}>{ab.texte}</span> : null}
        </div>
      ) : null}

      {a.dark ? (
        <div className="pub__encadre">
          <span>Dark posts · {dark.length || 'en attente'}</span>
          <span className="muted pub__petit">
            Visibles seulement en sponsorisé.{' '}
            {dark.length ? 'Relus chez Meta après la création de la pub (et toutes les heures).' : 'Ils apparaissent ici dès que Meta les a créés (relu toutes les heures).'}
          </span>
          {dark.map((x, i) => (
            <div key={`${x.post}-${x.shop}-${x.lang}-${i}`} className="pub__dark">
              <span>
                {P.nomBoutique(x.shop)}
                {multi ? ` · ${String(x.lang).toUpperCase()}` : ''}
                {(a.variants ?? 0) > 1 ? ` · ${x.variant}` : ''}
              </span>
              {x.link ? (
                <a href={x.link} target="_blank" rel="noopener noreferrer">
                  Facebook ↗
                </a>
              ) : null}
              {x.linkIg ? (
                <a href={x.linkIg} target="_blank" rel="noopener noreferrer">
                  Instagram ↗
                </a>
              ) : null}
              <span className="muted pub__petit">
                {x.comments ? `${x.comments} comm.${x.hidden ? ` (${x.hidden} masqué${x.hidden > 1 ? 's' : ''})` : ''}` : ''}
              </span>
            </div>
          ))}
          <div className="pub__actions">
            <button type="button" className="btn btn--sm" onClick={() => (com?.open ? P.fermerCommentaires() : P.comments(false))}>
              {com?.open ? 'Masquer les commentaires' : `Commentaires${nCom ? ` (${nCom})` : ''}`}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => P.comments(true)}>
              {com?.loading ? 'Lecture…' : 'Relire chez Meta'}
            </button>
          </div>
          {com?.open ? (
            <div className="pub__commentaires">
              {!com.loading && !com.list.length ? <span className="muted pub__petit">Aucun commentaire pour l’instant.</span> : null}
              {com.list.map((c) => (
                <div key={c.id} className={`pub__commentaire${c.hidden ? ' is-masque' : ''}`}>
                  <div className="pub__depense-tete">
                    <span className="pub__petit">
                      {c.author || 'Anonyme'} · {c.channel} · {c.shopName || ''}
                    </span>
                    <span className="muted pub__petit">{c.at ? `${dShort(c.at.slice(0, 10))} ${c.at.slice(11, 16)}` : ''}</span>
                  </div>
                  <span>{c.message}</span>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => P.hideComment(c)}>
                    {c.hidden ? 'Réafficher' : 'Masquer'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// L'assistant de création (campagne → ad set → créa → pub → récapitulatif)
// ---------------------------------------------------------------------------

interface WizardProps {
  w: Assistant
  setW: (w: Assistant) => void
  step: number
  setStep: (n: number) => void
  err: string
  setErr: (e: string) => void
  etat: EtatSocial
  serveur: Serveur
  TODAY: string
  COMPTES: ComptesPub
  RESEAU_ACC: string
  IDS: Record<string, Record<string, string>>
  VERSION: string
  DARK: DarkPost[]
  GEO: (sid: string) => [number, number]
  totalOf: (a: Pub) => number
  nLangues: (lang: string | undefined, id: string) => number
  lienLeads: string
  onGererFormulaires?: () => void
  onFermer: () => void
  onEnvoyer: (ad: Pub, boost: Boost | null | undefined) => void
}

function Wizard(P: WizardProps) {
  const { w, step, etat, serveur } = P
  const W = (patch: Partial<Assistant>) => {
    P.setW({ ...w, ...patch })
    P.setErr('')
  }
  const camps = etat.campaigns
  const ads = etat.ads as unknown as Pub[]
  const posts = etat.posts as unknown as PostPub[]
  const SHOPS = etat.shops.filter((x) => !x.test)
  const nom = (id: string) => parId(etat.shops, id)?.name ?? id
  const obj = OBJECTIFS.find((o) => o.id === w.objective) || OBJECTIFS[1]
  const special = w.special.length > 0
  const minR = special ? 15 : 1
  const propres = etat.shops.filter((sh) => sh.ads === 'connected' && !sh.test)
  const reseauAcc = P.RESEAU_ACC
  const ids = (sid: string) => P.IDS[sid] || {}
  // Meta compte dans la devise du compte publicitaire et refuse ce qui est sous ses minimums.
  const actW = w.account === 'reseau' ? reseauAcc : ids(w.shops[0] || SHOPS[0]?.id || '').ad_account_id
  const cpt = (actW && P.COMPTES[actW]) || {}
  const dev = cpt.devise || 'EUR'
  const m$ = (v: number | null | undefined, d = 0) => argent(v, dev, d)
  const sym = devSym(dev)
  const days = Math.max(1, daysBetween(w.start, w.end) + 1)
  const sid0 = w.shops[0] || SHOPS[0]?.id || ''
  // Comme le serveur : le montant se partage entre les ad sets du compte (une boutique bilingue en a deux).
  const nJeux = (l: string[]) => Math.max(1, l.reduce((x, id) => x + P.nLangues(w.lang, id), 0))
  const parJeux = nJeux(w.account === 'reseau' ? w.shops : [sid0])
  const capErr = () => {
    const parCamp = w.account === 'boutique' ? w.spendCap / Math.max(1, w.shops.length) : w.spendCap
    return w.spendCap > 0 && cpt.minCap && parCamp < cpt.minCap
      ? `Meta exige un plafond de dépense d’au moins ${m$(cpt.minCap)}${w.account === 'boutique' && w.shops.length > 1 ? ` par campagne, soit ${m$(cpt.minCap * w.shops.length)} pour ${w.shops.length} boutiques` : ''} sur ce compte : relevez-le ou videz le champ (pas de plafond).`
      : ''
  }
  const budErr = () => {
    if (!cpt.minDaily) return ''
    const min = w.budgetType === 'daily' ? cpt.minDaily : cpt.minDaily * days
    const unite = w.budgetType === 'daily' ? ' par jour' : ' au total'
    return w.amount / parJeux < min
      ? `Meta exige au moins ${m$(cpt.minDaily, 2)} par jour et par ad set sur ce compte : mettez au moins ${m$(Math.ceil(min * parJeux))}${unite}${parJeux > 1 ? ` (${parJeux} ad sets)` : ''}.`
      : ''
  }
  const perUnit = w.account === 'boutique' ? w.shops.length : 1
  const est = w.budgetType === 'daily' ? w.amount * days * perUnit : w.amount * perUnit
  const camp = w.campaign ? parId(camps, w.campaign) : null
  const campLeft = camp ? Number(camp.budget || 0) - ads.filter((x) => x.campaign === camp.id).reduce((x, y) => x + Math.min(P.totalOf(y), y.cap || Infinity), 0) : null
  // Estimation indicative du module (densité moyenne autour des boutiques) — pas l'estimation de Meta.
  const aud =
    w.shops.reduce((x, id) => x + Math.round(Math.PI * (w.radius[id] ?? 8) * (w.radius[id] ?? 8) * 210), 0) *
    ((w.ageMax - w.ageMin) / 47) *
    (w.gender === 'all' ? 1 : 0.5) *
    (w.advantage ? 1.35 : 1) *
    (1 - 0.06 * Math.max(0, w.interests.length - 1))
  const post = w.post ? posts.find((p) => p.id === w.post) ?? null : null
  const fmtP = formatDe(post)
  const diffused = (p: PostPub) => P.DARK.some((x) => x.post === p.id && x.story)
  // Les visuels proposés : posts publiés ou programmés (et dark posts déjà diffusés) pour sponsoriser ; tout post pour un dark post, les dark posts en tête.
  const pool = posts
    .filter((p) => (w.crea === 'existing' ? ['Publié', 'Programmé'].includes(p.status) || (p.dark && diffused(p)) : p.status !== 'Échec'))
    .sort((x, y) => (w.crea === 'new' ? (y.dark ? 1 : 0) - (x.dark ? 1 : 0) : 0) || y.date.localeCompare(x.date))
  const isLeads = w.objective === 'OUTCOME_LEADS'
  const leadForms = (etat.leadforms as (Objet & { status?: string; name?: string; version?: number })[]).filter((f) => f.status === 'Actif')
  const accFor = (sid: string) => (w.account === 'reseau' ? reseauAcc : ids(sid).ad_account_id)
  const promoted =
    isLeads || w.objective === 'OUTCOME_ENGAGEMENT'
      ? '{ page_id }'
      : w.objective === 'OUTCOME_SALES'
        ? `{ pixel_id: ${ids(sid0).pixel_id}, custom_event_type: PURCHASE }`
        : '—'
  // Langue de la pub : celle de chaque boutique (défaut), ou une langue choisie, ciblée par targeting.locales.
  const langue = w.lang || 'shop'
  const nlPour = () => (['nl', 'both'].includes(langue) ? w.shops.slice() : langue === 'fr' ? [] : w.shops.filter((id) => languesDe(etat, id).includes('nl')))
  const langHelp =
    {
      shop: 'Chaque boutique dans sa langue, réglée dans Paramètres › Groupes de boutiques. Une boutique bilingue reçoit une version par langue, chacune montrée aux personnes qui utilisent Facebook et Instagram dans cette langue ; une boutique d’une seule langue, une version montrée à tous.',
      fr: 'La pub en français, montrée aux seules personnes qui utilisent Facebook et Instagram en français, autour de chaque boutique cochée.',
      nl: 'La pub en néerlandais, montrée aux seules personnes qui utilisent Facebook et Instagram en néerlandais, autour de chaque boutique cochée. Le texte néerlandais se saisit à l’étape « Créa ».',
      both: 'Deux versions par boutique, français et néerlandais, chacune montrée aux personnes qui utilisent Facebook et Instagram dans sa langue. Le budget se partage entre elles.',
    }[langue] +
    (w.crea === 'existing' && langue !== 'shop' ? ' Avec un post existant, la pub le montre tel qu’il est publié : la langue règle seulement à qui il est montré.' : '')
  const langRecap =
    (LANG_PUB.find(([k]) => k === langue) || LANG_PUB[0])[1] +
    (langue === 'shop' ? ` · ${w.shops.map((id) => `${nom(id)} ${languesDe(etat, id).map((L) => L.toUpperCase()).join('+')}`).join(', ')}` : ' · ciblé par langue')
  const errFor = (n: number): string => {
    if (n === 1 && !w.name.trim()) return 'Nommez la campagne.'
    if (n === 1 && w.account === 'reseau' && capErr()) return capErr()
    if (n === 2 && !w.shops.length)
      return w.account === 'boutique' && !propres.length
        ? 'Aucune boutique n’a son propre compte publicitaire : revenez à l’étape 1 et choisissez « Compte réseau ».'
        : 'Cochez au moins une boutique dans « Boutiques et rayon de diffusion ».'
    if (n === 2 && (w.end < w.start || w.amount <= 0)) return 'Vérifiez les dates et le montant.'
    if (n === 2 && w.boost?.shop && (w.shops.length !== 1 || w.shops[0] !== w.boost.shop))
      return `Ce post est sur le compte de ${parId(etat.shops, w.boost.shop)?.name || 'sa boutique'} : ne cochez que cette boutique (une pub ne sponsorise que les posts de la Page de son ad set).`
    if (n === 2 && capErr()) return capErr()
    if (n === 2 && budErr()) return budErr()
    if (n === 2 && (!w.dsaB.trim() || !w.dsaP.trim())) return 'Bénéficiaire et payeur sont obligatoires pour cibler l’UE.'
    if (n === 3 && !w.post && !w.boost) return 'Choisissez un post ou un visuel.'
    if (n === 3 && isLeads && !w.leadForm) return 'Choisissez un formulaire de leads.'
    if (n === 3 && w.crea === 'existing' && (w.variants || []).some((v) => !v.post)) return 'Choisissez le post de chaque variante.'
    if (n === 3 && w.crea === 'new' && ['nl', 'both'].includes(langue) && !String(w.messageNl || '').trim())
      return 'Écrivez le texte néerlandais de la pub (bloc « Version néerlandaise ») : vous l’avez choisie en néerlandais.'
    if (n === 4 && !w.adName.trim()) return 'Nommez la pub.'
    return ''
  }

  // ---- Les quatre appels à la Marketing API, tels que le serveur les enverra (exemple pour la première boutique) ----
  const geo0 = P.GEO(sid0)
  const geoOf = (sid: string) => ({ latitude: P.GEO(sid)[0], longitude: P.GEO(sid)[1], radius: w.radius[sid], distance_unit: 'kilometer' })
  const budgetKey = w.budgetType === 'daily' ? 'daily_budget' : 'lifetime_budget'
  const campBody: Record<string, unknown> = {
    name: w.name,
    objective: w.objective,
    status: w.status,
    special_ad_categories: w.special,
    buying_type: 'AUCTION',
    spend_cap: cents(w.spendCap),
    ...(w.budgetLevel === 'campaign' ? { [budgetKey]: cents(w.amount), bid_strategy: w.bid } : { is_adset_budget_sharing_enabled: false }),
  }
  if (!(w.spendCap > 0)) delete campBody.spend_cap
  const targeting: Record<string, unknown> = {
    geo_locations: { custom_locations: [geoOf(sid0)] },
    age_min: w.ageMin,
    age_max: w.ageMax,
    publisher_platforms: w.platforms,
    // Les identifiants des centres d'intérêt sont résolus par le serveur chez Meta.
    flexible_spec: w.interests.length ? [{ interests: w.interests.map((n) => ({ id: `{id ${n}}`, name: n })) }] : undefined,
    targeting_automation: { advantage_audience: w.advantage ? 1 : 0 },
  }
  if (w.gender !== 'all') targeting.genders = [w.gender === 'men' ? 1 : 2]
  // Langue choisie : la clé de locale Meta, résolue par le serveur (search?type=adlocale).
  if (w.lang === 'fr' || w.lang === 'nl') targeting.locales = [`{locale ${w.lang.toUpperCase()}}`]
  const adsetBody = {
    name: `${w.name} · ${nom(sid0)}`,
    campaign_id: '{campaign_id}',
    status: w.status,
    billing_event: 'IMPRESSIONS',
    optimization_goal: w.goal,
    ...(obj.dest[0] ? { destination_type: w.dest } : {}),
    ...(w.budgetLevel === 'adset' ? { [budgetKey]: cents(w.amount / parJeux), bid_strategy: w.bid } : {}),
    start_time: `${w.start}T07:00:00+0200`,
    end_time: `${w.end}T22:00:00+0200`,
    ...(ENCHERES_AVEC_MONTANT.includes(w.bid) ? { bid_amount: cents(w.bidAmount) } : {}),
    ...(promoted !== '—'
      ? { promoted_object: isLeads || w.objective === 'OUTCOME_ENGAGEMENT' ? { page_id: ids(sid0).page_id } : { pixel_id: ids(sid0).pixel_id, custom_event_type: 'PURCHASE' } }
      : {}),
    dsa_beneficiary: w.dsaB,
    dsa_payor: w.dsaP,
    targeting,
  }
  const cta = {
    type: w.cta,
    value: isLeads
      ? { lead_gen_form_id: w.leadForm || '{lead_gen_form_id}' }
      : w.cta === 'GET_DIRECTIONS'
        ? { link: `fbgeo://${geo0[0]}, ${geo0[1]}, "${parId(etat.shops, sid0)?.address || ''}"` }
        : { link: w.link },
  }
  const creaSpec =
    fmtP.kind === 'video'
      ? { video_data: { video_id: '{video_id}', image_url: '{vignette}', message: w.message, title: w.headline, link_description: w.description, call_to_action: cta } }
      : fmtP.kind === 'carousel'
        ? {
            link_data: {
              link: w.link,
              message: w.message,
              child_attachments: Array.from({ length: fmtP.n }, (_, i) => ({ link: w.link, image_hash: `{image_hash_${i + 1}}`, name: w.headline, call_to_action: cta })),
              multi_share_optimized: !fmtP.locked,
              multi_share_end_card: !fmtP.locked,
              call_to_action: cta,
            },
          }
        : { link_data: { link: w.link, message: w.message, name: w.headline, description: w.description, image_hash: '{image_hash}', call_to_action: cta } }
  const igMarque = uniquesReseau(serveur).instagram ? ids('marque').instagram_user_id : undefined
  const creaBody = w.boost
    ? {
        name: `Créa · boost · ${String(w.boost.titre || '').slice(0, 80)}`,
        ...(w.boost.canal === 'Instagram'
          ? { object_id: '{page_id}', instagram_user_id: '{instagram_user_id}', source_instagram_media_id: w.boost.metaId }
          : { object_story_id: w.boost.metaId }),
        url_tags: w.urlTags,
      }
    : w.crea === 'existing'
      ? { name: `Créa · ${post ? post.title : ''}`, object_story_id: post?.dark ? '{dark post déjà diffusé}' : `${ids(sid0).page_id}_{post_id}`, url_tags: w.urlTags }
      : {
          name: `Créa · ${w.headline || (post ? post.title : '')}`,
          object_story_spec: { page_id: ids(sid0).page_id, instagram_user_id: ids(sid0).instagram_user_id || igMarque, ...creaSpec },
          url_tags: w.urlTags,
        }
  const domaine = (((w.link || '').match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '').toLowerCase().split('.').slice(-2).join('.')
  const adBody = {
    name: w.adName,
    adset_id: '{adset_id}',
    creative: { creative_id: '{creative_id}' },
    status: w.adStatus,
    ...(w.pixel ? { tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: [ids(sid0).pixel_id] }], conversion_domain: domaine } : {}),
  }
  const base = `${GRAPH_BASE}${P.VERSION}/`
  const calls: [string, unknown][] = [
    [`POST ${base}${accFor(sid0)}/campaigns`, campBody],
    [`POST ${base}${accFor(sid0)}/adsets`, adsetBody],
    [`POST ${base}${accFor(sid0)}/adcreatives`, creaBody],
    [`POST ${base}${accFor(sid0)}/ads`, adBody],
  ]
  const callsNote =
    ((w.variants || []).length ? `${1 + w.variants.length} variantes : une créa et une pub par variante · ` : '') +
    (w.lang === 'both'
      ? 'deux langues : un ad set par langue (targeting.locales nl / fr) · '
      : w.lang === 'fr' || w.lang === 'nl'
        ? `langue ${w.lang.toUpperCase()} (targeting.locales) · `
        : w.shops.some((id) => languesDe(etat, id).length > 1)
          ? 'boutique bilingue : un ad set par langue (targeting.locales nl / fr) · '
          : '') +
    `exemple pour ${nom(sid0)}${w.shops.length > 1 ? ', répété pour chaque boutique' : ''}${w.account === 'reseau' ? ` · compte réseau ${reseauAcc}` : ''}`
  const recap: [string, string][] = [
    ['Objectif', `${obj.label} · ${w.objective}`],
    ['Opération', camp ? camp.name : 'Hors opération'],
    ['Comptes', w.account === 'boutique' ? `${w.shops.length} comptes boutique` : 'Compte réseau'],
    ['Optimisation', w.goal + (obj.dest[0] ? ` → ${w.dest}` : '')],
    ['Audience', `${w.ageMin}–${w.ageMax} ans · ${w.shops.map((id) => `${nom(id)} ${w.radius[id]} km`).join(', ')}`],
    ['Langue', langRecap],
    [
      'Créa',
      w.boost
        ? `Post ${w.boost.canal} boosté · ${String(w.boost.titre || '').slice(0, 60)}`
        : `${w.crea === 'existing' ? 'Post sponsorisé · ' : `Dark post · ${fmtP.label} · `}${post ? post.title : '—'} · ${LIBELLES_BOUTONS[w.cta]}`,
    ],
    ['Variantes', (w.variants || []).length ? `${1 + w.variants.length} (A${w.variants.map((_, i) => `, ${String.fromCharCode(66 + i)}`).join('')}) · une pub par variante` : 'Une seule'],
    [
      'Budget',
      `${w.budgetType === 'daily' ? `${m$(w.amount)} / jour` : `${m$(w.amount)} total`} · ${w.spendCap > 0 ? `plafond ${m$(w.spendCap)}` : 'sans plafond'} · ${w.budgetLevel === 'campaign' ? 'CBO' : 'ABO'}`,
    ],
    ['Diffusion', `${dLabel(w.start)} → ${dLabel(w.end)} · statut ${w.status}`],
  ]

  const fwd = () => {
    const e = errFor(step)
    if (e) {
      P.setErr(e)
      return
    }
    if (step < 5) {
      P.setStep(step + 1)
      return
    }
    const ad: Pub = {
      id: `a${Date.now()}`,
      name: w.adName,
      campaign: w.campaign || null,
      objective: obj.label,
      metaObjective: w.objective,
      shops: w.shops,
      scope: w.account === 'reseau' ? 'reseau' : 'boutique',
      budgetType: w.budgetType === 'daily' ? 'quotidien' : 'total',
      budget: w.account === 'boutique' ? w.amount * w.shops.length : w.amount,
      cap: w.spendCap,
      spent: 0,
      start: w.start,
      end: w.end,
      status: w.status === 'PAUSED' && w.adStatus === 'PAUSED' ? 'En pause' : 'En revue',
      radius: Math.round(w.shops.reduce((x, id) => x + w.radius[id], 0) / w.shops.length),
      post: w.post,
      leadForm: w.leadForm || null,
      dark: w.crea === 'new',
      variants: 1 + (w.variants || []).length,
      devise: dev,
      spec: w,
    }
    if (w.boost) {
      if (w.boost.img) ad.thumb = w.boost.img
      ad.boost = w.boost
      ad.objective = `${obj.label} · boost`
    }
    P.onEnvoyer(ad, w.boost)
  }

  const seg = <T extends string>(valeur: T, choix: [T, string, string?][], onPick: (v: T) => void, desactive?: Partial<Record<T, boolean>>) => (
    <div className="seg" role="group">
      {choix.map(([v, l, t]) => (
        <button key={v} type="button" className={valeur === v ? 'is-on' : ''} aria-pressed={valeur === v} title={t} disabled={!!desactive?.[v]} onClick={() => onPick(v)}>
          {l}
        </button>
      ))}
    </div>
  )
  const Tech = ({ children }: { children: ReactNode }) => <span className="pub__tech">{children}</span>
  const nouvelle = w.crea === 'new'
  const needsNl = nlPour().length > 0

  return (
    <div className="pub__voile">
      <div className="card pub__wiz" role="dialog" aria-modal="true">
        <div className="pub__wiz-tete">
          <div className="pub__wiz-titre">
            <span>
              <span>Nouvelle publicité Meta</span>
              <span className="muted pub__petit">Marketing API {P.VERSION} · campagne → ad set → créa → pub</span>
            </span>
            <button type="button" className="btn btn--icon" aria-label="Fermer" onClick={P.onFermer}>
              ×
            </button>
          </div>
          <div className="pub__etapes">
            {ETAPES.map(([label, tech], i) => (
              <button
                key={label}
                type="button"
                className={`pub__etape${i + 1 <= step ? ' is-faite' : ''}${i + 1 === step ? ' is-on' : ''}`}
                onClick={() => {
                  if (i + 1 < step) {
                    P.setStep(i + 1)
                    P.setErr('')
                  }
                }}
              >
                <span className="pub__etape-barre" />
                <span>
                  {i + 1} · {label}
                </span>
                <span className="pub__tech">{tech}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pub__wiz-corps">
          {step === 1 ? (
            <>
              <div className="pub__grille2">
                <label className="pub__champ">
                  <span>
                    Nom de la campagne Meta <Tech>name *</Tech>
                  </span>
                  <input type="text" value={w.name} onChange={(e) => W({ name: e.target.value })} />
                </label>
                <label className="pub__champ">
                  <span>Opération Franchise Buddy</span>
                  <select
                    value={w.campaign}
                    onChange={(e) =>
                      W({ campaign: e.target.value, urlTags: w.urlTags.replace(/utm_campaign=[^&]*/, `utm_campaign=${e.target.value || 'hors-campagne'}`) })
                    }
                  >
                    <option value="">Hors opération</option>
                    {camps
                      .filter((c) => c.status !== 'terminée')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="pub__section">
                <span>Objectif</span>
                <Tech>objective *</Tech>
              </div>
              <div className="pub__objectifs">
                {OBJECTIFS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`pub__objectif${w.objective === o.id ? ' is-on' : ''}`}
                    onClick={() =>
                      W({
                        objective: o.id,
                        goal: o.goals[0],
                        dest: o.dest[0],
                        cta: o.id === 'OUTCOME_LEADS' ? 'SIGN_UP' : o.id === 'OUTCOME_SALES' ? 'ORDER_NOW' : o.id === 'OUTCOME_ENGAGEMENT' ? 'MESSAGE_PAGE' : o.id === 'OUTCOME_TRAFFIC' ? 'ORDER_NOW' : 'GET_DIRECTIONS',
                      })
                    }
                  >
                    <img src={imageSocial(o.icon)} alt="" />
                    <span>{o.label}</span>
                    <span className="muted pub__petit">{o.desc}</span>
                    <span className="pub__tech">{o.id}</span>
                  </button>
                ))}
              </div>
              <div className="pub__bloc">
                <span>
                  Catégorie spéciale <Tech>special_ad_categories * · [] par défaut</Tech>
                </span>
                <div className="pub__puces">
                  {CATEGORIES_SPECIALES.map(([id, label]) => {
                    const on = w.special.includes(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`pub__puce${on ? ' is-on' : ''}`}
                        onClick={() => {
                          const sp = on ? w.special.filter((x) => x !== id) : w.special.concat(id)
                          const r = { ...w.radius }
                          if (sp.length) Object.keys(r).forEach((k) => (r[k] = Math.max(15, r[k])))
                          W({ special: sp, radius: r, ageMin: sp.length ? 18 : w.ageMin, ageMax: sp.length ? 65 : w.ageMax, gender: sp.length ? 'all' : w.gender })
                        }}
                      >
                        {label} · {id}
                      </button>
                    )
                  })}
                </div>
                {special ? <span className="pub__alerte is-or">Catégorie spéciale : Meta impose un rayon d'au moins 15 km, tous âges et tous genres.</span> : null}
              </div>
              <div className="pub__grille3">
                <div className="pub__champ">
                  <span>
                    Compte publicitaire <Tech>act_{'{ad_account_id}'}</Tech>
                  </span>
                  {seg(
                    w.account,
                    [
                      ['boutique', 'Un par boutique', propres.length ? 'Chaque boutique paie sur son propre compte publicitaire' : 'Aucune boutique n’a encore son propre compte publicitaire'],
                      ['reseau', 'Compte réseau'],
                    ],
                    (v) =>
                      v === 'boutique'
                        ? propres.length && W({ account: 'boutique', shops: w.shops.filter((id) => propres.some((sh) => sh.id === id)) })
                        : W({ account: 'reseau' }),
                    { boutique: !propres.length },
                  )}
                  <span className="muted pub__petit">
                    {(dev !== 'EUR' ? `Ce compte facture en ${dev} : tous les montants de l’assistant sont en ${dev}, pas en euros. ` : '') +
                      (w.account === 'boutique'
                        ? `Chaque boutique paie sur son compte : ${propres.map((sh) => `${sh.name} (${ids(sh.id).ad_account_id})`).join(', ')}. Les boutiques se cochent à l’étape 2.`
                        : (reseauAcc
                            ? `Compte réseau ${reseauAcc} : une campagne, un ad set par boutique cochée à l’étape 2 (sa zone, sa Page).`
                            : 'Compte réseau non renseigné : Paramètres → API Meta.') + (propres.length ? '' : ' Aucune boutique n’a encore son propre compte publicitaire.'))}
                  </span>
                </div>
                <div className="pub__champ">
                  <span>
                    Niveau du budget <Tech>is_adset_budget_sharing_enabled</Tech>
                  </span>
                  {seg(
                    w.budgetLevel,
                    [
                      ['adset', 'Ad set (ABO)'],
                      ['campaign', 'Campagne (CBO)'],
                    ],
                    (v) => W({ budgetLevel: v }),
                  )}
                </div>
                <div className="pub__champ">
                  <span>
                    Statut à la création <Tech>status *</Tech>
                  </span>
                  {seg(
                    w.status,
                    [
                      ['PAUSED', 'En pause'],
                      ['ACTIVE', 'Active'],
                    ],
                    (v) => W({ status: v }),
                  )}
                </div>
              </div>
              <div className="pub__grille3">
                <label className="pub__champ">
                  <span>
                    Stratégie d'enchère <Tech>bid_strategy</Tech>
                  </span>
                  <select value={w.bid} onChange={(e) => W({ bid: e.target.value })}>
                    {STRATEGIES_ENCHERE.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label} · {id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pub__champ">
                  <span>
                    Plafond de dépense ({sym}) <Tech>spend_cap · {cents(w.spendCap)}</Tech>
                  </span>
                  <input type="number" min="0" value={w.spendCap || ''} onChange={(e) => W({ spendCap: Number(e.target.value) })} />
                  <span className="muted pub__petit">{(cpt.minCap ? `Minimum Meta : ${m$(cpt.minCap)} · ` : '') + 'vide = pas de plafond'}</span>
                </label>
                <span className="pub__champ">
                  <span>
                    Type d'achat <Tech>buying_type</Tech>
                  </span>
                  <span className="pub__fixe">Enchères · AUCTION</span>
                </span>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="pub__section">
                <span>Optimisation et diffusion</span>
                <Tech>optimization_goal · destination_type · billing_event</Tech>
              </div>
              <div className="pub__grille4">
                <label className="pub__champ">
                  <span>
                    Optimiser pour <Tech>optimization_goal *</Tech>
                  </span>
                  <select value={w.goal} onChange={(e) => W({ goal: e.target.value })}>
                    {obj.goals.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
                {obj.dest[0] ? (
                  <label className="pub__champ">
                    <span>
                      Destination <Tech>destination_type</Tech>
                    </span>
                    <select value={w.dest} onChange={(e) => W({ dest: e.target.value })}>
                      {obj.dest.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <span className="pub__champ">
                  <span>
                    Facturation <Tech>billing_event *</Tech>
                  </span>
                  <span className="pub__fixe">IMPRESSIONS</span>
                </span>
                <span className="pub__champ">
                  <span>
                    Objet promu <Tech>promoted_object</Tech>
                  </span>
                  <span className="pub__fixe">{promoted}</span>
                </span>
              </div>
              <div className="pub__section">
                <span>Budget et calendrier</span>
                <Tech>daily_budget / lifetime_budget · start_time · end_time</Tech>
              </div>
              {w.budgetLevel === 'campaign' ? (
                <span className="muted pub__petit">Budget fixé au niveau campagne (CBO) : il est saisi ici mais envoyé sur l'objet campagne.</span>
              ) : null}
              <div className="pub__grille4 pub__grille--bas">
                {seg(
                  w.budgetType,
                  [
                    ['daily', 'Quotidien'],
                    ['lifetime', 'Total (lifetime)'],
                  ],
                  (v) => W({ budgetType: v, amount: v === 'daily' ? 10 : 300 }),
                )}
                <label className="pub__champ">
                  <span>
                    {(w.budgetType === 'daily' ? 'Montant / jour' : 'Montant total') + (w.account === 'boutique' ? ` par boutique (${sym})` : ` (${sym}) · réparti entre les boutiques`)}{' '}
                    <Tech>
                      {budgetKey} = {cents(w.amount)}
                    </Tech>
                  </span>
                  <input type="number" min="1" value={w.amount} onChange={(e) => W({ amount: Number(e.target.value) })} />
                </label>
                <label className="pub__champ">
                  <span>
                    Début <Tech>start_time</Tech>
                  </span>
                  <input type="date" value={w.start} onChange={(e) => W({ start: e.target.value })} />
                </label>
                <label className="pub__champ">
                  <span>
                    Fin <Tech>{w.budgetType === 'lifetime' ? 'end_time *' : 'end_time'}</Tech>
                  </span>
                  <input type="date" value={w.end} onChange={(e) => W({ end: e.target.value })} />
                </label>
                {ENCHERES_AVEC_MONTANT.includes(w.bid) ? (
                  <label className="pub__champ">
                    <span>
                      Enchère max ({sym}) <Tech>bid_amount · {cents(w.bidAmount)}</Tech>
                    </span>
                    <input type="number" step="0.05" value={w.bidAmount} onChange={(e) => W({ bidAmount: Number(e.target.value) })} />
                  </label>
                ) : null}
              </div>
              <div className="pub__faits">
                <span>
                  <span className="muted">Durée</span>
                  <span>{days} jours</span>
                </span>
                <span>
                  <span className="muted">Dépense estimée</span>
                  <span className={w.spendCap > 0 && est > w.spendCap ? 'is-alerte' : ''}>{m$(est)}</span>
                </span>
                <span>
                  <span className="muted">Plafond (spend_cap)</span>
                  <span>{w.spendCap > 0 ? m$(w.spendCap) : 'aucun'}</span>
                </span>
                {camp && dev === 'EUR' && campLeft != null ? (
                  <span>
                    <span className="muted">Reste sur l’opération</span>
                    <span className={campLeft < est ? 'is-moyen' : 'is-bon'}>{eur(campLeft)}</span>
                  </span>
                ) : null}
              </div>
              {w.spendCap > 0 && est > w.spendCap ? (
                <span className="pub__alerte is-or">
                  La dépense estimée ({m$(est)}) dépasse le plafond de {m$(w.spendCap)} : la diffusion s’arrêtera au plafond, soit environ{' '}
                  {Math.floor((days * w.spendCap) / est)} jours sur {days}.
                </span>
              ) : null}
              {camp && dev === 'EUR' && campLeft != null && campLeft < est ? (
                <span className="pub__alerte is-or">
                  Il reste {eur(campLeft)} sur le budget de « {camp.name} ».
                </span>
              ) : null}

              <div className="pub__section">
                <span>Audience</span>
                <Tech>targeting *</Tech>
              </div>
              <span className="pub__bloc">
                <span>
                  Boutiques et rayon de diffusion <Tech>geo_locations.custom_locations [{'{latitude, longitude, radius, distance_unit: "kilometer"}'}]</Tech>
                </span>
                <span className="muted pub__petit">
                  {'Cochez les boutiques autour desquelles diffuser, puis réglez le rayon de chacune. ' +
                    (w.account === 'reseau'
                      ? 'Chaque boutique cochée a son ad set : sa zone, sa Page Facebook, sa langue ; le budget se répartit entre elles.'
                      : `Chaque boutique paie sur son propre compte.${propres.length < SHOPS.length ? ' Une boutique sans compte publicitaire propre ne se coche qu’en « Compte réseau ».' : ''}`)}
                </span>
              </span>
              <div className="pub__boutiques">
                {SHOPS.map((sh) => {
                  const ok = w.account === 'reseau' || sh.ads === 'connected'
                  const on = w.shops.includes(sh.id)
                  const g = P.GEO(sh.id)
                  return (
                    <div key={sh.id} className={`pub__boutique${ok ? '' : ' is-off'}`}>
                      <label>
                        <input type="checkbox" checked={on} disabled={!ok} onChange={() => W({ shops: on ? w.shops.filter((x) => x !== sh.id) : w.shops.concat(sh.id) })} />
                        {sh.name}
                      </label>
                      <input
                        type="range"
                        min={minR}
                        max={40}
                        value={w.radius[sh.id] ?? 8}
                        disabled={!on}
                        onChange={(e) => W({ radius: { ...w.radius, [sh.id]: Math.max(minR, Number(e.target.value)) } })}
                      />
                      <span>{w.radius[sh.id] ?? 8} km</span>
                      <span className={ok ? 'pub__tech' : 'is-alerte pub__petit'}>
                        {ok ? `${g[0].toFixed(4)}, ${g[1].toFixed(4)}` : 'Sans compte pub propre : passez en « Compte réseau » (étape 1)'}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="pub__grille3">
                <label className="pub__champ">
                  <span>
                    Âge <Tech>age_min · age_max</Tech>
                  </span>
                  <span className="pub__ages">
                    <input type="number" min="18" max="65" value={w.ageMin} disabled={special} onChange={(e) => W({ ageMin: Math.min(Number(e.target.value), w.ageMax) })} />à
                    <input type="number" min="18" max="65" value={w.ageMax} disabled={special} onChange={(e) => W({ ageMax: Math.max(Number(e.target.value), w.ageMin) })} />
                    ans
                  </span>
                </label>
                <div className="pub__champ">
                  <span>
                    Genre <Tech>genders</Tech>
                  </span>
                  {seg(
                    w.gender,
                    [
                      ['all', 'Tous'],
                      ['men', 'Hommes'],
                      ['women', 'Femmes'],
                    ],
                    (v) => (v === 'all' || !special) && W({ gender: v }),
                  )}
                </div>
                <label className="pub__case">
                  <input type="checkbox" checked={w.advantage} onChange={() => W({ advantage: !w.advantage })} />
                  Audience Advantage+ <Tech>targeting_automation.advantage_audience</Tech>
                </label>
              </div>
              <div className="pub__bloc">
                <span>
                  Langue de la pub <Tech>targeting.locales · une créa par langue</Tech>
                </span>
                {seg(langue, LANG_PUB, (v) => W({ lang: v }))}
                <span className="muted pub__petit">{langHelp}</span>
              </div>
              <div className="pub__bloc">
                <span>
                  Centres d'intérêt <Tech>flexible_spec [{'{interests:[{id, name}]}'}]</Tech>
                </span>
                <div className="pub__puces">
                  {INTERETS.map((n) => {
                    const on = w.interests.includes(n)
                    return (
                      <button key={n} type="button" className={`pub__puce${on ? ' is-on' : ''}`} onClick={() => W({ interests: on ? w.interests.filter((x) => x !== n) : w.interests.concat(n) })}>
                        {n}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="pub__bloc">
                <span>
                  Plateformes <Tech>publisher_platforms</Tech>
                </span>
                <div className="pub__puces">
                  {PLATEFORMES.map((p) => {
                    const on = w.platforms.includes(p)
                    return (
                      <button key={p} type="button" className={`pub__puce${on ? ' is-on' : ''}`} onClick={() => W({ platforms: on ? w.platforms.filter((x) => x !== p) : w.platforms.concat(p) })}>
                        {p}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="pub__grille2">
                <label className="pub__champ">
                  <span>
                    Bénéficiaire (UE) <Tech>dsa_beneficiary *</Tech>
                  </span>
                  <input type="text" value={w.dsaB} onChange={(e) => W({ dsaB: e.target.value })} />
                </label>
                <label className="pub__champ">
                  <span>
                    Payeur (UE) <Tech>dsa_payor *</Tech>
                  </span>
                  <input type="text" value={w.dsaP} onChange={(e) => W({ dsaP: e.target.value })} />
                </label>
              </div>
              <span className="pub__audience" title="Estimation indicative du module (densité moyenne autour des boutiques), pas celle de Meta">
                Audience estimée : <span className="pub__fort">{fmt(Math.round(aud / 100) * 100)}</span> personnes
              </span>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="pub__ligne">
                {seg(
                  w.crea,
                  [
                    ['existing', 'Sponsoriser un post existant'],
                    ['new', 'Dark post (pub uniquement)', 'Meta crée un post visible seulement en sponsorisé : ni sur le mur de la Page, ni sur la grille Instagram.'],
                  ],
                  (v) => W(v === 'existing' ? { crea: 'existing', variants: [] } : { crea: 'new', variants: [], boost: null }),
                )}
                <span className="pub__tech">
                  {w.boost
                    ? w.boost.canal === 'Instagram'
                      ? `source_instagram_media_id = ${w.boost.metaId}`
                      : `object_story_id = ${w.boost.metaId}`
                    : w.crea === 'existing'
                      ? 'object_story_id = {page_id}_{post_id}'
                      : fmtP.kind === 'video'
                        ? 'POST /act_{id}/advideos → object_story_spec.video_data'
                        : fmtP.kind === 'carousel'
                          ? `POST /act_{id}/adimages ×${fmtP.n} → object_story_spec.link_data.child_attachments`
                          : 'POST /act_{id}/adimages → image_hash, puis object_story_spec'}
                </span>
              </div>
              <span className="muted pub__petit">
                {w.boost
                  ? `Publication déjà en ligne sur ${w.boost.canal === 'Instagram' ? 'Instagram' : 'la Page Facebook'}, lue chez Meta : elle est sponsorisée telle quelle, sans variante.`
                  : w.crea === 'existing'
                    ? 'Choisissez un post publié ou programmé, ou un dark post déjà diffusé par une autre pub : il est sponsorisé tel quel, et ses likes et commentaires se cumulent.'
                    : 'Dark post : Meta crée un post visible seulement en sponsorisé — ni sur le mur de la Page, ni sur la grille Instagram. Le format suit le visuel choisi : image, carrousel (ordre fixe pour un panorama ou une frise) ou vidéo. Préparez-le dans « Créer un post » → Réservé à la publicité.'}
              </span>
              {w.boost ? (
                <div className="pub__boost">
                  <img src={imageSocial(w.boost.img || BULLE)} alt="" />
                  <div>
                    <span className="muted pub__petit">
                      Post {w.boost.canal} à booster · {w.boost.shop ? nom(w.boost.shop) : 'Marque'}
                      {w.boost.date ? ` · publié le ${dShort(w.boost.date)}` : ''}
                    </span>
                    <span>{w.boost.titre || 'Publication'}</span>
                    <span className="muted pub__petit">{(w.boost.demande ? 'Proposé par la boutique. ' : '') + 'Sponsorisé tel quel : ses réactions et commentaires se cumulent.'}</span>
                  </div>
                  <div className="pub__actions">
                    {w.boost.permalink ? (
                      <a href={w.boost.permalink} target="_blank" rel="noopener noreferrer" className="pub__petit">
                        Voir le post ↗
                      </a>
                    ) : null}
                    <button type="button" className="btn btn--sm" onClick={() => W({ boost: null })}>
                      Choisir plutôt un post du module
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="pub__visuels">
                {(w.boost ? [] : pool.slice(0, 18)).map((p) => {
                  const f = formatDe(p)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`pub__visuel${w.post === p.id ? ' is-on' : ''}`}
                      onClick={() =>
                        W({
                          post: p.id,
                          message: w.message || remplir(etat, serveur, p.text || '', sid0, null, 'fr'),
                          messageNl: w.messageNl || remplir(etat, serveur, p.textNl || '', SHOPS[0]?.id, null, 'nl'),
                          headline: w.headline || p.title,
                          adName: w.adName || `${p.title} · ${obj.label.toLowerCase()}`,
                        })
                      }
                    >
                      <span className="pub__visuel-img">{p.img ? <img src={imageSocial(p.img)} alt="" /> : null}</span>
                      <span className="pub__visuel-texte">
                        <span>{p.title}</span>
                        <span className="muted pub__petit">{p.dark ? (diffused(p) ? 'Dark post déjà diffusé · réutilisé' : 'Dark post') : `${dShort(p.date)} · ${p.status}`}</span>
                        <span className={`pub__tag${p.dark ? ' is-noir' : ''}`}>{f.label}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              {nouvelle ? (
                <>
                  <div className="pub__section">
                    <span>Contenu de la créa</span>
                    <Tech>object_story_spec.link_data</Tech>
                  </div>
                  <label className="pub__champ">
                    <span>
                      Texte principal <Tech>message</Tech>
                    </span>
                    <textarea rows={3} value={w.message} onChange={(e) => W({ message: e.target.value })} />
                  </label>
                  <div className="pub__grille2">
                    <label className="pub__champ">
                      <span>
                        Titre <Tech>name</Tech>
                      </span>
                      <input type="text" value={w.headline} onChange={(e) => W({ headline: e.target.value })} />
                    </label>
                    <label className="pub__champ">
                      <span>
                        Description <Tech>description</Tech>
                      </span>
                      <input type="text" value={w.description} onChange={(e) => W({ description: e.target.value })} />
                    </label>
                  </div>
                  {needsNl ? (
                    <div className="pub__encadre">
                      <span>
                        Version néerlandaise · {['nl', 'both'].includes(langue) ? 'toutes les boutiques cochées' : nlPour().map(nom).join(', ')}{' '}
                        <Tech>une créa par langue · targeting.locales</Tech>
                      </span>
                      <textarea rows={2} placeholder="Hoofdtekst (NL)" value={w.messageNl} onChange={(e) => W({ messageNl: e.target.value })} />
                      <input type="text" placeholder="Titel (NL)" value={w.headlineNl} onChange={(e) => W({ headlineNl: e.target.value })} />
                    </div>
                  ) : null}
                </>
              ) : null}
              {!w.boost ? (
                <div className="pub__encadre">
                  <div className="pub__depense-tete">
                    <span>
                      Variantes à tester (A/B) <Tech>une créa et une pub par variante dans chaque ad set</Tech>
                    </span>
                    {(w.variants || []).length < 2 ? (
                      <button type="button" className="btn btn--sm" onClick={() => W({ variants: (w.variants || []).concat({ post: '', message: '', headline: '', messageNl: '', headlineNl: '' }) })}>
                        + Ajouter une variante
                      </button>
                    ) : null}
                  </div>
                  <span className="muted pub__petit">
                    {w.crea === 'existing'
                      ? 'Sponsorisez jusqu’à 3 posts dans la même pub : Meta répartit la diffusion et privilégie celui qui marche le mieux.'
                      : 'Jusqu’à 3 variantes (autre visuel, autre texte) : Meta répartit la diffusion et privilégie la plus performante. Un champ vide reprend celui de la variante A ; les résultats par variante s’affichent dans le suivi.'}
                  </span>
                  {(w.variants || []).map((v, i) => {
                    const setV = (patch: Partial<Variante>) => W({ variants: w.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                    return (
                      <div key={i} className="pub__variante">
                        <div className="pub__depense-tete">
                          <span>Variante {String.fromCharCode(66 + i)}</span>
                          <button type="button" className="btn btn--sm btn--ghost" onClick={() => W({ variants: w.variants.filter((_, j) => j !== i) })}>
                            Retirer
                          </button>
                        </div>
                        <label className="pub__champ">
                          <span>{w.crea === 'existing' ? 'Post à sponsoriser *' : 'Visuel'}</span>
                          <select value={v.post || ''} onChange={(e) => setV({ post: e.target.value })}>
                            <option value="">{w.crea === 'existing' ? 'Choisir un post…' : 'Même visuel que la variante A'}</option>
                            {pool
                              .filter((p) => p.id !== w.post)
                              .slice(0, 40)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.title} · {p.dark ? 'dark post' : dShort(p.date)} · {formatDe(p).label}
                                </option>
                              ))}
                          </select>
                        </label>
                        {nouvelle ? (
                          <>
                            <textarea rows={2} placeholder="Texte principal — vide : celui de la variante A" value={v.message || ''} onChange={(e) => setV({ message: e.target.value })} />
                            <input type="text" placeholder="Titre — vide : celui de la variante A" value={v.headline || ''} onChange={(e) => setV({ headline: e.target.value })} />
                            {needsNl ? (
                              <>
                                <textarea rows={2} placeholder="Hoofdtekst (NL) — leeg: die van variant A" value={v.messageNl || ''} onChange={(e) => setV({ messageNl: e.target.value })} />
                                <input type="text" placeholder="Titel (NL) — leeg: die van variant A" value={v.headlineNl || ''} onChange={(e) => setV({ headlineNl: e.target.value })} />
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : null}
              <div className="pub__grille2">
                <label className="pub__champ">
                  <span>
                    Lien de destination <Tech>link *</Tech>
                  </span>
                  <input type="url" value={w.link} onChange={(e) => W({ link: e.target.value })} />
                </label>
                <label className="pub__champ">
                  <span>
                    Bouton <Tech>call_to_action.type</Tech>
                  </span>
                  <select value={w.cta} onChange={(e) => W({ cta: e.target.value })}>
                    {BOUTONS.map((id) => (
                      <option key={id} value={id}>
                        {LIBELLES_BOUTONS[id]} · {id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {w.cta === 'GET_DIRECTIONS' ? (
                <span className="pub__alerte is-or">
                  « Itinéraire » ouvre le plan vers chaque boutique (sa position), pas le lien de destination.
                  {w.dest === 'WEBSITE' ? ' Pour mener au webshop, choisissez « Commander » ou « Acheter ».' : ''}
                </span>
              ) : null}
              {isLeads ? (
                <div className="pub__grille2">
                  <label className="pub__champ">
                    <span>
                      Formulaire de leads <Tech>call_to_action.value.lead_gen_form_id *</Tech>
                    </span>
                    <select value={w.leadForm} onChange={(e) => W({ leadForm: e.target.value })}>
                      <option value="">Choisir un formulaire actif…</option>
                      {leadForms.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} · v{l.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  {P.onGererFormulaires ? (
                    <button type="button" className="btn btn--ghost btn--sm pub__aligne" onClick={P.onGererFormulaires}>
                      Gérer les formulaires de leads →
                    </button>
                  ) : (
                    <a className="pub__aligne pub__petit" href={P.lienLeads}>
                      Gérer les formulaires de leads →
                    </a>
                  )}
                </div>
              ) : null}
              <label className="pub__champ">
                <span>
                  Paramètres de suivi <Tech>url_tags</Tech>
                </span>
                <input type="text" value={w.urlTags} onChange={(e) => W({ urlTags: e.target.value })} />
              </label>
              <span className="muted pub__petit">
                Identité Instagram : compte de chaque boutique <Tech>object_story_spec.instagram_user_id</Tech>
              </span>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <div className="pub__grille2">
                <label className="pub__champ">
                  <span>
                    Nom de la pub <Tech>name *</Tech>
                  </span>
                  <input type="text" value={w.adName} onChange={(e) => W({ adName: e.target.value })} />
                </label>
                <div className="pub__champ">
                  <span>
                    Statut <Tech>status *</Tech>
                  </span>
                  {seg(
                    w.adStatus,
                    [
                      ['PAUSED', 'En pause'],
                      ['ACTIVE', 'Active'],
                    ],
                    (v) => W({ adStatus: v }),
                  )}
                </div>
              </div>
              <label className="pub__case">
                <input type="checkbox" checked={w.pixel} onChange={() => W({ pixel: !w.pixel })} />
                Suivre les conversions du webshop avec le pixel {ids(sid0).pixel_id} <Tech>tracking_specs · conversion_domain: latelierby.be</Tech>
              </label>
              <span className="muted pub__petit">
                {w.account === 'boutique'
                  ? `Franchise Buddy crée ${w.shops.length} jeux campagne / ad set / créa / pub, un par compte publicitaire de boutique, avec le rayon de chaque boutique.`
                  : `Franchise Buddy crée une campagne sur le compte réseau ${reseauAcc}, avec un ad set par boutique (${w.shops.length}) : sa zone, sa Page.`}
              </span>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <div className="pub__recap">
                <div className="pub__recap-img">
                  <img src={imageSocial(w.boost?.img ? w.boost.img : post?.img || BULLE)} alt="" />
                </div>
                <div className="pub__recap-grille">
                  {recap.map(([k, v]) => [
                    <span key={`${k}k`} className="muted">
                      {k}
                    </span>,
                    <span key={`${k}v`}>{v}</span>,
                  ])}
                </div>
              </div>
              <div className="pub__appels">
                <span className="muted pub__petit">Appels API envoyés par Franchise Buddy · {callsNote}</span>
                {calls.map(([title, body]) => (
                  <div key={title} className="pub__appel">
                    <div className="pub__tech">{title}</div>
                    <pre>{JSON.stringify(body, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="pub__wiz-pied">
          <span className="error">{P.err}</span>
          <div className="pub__actions">
            {step > 1 ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  P.setStep(step - 1)
                  P.setErr('')
                }}
              >
                Retour
              </button>
            ) : null}
            <button type="button" className="btn btn--primary" onClick={fwd}>
              {step === 5 ? 'Envoyer à Meta' : 'Continuer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
