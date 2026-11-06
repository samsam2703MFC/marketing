import { socialApi } from './store'
import type { Objet } from './store'

/** Appels de l'écran Calendrier éditorial au module Social (mêmes routes que social/public/social-data.js). */

/** Un compte Meta (Page Facebook ou Instagram) lu par `GET /meta/calendriers`. */
export interface CompteMeta {
  key: string
  type: 'facebook' | 'instagram'
  id: string
  name: string
  username?: string
  picture?: string | null
  link?: string | null
  shop?: string | null
  erreur?: string | null
  publies?: number
  programmes?: number
}

/** Un post du calendrier : du module, ou lu en direct chez Meta (`origin: 'meta'`, ids mfb-…/mig-…). */
export interface PostCal extends Objet {
  date: string
  time: string
  title: string
  type?: string
  img?: string
  status: string
  shops: string[] | 'all'
  fb?: boolean
  ig?: boolean
  ch?: Record<string, { fb?: boolean; ig?: boolean }>
  marque?: boolean
  dark?: boolean
  text?: string
  textNl?: string
  campaign?: string | null
  author?: string
  origin?: string
  error?: string | null
  failedShops?: string[] | null
  partial?: { ok: string[]; ko: { shop: string; channel: string; reason: string }[] } | null
  refus?: string | null
  // Publication lue chez Meta
  channel?: string
  account?: string
  accountName?: string
  permalink?: string
  stats?: { reactions?: number | null; comments?: number | null; shares?: number | null } | null
}

export interface Calendriers {
  du: string
  au: string
  le?: string
  comptes: CompteMeta[]
  posts: PostCal[]
  erreurs?: string[]
}

/** Les publications des Pages et comptes Instagram entre deux dates, lues en direct chez Meta (rien n'est gardé en base). */
export const lireCalendriers = (du: string, au: string) => socialApi<Calendriers>('GET', `/meta/calendriers?du=${du}&au=${au}`)

export interface ChiffresPost {
  vues?: number | null
  personnes?: number | null
  reactions?: number | null
  commentaires?: number | null
  partages?: number | null
  enregistrements?: number | null
  clics?: number | null
  videos?: number | null
  interactions?: number | null
  motif?: string | null
  le?: string
}

/** Les chiffres (vues, personnes touchées…) d'une publication Meta, lus en direct. */
export const lireChiffresPost = (p: PostCal) =>
  socialApi<ChiffresPost>('GET', `/meta/post-stats?id=${encodeURIComponent(p.id)}&compte=${encodeURIComponent(p.account || '')}`)

export interface Suppression {
  ok: boolean
  id?: string
  supprimees?: { shopName?: string; channel: string }[]
  erreurs?: { shopName?: string; channel: string; reason: string }[]
  enLigne?: number
}

/** Supprime un post du module (et, avec `meta`, de Facebook et d'Instagram), ou une publication lue chez Meta. */
export const supprimerPost = (p: PostCal, meta: boolean) =>
  socialApi<Suppression>('POST', '/posts/supprimer', { id: p.id, meta: !!meta, compte: p.account || '' })

/** Relance la publication des Pages en échec ; rend le post tel que le serveur l'a gardé. */
export const relancerPost = (id: string) => socialApi<{ post: PostCal }>('POST', `/posts/${encodeURIComponent(id)}/relancer`).then((r) => r.post)
