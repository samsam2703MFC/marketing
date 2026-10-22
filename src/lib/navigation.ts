/**
 * Structure de navigation.
 *
 * Contrairement aux données métier, elle reste dans le code : ce sont des routes
 * et des libellés d'interface, pas du contenu éditable par le marketing. Le
 * modèle de données ne prévoit d'ailleurs aucune table pour cela.
 *
 * Les tracés d'icônes viennent du prototype et suivent la même famille visuelle
 * (linéaire, `stroke` 1,7, coins arrondis).
 */

export type Route =
  | 'dashboard'
  | 'calendar'
  | 'campaigns'
  | 'campaign'
  /** Éditeur des types de campagne — réseau seul, absent du menu franchisé. */
  | 'campaign-types'
  /** Les adresses du module et les réglages de cette version — réseau seul, lecture seule. */
  | 'addresses'
  /** Assistant de création — ouvert depuis « Campagnes », pas depuis le menu. */
  | 'builder'
  | 'promotions'
  | 'bundles'
  | 'vouchers'
  | 'physical'
  | 'digital'
  /** Canal « Newsletter, SMS & PWA » : les canaux de message activés par campagne (famille digitale). */
  | 'canal-messages'
  | 'agencies'
  | 'analysis'
  | 'roi'
  | 'crm'
  | 'funds'
  /** Écrans du module Social & Ads, affichés dans un cadre — réseau seul (voir SOCIAL_PAGES). */
  | 'social-cal'
  | 'social-grid'
  | 'social-post'
  | 'social-ctrl'
  | 'social-google'
  | 'social-ads'
  | 'social-camp'
  | 'social-roi'
  | 'social-bilan'
  | 'social-suivi'
  | 'social-fr'
  | 'social-leads'
  /** Paramètres du module Social : un écran, ouvert sur un onglet ou une section. */
  | 'social-set-conn'
  /** Le compte Google : fiches des boutiques (Business Profile), Google Ads, Analytics 4. */
  | 'social-set-google'
  | 'social-set-cles'
  | 'social-set-ids'
  | 'social-set-pf'
  | 'social-set-version'
  | 'social-set-dsa'
  | 'social-set-tpl'
  | 'social-set-grp'
  | 'social-set-rights'
  | 'social-set-log'
  | 'social-set-tfb'
  /**
   * Espace franchisé du module Social (/social_franchisee), affiché dans un cadre —
   * version franchisé seule. La boutique et les droits viennent de la session de
   * ce module (l'ERP), jamais de l'adresse.
   */
  | 'sf-cal'
  | 'sf-pub'
  | 'sf-com'
  | 'sf-msg'
  | 'sf-google'
  | 'sf-camp'
  | 'sf-ig'

export type Role = 'BRAND_ADMIN' | 'FRANCHISEE'

export interface NavItem {
  route: Route
  label: string
  icon: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
  /** Bouton en tête du groupe (« Nouvelle campagne »). */
  action?: { label: string; route: Route }
}

