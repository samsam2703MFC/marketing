import { useSyncExternalStore } from 'react'
import { socialApi } from '../../lib/social/store'
import { imageSocial } from '../../lib/social/refs'

/**
 * Espace franchisé — la couche de données des écrans Commentaires, Messages, Avis Google, Publicités & opérations,
 * Grille Instagram et Suivi (portée de social/franchisee/franchise-data.js, mêmes routes et mêmes noms de fonctions).
 *
 * L'état de la boutique est lu une fois au module Social (`GET /franchise/etat`) : la boutique est celle que le
 * serveur décide pour la session (pas de `?shop=` lu dans l'adresse). Chaque appel suivant porte l'id de CETTE
 * boutique, comme franchise-data.js. Pas de mode démonstration : sans session, l'écran dit l'erreur du serveur.
 */

const HORS_SESSION = 'Ouvrez votre espace boutique depuis l’ERP : vous y êtes déjà connecté.'

/** Les règles du réseau pour l'espace (src/franchise.php, sfRegles) : seules celles que lisent ces écrans sont nommées. */
export interface ReglesFranchise {
  voirCommentaires?: boolean
  repondreCommentaires?: boolean
  voirAvisGoogle?: boolean
  voirMessages?: boolean
  repondreMessages?: boolean
  voirCampagnes?: boolean
  voirResultats?: boolean
  voirPublicites?: boolean
  voirAnalyse?: boolean
  voirSuivi?: boolean
  proposerBoost?: boolean
  message?: string
  [cle: string]: unknown
}

export interface BoutiqueFranchise {
  id: string
  name: string
  langs?: string[]
  hours?: string
  hoursNl?: string
  address?: string
  page?: string
  ig?: string
  fb?: string
  igs?: string
}

/** Un post de l'état (sfPostVue) : ceux de la boutique (`own`) et ceux du réseau. */
export interface PostFranchise {
  id: string
  date: string
  time: string
  title: string
  status: string
  own?: boolean
  fb?: boolean
  ig?: boolean
  img?: string
  type?: string
  campaign?: string | null
  [cle: string]: unknown
}

export interface Alertes {
  com?: { pourBoutique?: number; rouges?: number; oranges?: number; enRetard?: number }
  google?: { pourBoutique?: number; rouges?: number; oranges?: number; enRetard?: number }
  messages?: { aRepondre?: number }
}

export interface EtatFranchise {
  today: string
  now?: string
  mode?: string
  me: { name?: string; via?: string; shops?: { id: string; name: string }[] }
  shop: BoutiqueFranchise
  rules: ReglesFranchise
  posts: PostFranchise[]
  quota?: { week?: string; used: number; max: number }
  instagramUnique?: boolean
  grilleInstagram?: boolean
  alertes?: Alertes
  [cle: string]: unknown
}

interface Courant {
  chargement: 'attente' | 'pret' | 'erreur'
  erreur: string | null
  etat: EtatFranchise | null
}

let courant: Courant = { chargement: 'attente', erreur: null, etat: null }
const abonnes = new Set<() => void>()
let lecture: Promise<void> | null = null

function publier(suite: Partial<Courant>) {
  courant = { ...courant, ...suite }
  abonnes.forEach((f) => f())
}

const message = (e: unknown) => {
  const status = (e as { status?: number } | null)?.status
  if (status === 401) return HORS_SESSION
  return e instanceof Error ? e.message : String(e)
}

/** Lit (ou relit) l'état de la boutique (franchise-data.js : `load()`). Une lecture en cours est partagée. */
export function load(): Promise<void> {
  if (lecture) return lecture
  lecture = socialApi<EtatFranchise>('GET', '/franchise/etat')
    .then((r) => {
      if (!r || !r.shop) throw new Error('Espace indisponible : le module Social n’a pas rendu de boutique.')
      publier({ chargement: 'pret', erreur: null, etat: r })
    })
    .catch((e: unknown) => publier({ chargement: courant.etat ? 'pret' : 'erreur', erreur: message(e) }))
    .finally(() => {
      lecture = null
    })
  return lecture
}

function abonner(f: () => void) {
  abonnes.add(f)
  if (courant.chargement === 'attente' && !lecture) void load()
  return () => abonnes.delete(f)
}

/** L'état de la boutique, chargé au premier écran qui le demande (franchise-data.js : `SF.state()` et `SF.error`). */
export function useFranchise(): Courant {
  return useSyncExternalStore(abonner, () => courant)
}

/** L'état déjà lu (null tant qu'il ne l'est pas). */
export const state = () => courant.etat

