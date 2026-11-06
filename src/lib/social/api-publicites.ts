import { socialApi } from './store'

/** Appels de l'écran Publicités Meta au module Social (mêmes routes que social/public/social-data.js). */

/** Devise et minimums de Meta par compte publicitaire : act_… → { devise, minCap, minDaily }. */
export type ComptesPub = Record<string, { devise?: string; minCap?: number; minDaily?: number }>

/** Relit chez Meta (au plus toutes les 12 h, le serveur les garde) la devise et les minimums des comptes publicitaires. */
export const lireComptesPub = () => socialApi<{ comptes?: ComptesPub }>('GET', '/meta/comptes').then((r) => r?.comptes ?? null)

export interface ImportMeta {
  le?: string
  comptes?: { id: string; name?: string; devise?: string; statut?: number; campagnes?: number; erreur?: string | null }[]
  importees?: number
  majs?: number
  disparues?: number
  total?: number
  erreurs?: string[]
}

/** « Récupérer les campagnes Meta » : relit chez Meta les campagnes de tous les comptes publicitaires. */
export const importerCampagnesMeta = () => socialApi<{ import?: ImportMeta }>('POST', '/meta/campagnes/rafraichir').then((r) => r?.import ?? null)

export interface ReglesPause {
  pauseActive: boolean
  seuils: Record<string, { cpcMax: number; depenseMin: number }>
  le?: string | null
  par?: string | null
}

export const lireRegles = () => socialApi<ReglesPause>('GET', '/pub/regles')
export const enregistrerRegles = (regles: { pauseActive: boolean; seuils: ReglesPause['seuils'] }) => socialApi<ReglesPause>('POST', '/pub/regles', { regles })

/** Un post de la semaine (ou proposé par une boutique) à booster. */
export interface PostBoost {
  metaId: string
  compte: string
  canal: string
  shop?: string | null
  shopNom?: string
  compteNom?: string
  date?: string
  datePost?: string
  type?: string
  titre?: string
  texte?: string
  img?: string | null
  permalink?: string | null
  interactions?: number | null
  mediane?: number | null
  indice?: number | null
  boostee?: { nom: string } | null
}

export interface Meilleurs {
  du?: string
  au?: string
  le?: string
  lus?: number
  erreurs?: string[]
  posts: PostBoost[]
}

export interface Demande extends PostBoost {
  id: number
  message?: string
  par?: string
  statut: 'attente' | 'boostee' | 'refusee' | string
  reponse?: string
  adId?: string | null
  le: string
  traiteLe?: string | null
  traitePar?: string
}

export interface Demandes {
  demandes: Demande[]
  attente: number
}

export const lireMeilleurs = (forcer: boolean) => socialApi<Meilleurs>('GET', `/pub/meilleurs${forcer ? '?forcer=1' : ''}`)
export const lireDemandes = () => socialApi<Demandes>('GET', '/pub/demandes')
export const refuserDemande = (id: number, reponse: string) => socialApi<Demandes>('POST', '/pub/demandes/refuser', { id, reponse })

export interface CommentaireDark {
  id: string
  channel: string
  shopName?: string
  author?: string
  message: string
  at?: string
  hidden?: boolean
}

export interface DarkPost {
  ad: string
  post: string
  shop: string
  lang: string
  variant?: string
  story?: string
  link?: string
  linkIg?: string
  comments?: number
  hidden?: number
}

export interface ReponseCommentaires {
  comments?: CommentaireDark[]
  darkPosts?: DarkPost[]
  synchro?: { lus?: number; erreurs?: string[] }
}

/** Les commentaires des dark posts d'une pub ; `relire` les relit d'abord chez Meta. */
export const lireCommentaires = (ad: string, relire: boolean) =>
  relire
    ? socialApi<ReponseCommentaires>('POST', '/darkposts/commentaires', { ad })
    : socialApi<ReponseCommentaires>('GET', `/darkposts/commentaires?ad=${encodeURIComponent(ad)}`)

export const masquerCommentaire = (id: string, masquer: boolean) =>
  socialApi('POST', `/darkposts/commentaires/${encodeURIComponent(id)}/masquer`, { masquer })