const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  campaigns: 'M3 11l14-7v16L3 13zM7 14v5',
  'campaign-types': 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7zM8 8h0M17 8h0',
  addresses: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  promotions: 'M19 5L5 19M7 7a1.5 1.5 0 1 0 .01 0M17 17a1.5 1.5 0 1 0 .01 0',
  bundles: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  vouchers: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM13 6v12',
  physical: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21',
  digital: 'M4 4h16v12H4zM2 20h20M9 8l4 2-4 2z',
  'canal-messages': 'M4 4h16v16H4zM4 4l8 8 8-8',
  agencies: 'M4 7h16v13H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18',
  analysis: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  roi: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  crm: 'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9',
  funds: 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h.5',
  'social-cal': 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01',
  'social-grid': 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  'social-post': 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  'social-ctrl': 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  'social-ads': 'M4 4h16v12H4zM2 20h20M9 8l4 2-4 2z',
  'social-camp': 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  'social-roi': 'M3 17l6-6 4 4 8-8M15 7h6v6',
  'social-suivi': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  'social-fr': 'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9',
  'social-leads': 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  'social-bilan': 'M3 3v18h18M7 15l4-4 3 3 5-6',
  'social-google': 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'social-set-conn': 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  'social-set-google': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5.2-5.2',
  'social-set-cles': 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  'social-set-ids': 'M4 6h16M4 12h16M4 18h10',
  'social-set-pf': 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  'social-set-version': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  'social-set-dsa': 'M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z',
  'social-set-tpl': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  'social-set-grp': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  'social-set-rights': 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 12 0v1M19 8v6M22 11h-6',
  'social-set-log': 'M12 8v4l3 3M3 12a9 9 0 1 0 9-9 9 9 0 0 0-9 9',
  'social-set-tfb': 'M4 17l6-6-6-6M12 19h8',
  'sf-cal': 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01',
  'sf-pub': 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  'sf-com': 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5',
  'sf-msg': 'M4 4h16v12H5.17L4 17.17V4zM22 2H2v22l4-4h16V2z',
  'sf-google': 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'sf-camp': 'M4 4h16v12H4zM2 20h20M9 8l4 2-4 2z',
  'sf-ig': 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
}

/**
 * Écran du module Social & Ads affiché par chaque route `social-*` : la clé de
 * page de ce module (`SA.href`) et son fichier. Le module renvoie la clé de
 * l'écran ouvert dans le cadre, ce qui permet au menu de suivre.
 */
export interface SocialPage {
  key: string
  file: string
  query?: string
  /** `franchise` : une page de l'espace franchisé (/social_franchisee), sinon un écran du réseau (/social). */
  space?: 'franchise'
}

export const SOCIAL_PAGES: Partial<Record<Route, SocialPage>> = {
  // Le calendrier éditorial : Facebook et Instagram ensemble, sans préfiltre (il s'ouvrait
  // filtré sur Facebook sous l'entrée « Facebook », et le filtre se remettait à zéro).
  'social-cal': { key: 'cal', file: 'SA Calendrier.dc.html' },
  'social-grid': { key: 'grid', file: 'SA Grille.dc.html' },
  'social-post': { key: 'post', file: 'SA Post.dc.html' },
  'social-ctrl': { key: 'ctrl', file: 'SA Controle.dc.html' },
  'social-google': { key: 'google', file: 'SA Google.dc.html' },
  'social-ads': { key: 'ads', file: 'SA Publicites.dc.html' },
  'social-camp': { key: 'camp', file: 'SA Campagnes.dc.html' },
  'social-roi': { key: 'roi', file: 'SA Retour.dc.html' },
  'social-bilan': { key: 'bilan', file: 'SA Bilan.dc.html' },
  'social-suivi': { key: 'suivi', file: 'SA Suivi.dc.html' },
  'social-fr': { key: 'fr', file: 'SA Franchise.dc.html' },
  'social-leads': { key: 'leads', file: 'SA Leads.dc.html' },
  'social-set-conn': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=conn' },
  'social-set-google': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=google' },
  'social-set-cles': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=api&section=cles' },
  'social-set-ids': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=api&section=ids' },
  'social-set-pf': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=api&section=pf' },
  'social-set-version': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=api&section=version' },
  'social-set-dsa': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=api&section=dsa' },
  'social-set-tpl': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=tpl' },
  'social-set-grp': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=grp' },
  'social-set-rights': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=rights' },
  'social-set-log': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=log' },
  'social-set-tfb': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=tfb' },
  // Espace franchisé : ses pages sous leur adresse propre ; ses clés sont préfixées « f: » (le module les annonce ainsi).
  'sf-cal': { key: 'f:cal', file: 'calendrier', space: 'franchise' },
  'sf-pub': { key: 'f:pub', file: 'publier', space: 'franchise' },
  'sf-com': { key: 'f:com', file: 'commentaires', space: 'franchise' },
  'sf-msg': { key: 'f:msg', file: 'messages', space: 'franchise' },
  'sf-google': { key: 'f:google', file: 'avis-google', space: 'franchise' },
  'sf-camp': { key: 'f:camp', file: 'operations', space: 'franchise' },
  'sf-ig': { key: 'f:ig', file: 'instagram', space: 'franchise' },
}