/** L'id de la boutique ouverte, ajouté à chaque appel (franchise-data.js : `STATE.shop.id`). */
function shop(): string {
  const s = courant.etat?.shop?.id
  if (!s) throw new Error(courant.erreur || 'Espace boutique pas encore chargé.')
  return String(s)
}
const q = (extra = '') => `shop=${encodeURIComponent(shop())}${extra ? `&${extra}` : ''}`

async function api<T>(method: 'GET' | 'POST', chemin: string, corps?: Record<string, unknown>): Promise<T> {
  try {
    return await socialApi<T>(method, chemin, method === 'POST' ? { shop: shop(), ...(corps ?? {}) } : undefined)
  } catch (e) {
    throw new Error(message(e))
  }
}

/** Une image du module : relative (`uploads/…`, `img/…`) sous l'adresse du module, sinon telle quelle (SF.media). */
export const media = (src: string | null | undefined) => (!src ? '' : imageSocial(src))

/* --- Commentaires (src/commentaires.php) ------------------------------------------------------------------- */

export type Couleur = 'rouge' | 'orange' | 'vert' | ''

export interface Totaux {
  rouge: number
  orange: number
  vert: number
  aClasser: number
  rougeOuverts: number
  orangeOuverts: number
  total: number
  enRetard?: number
  delaiMedianH?: number | null
}

/** Un commentaire de la Page (ou un avis Google, même forme) classé par le réseau. */
export interface Commentaire {
  id: string
  canal?: string
  compte?: string
  compteKey?: string
  boutique?: string
  shopId?: string
  auteur?: string
  note?: number | null
  message?: string
  le?: string
  masque?: boolean
  publication?: string
  lienPublication?: string
  lien?: string
  couleur: Couleur
  sujet?: string
  resume?: string
  action?: string
  reponse?: string
  analyse?: string
  traite?: boolean
  traiteLe?: string | null
  traitePar?: string
  responsable?: string
  enRetard?: boolean
  escalade?: boolean
  ageH?: number
  peutRepondre?: boolean
  reponseEnvoyee?: string | null
  reponseSource?: string
  reponseLe?: string | null
  reponsePar?: string
}

export interface VueCommentaires {
  hidden?: boolean
  jours?: number
  commentaires: Commentaire[]
  totaux: Totaux
  relu?: { le?: string | null } | null
  ia?: { configure?: boolean }
}

export const commentaires = (jours: number) => api<VueCommentaires>('GET', `/franchise/commentaires?${q(`jours=${jours}`)}`)
export const commentaireTraiter = (id: string, traite: boolean) => api<{ ok: boolean }>('POST', '/franchise/commentaires/traiter', { id, traite })
export const commentaireRepondre = (id: string, message: string) => api<{ ok: boolean; le?: string }>('POST', '/franchise/commentaires/repondre', { id, message })
/** Avis Google : une réponse proposée (Claude, sinon un modèle d'après la note et la langue). */
export const commentaireProposer = (id: string) => api<{ reponse: string; source?: string; langue?: string }>('POST', '/franchise/commentaires/proposer', { id })
/** Avis Google : « J'ai répondu sur la fiche » (la réponse collée est gardée, l'avis passe traité). */
export const avisRepondu = (id: string, message: string) => api<{ ok: boolean; publieSur?: string; le?: string }>('POST', '/franchise/commentaires/repondu', { id, message })

/* --- Avis Google (src/google.php) ---------------------------------------------------------------------------- */

export interface MagasinGoogle {
  id: string
  nom: string
  note: number | null
  avis: number
  ecart?: number
  avis5Requis?: number | null
  repartition?: { lus?: number; niveaux?: { note: number; n: number }[] }
  raccorde?: boolean
  url?: string | null
  synchro?: string | null
  lienAvis?: string | null
  lienCourt?: string | null
  gagnes7?: number | null
  gagnes30?: number | null
  scans7?: number
  scans30?: number
}

export interface VueGoogleFranchise {
  hidden?: boolean
  jours?: number
  avis: Commentaire[]
  totaux: Totaux
  relu?: { le?: string | null } | null
  ia?: { configure?: boolean }
  reponses?: { active?: boolean; peutPublier?: boolean; fiches?: number; raison?: string } | null
  reputation?: {
    indispo?: boolean
    cible: number
    connecteur?: { raccordes?: number; derniereSynchro?: string | null }
    reseau?: { moyenne: number | null; avis: number; notes: number }
    magasins?: MagasinGoogle[]
  } | null
}

export const google = (jours: number) => api<VueGoogleFranchise>('GET', `/franchise/google?${q(`jours=${jours}`)}`)

/* --- Messages privés Instagram (src/messages.php) ------------------------------------------------------------ */

