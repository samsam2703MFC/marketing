import { socialApi } from './store'

/**
 * Les appels de l'écran « Opérations » du module Social (social/public/SA Campagnes.dc.html), portés
 * dans le Marketing : le plan de posts d'une campagne (src/plan.php) et les publications des Pages lues
 * en direct chez Meta (src/calendriers.php). Rien n'est gardé en base par les lectures.
 */

/** Les options du plan : les mix (libellé, composition) et l'heure conseillée. `GET /campagnes/plan`. */
export interface PlanOptions {
  mix?: Record<string, { libelle: string; composition: { sujet: string; part: number }[] }>
  heure?: string
  creneau?: string
  source?: string
  err?: string
}

export interface PlanDemande {
  du: string
  au: string
  /** réseau → posts par semaine (fbig, facebook, instagram, story). */
  rythme: Record<string, number>
  mix: string
}

export interface PlanPost {
  date: string
  heure: string
  reseau: string
  format: string
  sujetLibelle: string
  type: string
  raison: string
}

export interface PlanPropose {
  posts: PlanPost[]
  resume: { semaines: number; parReseau: Record<string, number> }
  creneaux: { jours: { jour: string; indice: number }[]; heure: string; creneau?: string; source: string }
}

export const planOptions = () => socialApi<PlanOptions>('GET', '/campagnes/plan')

/** Le plan proposé (rien n'est écrit). `POST /campagnes/plan/proposer`. */
export const planProposer = (q: PlanDemande) => socialApi<PlanPropose>('POST', '/campagnes/plan/proposer', q)

/** Ajoute le plan au calendrier en brouillons rattachés à la campagne. `POST /campagnes/plan/creer`. */
export const planCreer = (q: PlanDemande & { campagne: string; remplacer: boolean }) =>
  socialApi<{ crees: number; retires: number; ids?: string[] }>('POST', '/campagnes/plan/creer', q)

/** Une publication d'une Page ou d'un compte Instagram, lue chez Meta. */
export interface PostMeta {
  id: string
  origin?: string
  date: string
  time?: string
  title: string
  status: string
  img?: string | null
  permalink?: string
  accountName?: string
  ig?: boolean
  shops?: string[] | 'all'
  marque?: boolean
  campaign?: string | null
  [cle: string]: unknown
}

/** Les publications des Pages et comptes Instagram entre deux dates. `GET /meta/calendriers`. */
export const calendriers = (du: string, au: string) =>
  socialApi<{ posts?: PostMeta[]; erreurs?: string[] }>('GET', `/meta/calendriers?du=${encodeURIComponent(du)}&au=${encodeURIComponent(au)}`)