/** La page Social d'une route, si ce périmètre peut l'ouvrir : le réseau ses écrans, la boutique son espace. */
export function socialPageFor(role: Role, route: Route): SocialPage | null {
  const page = SOCIAL_PAGES[route]
  if (!page) return null
  return (page.space === 'franchise') === (role === 'FRANCHISEE') ? page : null
}

/**
 * La route qui affiche l'écran `key` du module Social, s'il en a une. Plusieurs
 * routes ouvrent le même écran (les Paramètres, sur un onglet ou une section) :
 * la route courante est gardée si elle l'affiche déjà.
 */
export function socialRoute(key: string, current?: Route): Route | null {
  if (current !== undefined && SOCIAL_PAGES[current]?.key === key) return current
  for (const [route, page] of Object.entries(SOCIAL_PAGES)) {
    if (page?.key === key) return route as Route
  }
  return null
}

function item(route: Route, label: string): NavItem {
  return { route, label, icon: ICONS[route] ?? '' }
}

/*
 * Le menu (22/10/2026) : chaque donnée à une seule place. Ce qui se montrait
 * sous plusieurs entrées — trois écrans de ROI, deux de diffusion, trois
 * d'offres, Bilan et Suivi — devient une entrée à onglets (TABS, plus bas).
 * Sortis du menu : « Posts & pubs par campagne », ouvert depuis la campagne
 * elle-même ; « Présence locale » et « Médiathèque & kit », vides (rien ne
 * remplit leurs tables) et doublés par les avis Google et le kit de l'espace
 * franchisé.
 */
const NETWORK: NavGroup[] = [
  // Le calendrier marketing réunit tout ce qui est prévu ou en cours, tous canaux confondus.
  { label: 'Pilotage', items: [item('dashboard', 'Tableau de bord'), item('calendar', 'Calendrier marketing')] },
  // La campagne au centre : on la crée par l'assistant ; ses posts, pubs et son
  // retour s'ouvrent depuis sa fiche.
  {
    label: 'Campagnes',
    action: { label: 'Nouvelle campagne', route: 'builder' },
    items: [item('campaigns', 'Campagnes')],
  },
  // Les écrans du module Social & Ads, affichés dans un cadre avec ses Pages et
  // son token Meta ; les commentaires et les messages privés se traitent dans
  // l'espace franchisé.
  {
    label: 'Réseaux sociaux',
    items: [
      item('social-cal', 'Calendrier éditorial'),
      item('social-post', 'Créer un post'),
      item('social-grid', 'Grille Instagram'),
      item('social-ads', 'Publicités Meta'),
      item('social-leads', 'Formulaires de leads'),
    ],
  },
  { label: 'Diffusion & offres', items: [item('physical', 'Diffusion'), item('promotions', 'Offres')] },
  {
    label: 'Boutiques',
    items: [
      item('social-bilan', 'Bilan des boutiques'),
      item('social-google', 'Avis & fiches Google'),
      item('social-ctrl', 'Contrôle des posts'),
      item('social-fr', 'Espace franchisé'),
      item('crm', 'Fidélité & CRM'),
    ],
  },
  {
    label: 'Budget & performance',
    items: [item('funds', 'Fonds marketing'), item('analysis', 'Performance'), item('agencies', 'Agences & prestataires')],
  },
  // Un seul écran de réglages (Meta, Google, TFBuddy, modèles, droits…) ; les types
  // de campagne, la grille de la première étape de l'assistant, y rejoignent.
  {
    label: 'Paramètres',
    items: [
      item('social-set-conn', 'Paramètres & connexions'),
      // Google à part : un compte qui sert trois outils (fiches, Ads, Analytics), à raccorder avant tout usage.
      item('social-set-google', 'Compte Google'),
      item('campaign-types', 'Types de campagne'),
      // Où vit chaque écran et avec quels réglages cette version a été construite (sans secret).
      item('addresses', 'Adresses et réglages'),
    ],
  },
]

