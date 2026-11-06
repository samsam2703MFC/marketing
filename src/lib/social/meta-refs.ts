/**
 * Référentiels de l'API Marketing de Meta, repris de social/public/social-data.js (`META`, `LF_Q`) :
 * objectifs, stratégies d'enchère, catégories spéciales, boutons, plateformes, versions de l'API.
 * Ce sont des constantes de Meta, pas des données : les identifiants (Pages, comptes publicitaires,
 * pixels), la version retenue, le compte réseau, les positions et la mention DSA se lisent à
 * l'exécution dans `etat.meta` (store.ts), jamais ici.
 */
export interface ObjectifMeta {
  id: string
  label: string
  desc: string
  icon: string
  goals: string[]
  dest: string[]
}

export const GRAPH_BASE = 'https://graph.facebook.com/'
export const VERSIONS_API = ['v25.0', 'v26.0']
export const VERSION_API_DEFAUT = 'v25.0'

export const OBJECTIFS: ObjectifMeta[] = [
  { id: 'OUTCOME_AWARENESS', label: 'Notoriété locale', desc: 'Montrer la marque au plus grand nombre autour des boutiques.', icon: 'img/illus/decorative/bubble.png', goals: ['REACH', 'IMPRESSIONS', 'THRUPLAY'], dest: [''] },
  { id: 'OUTCOME_TRAFFIC', label: 'Trafic', desc: 'Faire venir en boutique ou sur le webshop.', icon: 'img/illus/customer-facing/click-collect.png', goals: ['LINK_CLICKS', 'LANDING_PAGE_VIEWS', 'REACH'], dest: ['WEBSITE', 'PHONE_CALL'] },
  { id: 'OUTCOME_ENGAGEMENT', label: 'Engagement / messages', desc: 'Réactions, commentaires ou conversations Messenger.', icon: 'img/illus/customer-facing/phone-orders.png', goals: ['POST_ENGAGEMENT', 'CONVERSATIONS', 'THRUPLAY'], dest: ['ON_AD', 'MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT'] },
  { id: 'OUTCOME_LEADS', label: 'Prospects (leads)', desc: 'Collecter des contacts via un formulaire instantané.', icon: 'img/illus/customer-facing/b2b.png', goals: ['LEAD_GENERATION'], dest: ['ON_AD'] },
  { id: 'OUTCOME_SALES', label: 'Ventes webshop', desc: 'Commandes en ligne mesurées par le pixel.', icon: 'img/illus/customer-facing/webshop.png', goals: ['OFFSITE_CONVERSIONS', 'LANDING_PAGE_VIEWS'], dest: ['WEBSITE'] },
]

export const STRATEGIES_ENCHERE: [string, string][] = [
  ['LOWEST_COST_WITHOUT_CAP', 'Coût le plus bas (recommandé)'],
  ['LOWEST_COST_WITH_BID_CAP', 'Enchère plafonnée'],
  ['COST_CAP', 'Coût par résultat plafonné'],
  ['LOWEST_COST_WITH_MIN_ROAS', 'ROAS minimum'],
]

/** Seules les enchères plafonnées prennent un montant (comme le serveur, SOC_ENCHERES_MONTANT). */
export const ENCHERES_AVEC_MONTANT = ['LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS']

export const CATEGORIES_SPECIALES: [string, string][] = [
  ['EMPLOYMENT', 'Emploi (recrutement)'],
  ['HOUSING', 'Logement'],
  ['FINANCIAL_PRODUCTS_SERVICES', 'Services financiers'],
  ['ISSUES_ELECTIONS_POLITICS', 'Politique'],
]

export const BOUTONS = ['LEARN_MORE', 'SHOP_NOW', 'ORDER_NOW', 'GET_DIRECTIONS', 'CALL_NOW', 'SIGN_UP', 'CONTACT_US', 'GET_OFFER', 'GET_QUOTE', 'APPLY_NOW', 'MESSAGE_PAGE', 'WHATSAPP_MESSAGE']

export const LIBELLES_BOUTONS: Record<string, string> = {
  LEARN_MORE: 'En savoir plus',
  SHOP_NOW: 'Acheter',
  ORDER_NOW: 'Commander',
  GET_DIRECTIONS: 'Itinéraire',
  CALL_NOW: 'Appeler',
  SIGN_UP: "S'inscrire",
  CONTACT_US: 'Nous contacter',
  GET_OFFER: "Profiter de l'offre",
  GET_QUOTE: 'Demander un devis',
  APPLY_NOW: 'Postuler',
  MESSAGE_PAGE: 'Envoyer un message',
  WHATSAPP_MESSAGE: 'WhatsApp',
}

export const PLATEFORMES = ['facebook', 'instagram', 'messenger', 'audience_network']

/** Les questions standard d'un formulaire de leads Meta. */
export const LF_Q: Record<string, string> = {
  FULL_NAME: 'Nom complet',
  FIRST_NAME: 'Prénom',
  LAST_NAME: 'Nom',
  EMAIL: 'E-mail',
  PHONE: 'Téléphone',
  CITY: 'Ville',
  ZIP: 'Code postal',
  COMPANY_NAME: 'Société',
  JOB_TITLE: 'Fonction',
}

/** Sans position connue, l'assistant garde un centre (Bruxelles) pour son aperçu ; le serveur refuse de créer une pub sans la vraie position. */
export const CENTRE_PAR_DEFAUT: [number, number] = [50.8466, 4.3528]

/** Un montant en centimes, comme l'attend la Marketing API. */
export const cents = (v: number | string | null | undefined) => Math.round((Number(v) || 0) * 100)
