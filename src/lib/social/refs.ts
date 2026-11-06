import { ROOTS } from '../api/module'

/**
 * Référentiels du module Social (repris de social/public/social-data.js) : types d'opération, leviers,
 * statuts et leurs couleurs. Ce ne sont pas des données : ce que le serveur connaît (boutiques,
 * opérations, posts, résultats) se lit dans le store (store.ts), jamais ici.
 */
export interface Pastille {
  label?: string
  bg: string
  fg: string
  bar?: string
}

export const LEVERS: Record<string, { name: string; color: string }> = {
  trafic: { name: 'Trafic', color: '#6366f1' },
  recurrence: { name: 'Récurrence', color: '#ec4899' },
  xp: { name: 'Expérience Client', color: '#f59e0b' },
  'food-cost': { name: 'Food Cost', color: '#10b981' },
  'labour-cost': { name: 'Labour Cost', color: '#8b5cf6' },
  'overhead-cost': { name: 'Overhead Cost', color: '#8b5cf6' },
}

export interface TypeOperation {
  id: string | undefined
  name: string
  color: string
  icon: string
  lev: string
  kpi: string
  continuous?: boolean
}

export const CTYPES: TypeOperation[] = [
  { id: 'ouverture', name: 'Ouverture de boutique', color: '#8D1D2C', icon: 'img/illus/customer-facing/click-collect.png', lev: 'trafic', kpi: 'Tickets / jour' },
  { id: 'lancement', name: 'Lancement / nouveauté', color: '#A61E4D', icon: 'img/illus/products/croissant.png', lev: 'trafic', kpi: 'Quantités vendues du produit' },
  { id: 'saison', name: 'Saisonnalité', color: '#D97B29', icon: 'img/illus/seasonal/autumn-range.png', lev: 'trafic', kpi: 'CA de la gamme' },
  { id: 'fetes', name: 'Fêtes', color: '#7B1424', icon: 'img/illus/seasonal/christmas-new-year-range.png', lev: 'trafic', kpi: 'CA commandes fêtes' },
  { id: 'event', name: 'Événementiel local', color: '#78554B', icon: 'img/illus/seasonal/crepe-festival.png', lev: 'xp', kpi: 'Fréquentation boutique' },
  { id: 'antigaspi', name: 'Anti-gaspi / invendus', color: '#6B4A26', icon: 'img/illus/products/bread-3.png', lev: 'food-cost', kpi: "Taux d'invendus" },
  { id: 'acquisition', name: 'Acquisition', color: '#3B3468', icon: 'img/illus/customer-facing/webshop.png', lev: 'trafic', kpi: 'Nouveaux clients' },
  { id: 'retention', name: 'Rétention / réactivation', color: '#5C3A6E', icon: 'img/illus/products/cookies.png', lev: 'recurrence', kpi: 'Fréquence de visite' },
  { id: 'partenariat', name: 'Partenariat local', color: '#9C6B2F', icon: 'img/illus/customer-facing/b2b.png', lev: 'recurrence', kpi: 'CA B2B' },
  { id: 'continu', name: 'Présence continue', color: '#666666', icon: 'img/illus/decorative/circle-01.png', lev: 'xp', kpi: 'Engagement moyen', continuous: true },
]

export const POST_TYPES = ['Produit', 'Gamme saisonnière', 'Vidéo / film', 'Événement local', 'Anti-gaspi', 'Recrutement', 'Libre']

/** Les couleurs suivent le design system du Marketing (gris chauds, pas de pilule : rectangles de 6 px). */
export const STATUS: Record<string, Pastille> = {
  Brouillon: { bg: '#EDE7DE', fg: '#5c5852' },
  'À valider': { bg: '#F6E7CE', fg: '#7A5207' },
  Programmé: { bg: '#F2C9A0', fg: '#6b4420' },
  Publié: { bg: '#E2F0E8', fg: '#0F6B4A' },
  Échec: { bg: '#8D1D2C', fg: '#FFFFFF' },
  Partiel: { bg: '#F6DCDF', fg: '#8D1D2C' },
  'Dark post': { bg: '#232220', fg: '#F2C9A0' },
}
export const AD_STATUS: Record<string, Pastille> = {
  'En revue': { bg: '#F6E7CE', fg: '#7A5207' },
  Active: { bg: '#E2F0E8', fg: '#0F6B4A' },
  Refusée: { bg: '#8D1D2C', fg: '#FFFFFF' },
  'En pause': { bg: '#EDE7DE', fg: '#5c5852' },
  Arrêtée: { bg: '#EDE7DE', fg: '#5c5852' },
  'Budget épuisé': { bg: '#F6DCDF', fg: '#8D1D2C' },
  Terminée: { bg: '#EDE7DE', fg: '#5c5852' },
}
export const CONN: Record<string, Pastille> = {
  connected: { label: 'Connecté', bg: '#E2F0E8', fg: '#0F6B4A' },
  expired: { label: 'Token expiré', bg: '#F6E7CE', fg: '#7A5207' },
  none: { label: 'Non connecté', bg: '#F6DCDF', fg: '#8D1D2C' },
}
export type Rag = 'green' | 'orange' | 'red' | 'grey'
export const RAG: Record<Rag, Pastille & { label: string; bar: string }> = {
  green: { label: 'Objectif atteint', bg: '#E2F0E8', fg: '#0F6B4A', bar: '#3f7a52' },
  orange: { label: 'En retrait', bg: '#F6E7CE', fg: '#7A5207', bar: '#B0792A' },
  red: { label: 'Objectif manqué', bg: '#F6DCDF', fg: '#8D1D2C', bar: '#8D1D2C' },
  grey: { label: 'Données indisponibles', bg: '#EDE7DE', fg: '#5c5852', bar: '#B8B2A8' },
}
export const ragOf = (r: number | null | undefined): Rag => (r == null ? 'grey' : r >= 1 ? 'green' : r >= 0.7 ? 'orange' : 'red')

/** Une image du module Social (illustrations, produits), servie sous son adresse. */
export const imageSocial = (chemin: string) => (/^(https?:|data:|\/)/.test(chemin) ? chemin : `${ROOTS.social}${chemin}`)