export interface Conversation {
  id: string
  canal?: string
  client: string
  dernierTexte?: string
  dernierSens?: 'in' | 'out'
  dernierLe?: string
  ageH?: number
  fenetre?: boolean
  fenetreFin?: string | null
  aRepondre?: boolean
  traiteLe?: string | null
  attribue?: boolean
  attribuePar?: string
  note?: string
  reponduPar?: string
}

export interface MessagePrive {
  id: string
  sens: 'in' | 'out'
  auteur?: string
  texte: string
  le: string
  par?: string
  pieces?: { url: string; type?: string }[]
}

export interface Boite {
  conversations: Conversation[]
  masque?: boolean
  aRepondre?: number
  peutRepondre?: boolean
  fenetreH?: number
  relus?: string
}

export interface FilConversation {
  conversation: Conversation
  messages: MessagePrive[]
}

export const messages = () => api<Boite>('GET', `/franchise/messages?${q()}`)
export const messageConversation = (id: string) => api<FilConversation>('GET', `/franchise/messages/conversation?${q(`id=${encodeURIComponent(id)}`)}`)
export const messageRepondre = (id: string, texte: string) => api<FilConversation>('POST', '/franchise/messages/repondre', { id, texte })
export const messageTraiter = (id: string, traite: boolean) => api<FilConversation>('POST', '/franchise/messages/traiter', { id, traite })

/* --- Publicités et opérations (src/franchise.php, src/boost.php) --------------------------------------------- */

export interface ResultatOperation {
  spend?: number | null
  reach?: number | null
  impr?: number | null
  clicks?: number | null
  eng?: number | null
  vv?: number | null
  caCamp?: number | null
  caRef?: number | null
  tCamp?: number | null
  tRef?: number | null
  qCamp?: number | null
  qRef?: number | null
  source?: string
}

export interface OperationFranchise {
  id: string
  name: string
  type?: string
  status?: string
  boStatus?: string
  start?: string
  end?: string
  image?: string | null
  description?: string
  products?: string[]
  levers?: string[]
  channels?: string[]
  budget?: number | null
  goal?: { metric?: string; value?: number; unit?: string } | null
  goalShop?: number | null
  result?: ResultatOperation | null
  posts?: PostFranchise[]
  metaPosts?: { id: string; channel?: string; date?: string; text?: string; img?: string | null; link?: string | null }[]
  ads?: { name: string; status?: string; objective?: string; start?: string; end?: string; reseau?: boolean }[]
}

export const operations = () => api<{ hidden?: boolean; operations: OperationFranchise[] }>('GET', `/franchise/operations?${q()}`)

export interface PubliciteFranchise {
  id: string
  name: string
  objective?: string
  phase?: 'encours' | 'avenir' | 'terminee'
  status?: string
  start?: string
  end?: string
  reseau?: boolean
  radius?: number | null
  operation?: string | null
  img?: string | null
  shops?: string[]
  stats?: { impressions?: number; reach?: number; clicks?: number } | null
  budget?: number | null
  budgetType?: string
  spent?: number | null
  devise?: string
}

export interface VuePublicites {
  hidden?: boolean
  budget?: boolean
  resultats?: boolean
  reseau?: PubliciteFranchise[]
  boutique?: PubliciteFranchise[]
}

export const publicites = () => api<VuePublicites>('GET', `/franchise/publicites?${q()}`)

export interface DemandeBoost {
  id: number | string
  canal?: string
  titre?: string
  img?: string | null
  permalink?: string | null
  datePost?: string | null
  message?: string
  statut: 'attente' | 'boostee' | 'refusee'
  reponse?: string
  le: string
  traiteLe?: string | null
}

export const boost = () => api<{ demandes: DemandeBoost[]; attente?: number; max?: number; permis?: boolean }>('GET', `/franchise/boost?${q()}`)

/* --- Grille Instagram (src/instagram.php) -------------------------------------------------------------------- */

export interface MediaGrille {
  id: string
  src?: string
  type?: string
  video?: boolean
  permalink?: string
  at?: string
  caption?: string
  likes?: number | null
  comments?: number | null
  frise?: { tile?: number } | null
}

export interface ProgrammeGrille {
  id: string
  title: string
  date: string
  time: string
  status: string
  own?: boolean
  frise?: string[] | null
  src?: string
}

export interface VueInstagram {
  reseau?: boolean
  username?: string
  name?: string
  picture?: string | null
  followers?: number | null
  media?: MediaGrille[]
  programmes?: ProgrammeGrille[]
  erreur?: string | null
  le?: string
}

