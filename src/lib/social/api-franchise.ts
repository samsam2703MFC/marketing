import { socialApi } from './store'

/**
 * Appels de l'écran « Espace franchisé » (repris de social/public/SA Franchise.dc.html) : le kit du mois,
 * les règles du réseau (vérifiées par le serveur) et l'aperçu d'une boutique.
 */
export interface KitLigne {
  id: string
  modele: string
  date: string
  note?: string
}

export interface KitVue {
  items?: (KitLigne & { nom?: string; mois?: string; faits?: number; boutiques: { id: string; nom: string; fait: boolean; date?: string | null }[] })[]
  tous?: KitLigne[]
  boutiques?: number
  modeles?: { id: string; nom: string; actif: boolean }[]
}

export type Regles = Record<string, unknown>

/** Le kit du mois : les posts demandés aux boutiques, et qui les a programmés. */
export function lireKit(): Promise<KitVue> {
  return socialApi<KitVue>('GET', '/kit')
}

export function enregistrerKit(items: KitLigne[]): Promise<KitVue> {
  return socialApi<KitVue>('POST', '/kit', { items })
}

/** Les règles du réseau, nettoyées et rendues par le serveur. */
export function enregistrerRegles(rules: Regles): Promise<{ rules: Regles }> {
  return socialApi<{ rules: Regles }>('POST', '/franchise/admin/regles', { rules })
}

/** Ouvre l'aperçu de l'espace d'une boutique (sans l'ERP) pour la session en cours. */
export function apercuBoutique(shop: string): Promise<unknown> {
  return socialApi('POST', '/franchise/admin/apercu', { shop })
}
