import { socialApi } from './store'

/**
 * Les avis Google des boutiques (api/social/src/google.php) : la Réputation digitale du BO (note, cible, avis 5★ à obtenir,
 * répartition des avis lus) et les avis eux-mêmes, classés vert / orange / rouge comme les commentaires. Le module
 * lit les tables du BO ; « Synchroniser chez Google » demande au BO de relire les fiches (appel facturé par Google).
 * Mêmes routes que social/public/social-data.js.
 */
export type Couleur = 'rouge' | 'orange' | 'vert' | ''

export interface Repartition {
  lus?: number
  niveaux?: { note: number; n: number }[]
}

export interface MagasinReputation {
  id: string
  nom: string
  note: number | null
  avis: number
  ecart?: number
  avis5Requis?: number | null
  raccorde?: boolean
  synchro?: string | null
  url?: string | null
  repartition?: Repartition
  gagnes7?: number | null
  gagnes30?: number | null
  scans30?: number
  lienAvis?: string | null
  lienCourt?: string | null
  langs?: string[]
}

export interface Reputation {
  indispo?: boolean
  raison?: string
  cible: number
  suiviDepuis?: string | null
  reseau?: {
    moyenne: number | null
    avis: number
    magasins: number
    notes: number
    sousCible?: number
    avis5Requis?: number | null
    repartition?: Repartition
    gagnes7?: number | null
    gagnes30?: number | null
    scans30?: number
  }
  connecteur?: { configure?: boolean; raccordes?: number; derniereSynchro?: string | null }
  magasins?: MagasinReputation[]
}

export interface AvisGoogle {
  id: string
  shopId: string
  boutique?: string
  couleur: Couleur
  sujet?: string
  analyse?: string
  note: number | null
  auteur?: string
  le?: string
  message?: string
  resume?: string
  action?: string
  reponse?: string
  enRetard?: boolean
  ageH?: number
  escalade?: boolean
  responsable?: string
  canal?: string
  peutRepondre?: boolean
  reponseEnvoyee?: string | null
  reponseSource?: string
  reponseLe?: string | null
  reponsePar?: string
  traite?: boolean
  traiteLe?: string | null
  traitePar?: string
  lien?: string | null
}

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

export interface ReglagesGoogle {
  actif: boolean
  heure: number
  dernier?: { le: string; ok?: boolean; message?: string } | null
}

export interface VueGoogle {
  reputation?: Reputation | null
  avis: AvisGoogle[]
  totaux: Totaux
  reglages?: ReglagesGoogle
  relu?: { le?: string | null } | null
  ia?: { configure?: boolean }
  reponses?: { active: boolean; fiches?: number; raison?: string } | null
  hidden?: boolean
  /** Rendus par « Relire » et « Synchroniser ». */
  analyse?: { classes?: number; ia?: boolean; erreur?: string | null }
  bo?: { magasins: number; nouveaux: number; erreurs?: string[]; aucuneFiche?: boolean }
  sync?: { lus?: number }
}

export const lireGoogle = (jours: number) => socialApi<VueGoogle>('GET', `/google?jours=${jours}`)
export const relireGoogle = (jours: number) => socialApi<VueGoogle>('POST', '/google/relire', { jours })
export const synchroniserGoogle = (jours: number) => socialApi<VueGoogle>('POST', '/google/synchroniser', { jours })
export const reglerGoogle = (r: { actif: boolean; heure: number }) => socialApi<{ reglages: ReglagesGoogle }>('POST', '/google/reglages', r)

export const traiterAvis = (id: string, traite: boolean) => socialApi('POST', '/commentaires/traiter', { id, traite })
export const proposerReponse = (id: string) => socialApi<{ reponse: string; source?: string; langue?: string }>('POST', '/commentaires/proposer', { id })
export const publierReponse = (id: string, message: string) => socialApi('POST', '/commentaires/repondre', { id, message })
export const noterReponduSurFiche = (id: string, message: string) => socialApi('POST', '/commentaires/repondu', { id, message })