const FRANCHISE: NavGroup[] = [
  { label: 'Ma boutique', items: [item('dashboard', 'Tableau de bord'), item('calendar', 'Calendrier réseau')] },
  { label: 'Mes actions', items: [item('campaigns', 'Mes campagnes')] },
  { label: 'Outils de campagne', items: [item('promotions', 'Promotions & bons')] },
  // L'espace franchisé du module Social & Ads : les réseaux sociaux de la boutique, dans le même menu.
  {
    label: 'Mes réseaux sociaux',
    items: [
      item('sf-cal', 'Calendrier & publications'),
      item('sf-pub', 'Créer un post'),
      item('sf-com', 'Commentaires'),
      item('sf-msg', 'Messages privés'),
      item('sf-google', 'Avis Google'),
      item('sf-camp', 'Publicités & opérations'),
      item('sf-ig', 'Grille Instagram'),
    ],
  },
  { label: 'Budget', items: [item('funds', 'Ma contribution')] },
]

export function navFor(role: Role): NavGroup[] {
  return role === 'FRANCHISEE' ? FRANCHISE : NETWORK
}

export interface Tab {
  route: Route
  label: string
}

/**
 * Entrées à onglets : la première route est celle du menu, les suivantes ses
 * onglets. Un écran n'appartient qu'à un groupe par périmètre.
 */
const TABS: Record<Role, Tab[][]> = {
  BRAND_ADMIN: [
    [
      { route: 'physical', label: 'Print & PLV' },
      { route: 'canal-messages', label: 'Newsletter, SMS & PWA' },
    ],
    [
      { route: 'promotions', label: 'Promotions' },
      { route: 'bundles', label: 'Bundles & menus' },
      { route: 'vouchers', label: 'Bons' },
    ],
    [
      { route: 'analysis', label: 'Par levier' },
      { route: 'roi', label: 'Par trimestre' },
      { route: 'social-roi', label: 'Par opération' },
    ],
    [
      { route: 'social-bilan', label: 'Classement de la semaine' },
      { route: 'social-suivi', label: 'Abonnés & budget' },
    ],
  ],
  FRANCHISEE: [
    [
      { route: 'promotions', label: 'Promotions' },
      { route: 'vouchers', label: 'Bons' },
    ],
  ],
}

/** Les onglets de l'entrée qui affiche cette route, s'il y en a. */
export function tabsFor(role: Role, route: Route): Tab[] | null {
  return TABS[role].find((group) => group.some((tab) => tab.route === route)) ?? null
}

/** L'entrée du menu qui affiche cette route : elle-même, ou la tête de son groupe d'onglets. */
export function menuRoute(role: Role, route: Route): Route {
  return tabsFor(role, route)?.[0].route ?? route
}

/** Titre de page, qui suit le rôle : « Campagnes » côté réseau, « Mes campagnes » côté boutique. */
export function titleFor(role: Role, route: Route, resuming = false): string {
  const head = menuRoute(role, route)
  for (const group of navFor(role)) {
    for (const entry of group.items) {
      if (entry.route === head) return entry.label
    }
  }

  // Ouvert depuis la fiche d'une campagne, plus depuis le menu.
  if (route === 'social-camp') return 'Posts & pubs par campagne'

  if (route === 'campaign') return 'Suivi de campagne'
  // Reprendre un brouillon et en créer un ne se ressemblent pas : sans cette
  // distinction, l'écran annonce « Nouvelle campagne » alors qu'il en rouvre une.
  if (route === 'builder') return resuming ? 'Reprendre la campagne' : 'Nouvelle campagne'

  return ''
}