export interface AbonnesFranchise {
  reseau?: boolean
  followers?: number | null
  username?: string
  du?: string
  au?: string
  jours?: number
  serie?: Record<string, { gagnes?: number; perdus?: number }> | null
  gagnes?: number | null
  perdus?: number | null
  reach?: Record<string, number | null> | null
  motif?: string | null
  message?: string | null
  le?: string
}

export const instagram = () => api<VueInstagram>('GET', `/franchise/instagram?${q()}`)
export const instagramAbonnes = () => api<AbonnesFranchise>('GET', `/franchise/instagram/abonnes?${q()}`)

/* --- Suivi de la boutique (src/suivi.php) et calendrier Meta (src/calendriers.php) ---------------------------- */

export interface LigneSuivi {
  page?: string
  name?: string
  facebook?: { followers?: number | null; gagnes?: number | null; perdus?: number | null; net?: number | null; serie?: Record<string, { gagnes?: number; perdus?: number }>; motif?: string | null } | null
  instagram?: { serie?: Record<string, { gagnes?: number; perdus?: number }>; motif?: string | null } | null
  depense?: number | null
  depenseJours?: Record<string, number>
  abonnesNet?: number | null
  coutParAbonne?: number | null
}

export interface VueSuivi {
  du?: string
  au?: string
  jours?: number
  devise?: string
  le?: string
  lignes?: LigneSuivi[]
  erreurs?: string[]
  message?: string | null
}

/** Abonnés gagnés / perdus de la Page face au budget du réseau, lus en direct chez Meta. */
export const suivi = (jours: number) => api<VueSuivi>('GET', `/franchise/suivi?${q(`jours=${jours}`)}`)

export interface PostMetaFranchise {
  id: string
  channel: string
  date: string
  time?: string
  title?: string
  type?: string
  status?: string
}

/** Les publications de la Page (et de l'Instagram) entre deux dates, lues chez Meta. */
export const calendrier = (du: string, au: string) => api<{ posts?: PostMetaFranchise[]; message?: string | null }>('GET', `/franchise/calendrier?${q(`du=${du}&au=${au}`)}`)

/* --- Liens entre les pages de l'espace (franchise-data.js : `href`) ------------------------------------------- */

/** Les pages de l'espace, sous les clés de franchise-data.js, et la route du Marketing qui les affiche. */
export const ROUTES_FRANCHISE = {
  cal: 'sf-cal',
  pub: 'sf-pub',
  com: 'sf-com',
  msg: 'sf-msg',
  google: 'sf-google',
  camp: 'sf-camp',
  ig: 'sf-ig',
  suivi: 'sf-suivi',
} as const
export type PageFranchise = keyof typeof ROUTES_FRANCHISE

/** Suivre un lien vers une autre page de l'espace, avec ses paramètres (`post=…`, `vue=semaine&date=…`). */
export type Naviguer = (page: PageFranchise, query: string) => void

/** L'adresse d'une page de l'espace dans le Marketing : `?ecran=sf-…&<paramètres>`. */
export function href(page: PageFranchise, query = ''): string {
  return `${window.location.pathname}?${[`ecran=${ROUTES_FRANCHISE[page]}`, query].filter(Boolean).join('&')}`
}

/** Les props d'un lien de l'espace : l'adresse, et `onNaviguer` s'il est donné (sans recharger la page). */
export function lien(onNaviguer: Naviguer | undefined, page: PageFranchise, query = '') {
  return {
    href: href(page, query),
    onClick: (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
      if (!onNaviguer || e.metaKey || e.ctrlKey) return
      e.preventDefault()
      onNaviguer(page, query)
    },
  }
}

/** Suivre une page de l'espace par le code (un clic sur une barre, un jour…). */
export function aller(onNaviguer: Naviguer | undefined, page: PageFranchise, query = '') {
  if (onNaviguer) onNaviguer(page, query)
  else window.location.assign(href(page, query))
}

/** « 06/11 14:05 » d'un horodatage « AAAA-MM-JJ HH:MM… » (la date seule si l'heure manque). */
export function dateHeure(x: string | null | undefined): string {
  if (!x) return ''
  const s = String(x)
  return `${s.slice(8, 10)}/${s.slice(5, 7)}${s.length > 11 ? ` ${s.slice(11, 16)}` : ''}`
}

/** L'heure actuelle sous la forme du serveur : « AAAA-MM-JJ HH:MM » (le jour est celui du serveur). */
export function maintenant(): string {
  const now = new Date()
  const jour =
    courant.etat?.today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${jour} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Le message d'une erreur attrapée. */
export const texteErreur = (e: unknown) => (e instanceof Error ? e.message : String(e))
