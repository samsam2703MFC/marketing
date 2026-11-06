import { charger, socialApi } from './store'

/**
 * Le repost automatique (social/src/repost.php) : chaque nouveau post de la Page de la marque repris sur les Pages
 * des boutiques. Réglage, suivi des publications reprises et gestes du réseau — tout se passe sur le serveur du
 * module (Meta, file, espace franchisé). Chaque geste rend l'écran à jour (mêmes routes que social-data.js).
 */
export type StatutCase = 'ok' | 'prog' | 'val' | 'ref' | 'err' | 'exp' | 'ret' | 'hors' | 'excl' | 'direct'

export interface CanalCase {
  canal: string
  statut: string
  erreur?: string
}

export interface CaseRepost {
  statut: StatutCase
  le?: string | null
  limite?: string | null
  etat?: string
  etatNom?: string
  motif?: string
  par?: string
  reponduLe?: string | null
  lien?: string | null
  detail?: string
  canaux?: CanalCase[]
}

export interface ReglageRepost {
  actif: boolean
  depuis?: string | null
  mode: 'partage' | 'copie'
  instagram: boolean
  delaiMin: number
  de: string
  a: string
  texte: string
  exclure: string[]
  delaiValidationH: number
  sansReponse: 'publier' | 'rien'
  boutiques: Record<string, { on: boolean; validation: boolean }>
  [cle: string]: unknown
}

export interface BoutiqueRepost {
  id: string
  name: string
  page: string
  test: boolean
  fb: string
  pageId: string
  instagram: boolean
  on: boolean
  validation: boolean
  repris?: number | null
}

export interface LigneRepost {
  source: string
  publieLe: string
  type: string
  titre: string
  texte: string
  img?: string | null
  permalink?: string | null
  statut: string
  motif?: string
  mode: string
  modeDemande?: string
  cases: Record<string, CaseRepost>
}

export interface PostAVenir {
  source: string
  prevuLe: string
  type: string
  titre: string
  texte: string
  img?: string | null
  mode: string
  exclu?: string | null
  origine?: string
  cases: Record<string, CaseRepost>
}

export interface VueRepost {
  reglage: ReglageRepost
  jours: number
  shops: BoutiqueRepost[]
  lignes: LigneRepost[]
  chiffres: {
    posts: number
    exclus: number
    attendus: number
    publies: number
    programmes: number
    aValider: number
    refuses: number
    echecs: number
    sansReponse: number
  }
  alertes: { shop: string; name: string; canal: string; n: number; motif: string; code?: number | null; le?: string }[]
  attente: { source: string; shop: string; name: string; titre: string; limite?: string | null }[]
  aVenir?: { posts: PostAVenir[]; erreur?: string | null }
  guet?: { le?: string | null; lus?: number; erreur?: string | null; pause?: boolean; nouveaux?: number } | null
  marque: { name: string; pageId: string; fb?: string }
  instagramUnique: boolean
  metaConfigure: boolean
  franchiseUrl?: string
  /** Rendus par certains gestes. */
  relances?: number
  retrait?: { ok: boolean; erreurs?: { shopName: string; reason: string }[] }
}

export const lireRepost = (jours: number) => socialApi<VueRepost>('GET', `/repost?jours=${+jours || 14}`)

export type GesteRepost = 'reglage' | 'relire' | 'relancer' | 'forcer' | 'retirer'

/** Un geste du réseau : le serveur rend l'écran à jour ; l'état du module est relu ensuite (comme SA.refresh). */
export function gesteRepost(quoi: GesteRepost, corps: Record<string, unknown>): Promise<VueRepost> {
  return socialApi<VueRepost>('POST', `/repost/${quoi}`, corps).then((r) => {
    void charger()
    return r
  })
}
