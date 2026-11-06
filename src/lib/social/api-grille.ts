import { socialApi } from './store'

/**
 * Appels de l'écran « Grille Instagram » (repris de social/public/SA Grille.dc.html) : les publications
 * déjà en ligne, lues chez Instagram par le serveur, et les abonnés du compte (30 jours).
 */
export interface MediaInstagram {
  id: string
  type?: string
  src?: string
  permalink?: string
  at?: string
  caption?: string
}

export interface GrilleInstagram {
  shop?: string
  media?: MediaInstagram[]
  lu_le?: string | null
  instagram?: boolean
  /** Relecture : le nombre de publications relues, ou la raison de l'échec. */
  synchro?: number | string
}

export interface AbonnesInstagram {
  followers?: number | null
  du?: string
  au?: string
  jours?: number
  serie?: Record<string, { gagnes?: number; perdus?: number }> | null
  gagnes?: number
  perdus?: number | null
  reach?: Record<string, number | null> | null
  motif?: string | null
  message?: string | null
  le?: string
}

/** La grille déjà lue (le serveur relit chaque heure). `shop` : une boutique, ou « marque » (Instagram unique). */
export function lireGrille(shop: string): Promise<GrilleInstagram> {
  return socialApi<GrilleInstagram>('GET', `/instagram/grille?shop=${encodeURIComponent(shop)}`)
}

/** Relecture immédiate chez Instagram. */
export function relireGrille(shop: string): Promise<GrilleInstagram> {
  return socialApi<GrilleInstagram>('POST', '/instagram/grille', { shop })
}

/** Les abonnés du compte jour par jour (30 jours) et les comptes touchés, lus en direct chez Meta. */
export function lireAbonnes(shop: string): Promise<AbonnesInstagram> {
  return socialApi<AbonnesInstagram>('GET', `/instagram/abonnes?shop=${encodeURIComponent(shop)}`)
}
