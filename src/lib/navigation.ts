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
  /** Assistant de création — ouvert depuis « Campagnes », pas depuis le menu. */
  | 'builder'
  | 'promotions'
  | 'bundles'
  | 'vouchers'
  | 'physical'
  | 'digital'
  | 'agencies'
  | 'analysis'
  | 'roi'
  | 'crm'
  | 'funds'
  | 'local'
  | 'dam'
  /** Écrans du module Social & Ads, affichés dans un cadre — réseau seul (voir SOCIAL_PAGES). */
  | 'social-cal'
  | 'social-grid'
  | 'social-post'
  | 'social-ctrl'
  | 'social-ads'
  | 'social-camp'
  | 'social-roi'
  | 'social-suivi'
  | 'social-fr'
  | 'social-leads'
  | 'social-set'

export type Role = 'BRAND_ADMIN' | 'FRANCHISEE'

export interface NavItem {
  route: Route
  label: string
  icon: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  campaigns: 'M3 11l14-7v16L3 13zM7 14v5',
  'campaign-types': 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7zM8 8h0M17 8h0',
  promotions: 'M19 5L5 19M7 7a1.5 1.5 0 1 0 .01 0M17 17a1.5 1.5 0 1 0 .01 0',
  bundles: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  vouchers: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM13 6v12',
  physical: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21',
  digital: 'M4 4h16v12H4zM2 20h20M9 8l4 2-4 2z',
  agencies: 'M4 7h16v13H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18',
  analysis: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  roi: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  crm: 'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9',
  funds: 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h.5',
  local: 'M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11zM12 8a2 2 0 1 0 .01 0',
  dam: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
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
  'social-set': 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
}

/**
 * Écran du module Social & Ads affiché par chaque route `social-*` : la clé de
 * page de ce module (`SA.href`) et son fichier. Le module renvoie la clé de
 * l'écran ouvert dans le cadre, ce qui permet au menu de suivre.
 */
export const SOCIAL_PAGES: Partial<Record<Route, { key: string; file: string }>> = {
  'social-cal': { key: 'cal', file: 'SA Calendrier.dc.html' },
  'social-grid': { key: 'grid', file: 'SA Grille.dc.html' },
  'social-post': { key: 'post', file: 'SA Post.dc.html' },
  'social-ctrl': { key: 'ctrl', file: 'SA Controle.dc.html' },
  'social-ads': { key: 'ads', file: 'SA Publicites.dc.html' },
  'social-camp': { key: 'camp', file: 'SA Campagnes.dc.html' },
  'social-roi': { key: 'roi', file: 'SA Retour.dc.html' },
  'social-suivi': { key: 'suivi', file: 'SA Suivi.dc.html' },
  'social-fr': { key: 'fr', file: 'SA Franchise.dc.html' },
  'social-leads': { key: 'leads', file: 'SA Leads.dc.html' },
  'social-set': { key: 'set', file: 'SA Parametres.dc.html' },
}

/** La route qui affiche l'écran `key` du module Social, s'il en a une. */
export function socialRoute(key: string): Route | null {
  for (const [route, page] of Object.entries(SOCIAL_PAGES)) {
    if (page?.key === key) return route as Route
  }
  return null
}

function item(route: Route, label: string): NavItem {
  return { route, label, icon: ICONS[route] ?? '' }
}

const NETWORK: NavGroup[] = [
  { label: 'Pilotage', items: [item('dashboard', 'Tableau de bord'), item('calendar', 'Calendrier marketing')] },
  {
    label: 'Campagnes',
    // L'éditeur des types vit à côté des campagnes, et non dans un réglage à
    // part : c'est la grille qu'on voit à la première étape de l'assistant, et
    // on y revient en pensant « campagnes », pas « paramètres ».
    items: [item('campaigns', 'Campagnes'), item('campaign-types', 'Types de campagne')],
  },
  {
    label: 'Outils de campagne',
    items: [item('promotions', 'Promotions'), item('bundles', 'Bundles & Menus'), item('vouchers', 'Vouchers / Bons')],
  },
  {
    label: 'Diffusion',
    items: [item('physical', 'Pub physique & PLV'), item('digital', 'Pub digitale'), item('agencies', 'Agences & prestataires')],
  },
  // Les écrans vivent dans le module Social & Ads (/social) : ils sont affichés
  // tels quels, dans un cadre, et publient avec les Pages et le token Meta de ce
  // module. Leur menu propre est masqué, celui-ci le remplace.
  {
    label: 'Social & Ads',
    items: [
      item('social-cal', 'Calendrier Meta & Instagram'),
      item('social-grid', 'Grille Instagram'),
      item('social-post', 'Créer un post'),
      item('social-ctrl', 'Contrôle des posts'),
      item('social-ads', 'Publicités Meta'),
      item('social-camp', 'Posts & pubs par campagne'),
    ],
  },
  {
    label: 'Social & Ads · pilotage',
    items: [
      item('social-suivi', 'Suivi des boutiques'),
      item('social-roi', 'Retour sur opération'),
      item('social-fr', 'Espace franchisé'),
      item('social-leads', 'Formulaires de leads'),
      item('social-set', 'Paramètres Social & Ads'),
    ],
  },
  { label: 'Performance', items: [item('analysis', 'Marketing Analyse'), item('roi', 'ROI & rentabilité')] },
  {
    label: 'Réseau',
    items: [
      item('crm', 'Fidélité & CRM'),
      item('funds', 'Fonds marketing'),
      item('local', 'Présence locale'),
      item('dam', 'Kit local & DAM'),
    ],
  },
]

const FRANCHISE: NavGroup[] = [
  { label: 'Ma boutique', items: [item('dashboard', 'Tableau de bord'), item('calendar', 'Calendrier réseau')] },
  { label: 'Mes actions', items: [item('campaigns', 'Mes campagnes')] },
  { label: 'Outils de campagne', items: [item('promotions', 'Promotions'), item('vouchers', 'Vouchers / Bons')] },
  { label: 'Terrain', items: [item('dam', 'Kit clé-en-main'), item('local', 'Ma présence locale')] },
  { label: 'Budget', items: [item('funds', 'Ma contribution')] },
]

export function navFor(role: Role): NavGroup[] {
  return role === 'FRANCHISEE' ? FRANCHISE : NETWORK
}

/** Titre de page, qui suit le rôle : « Campagnes » côté réseau, « Mes campagnes » côté boutique. */
export function titleFor(role: Role, route: Route, resuming = false): string {
  for (const group of navFor(role)) {
    for (const entry of group.items) {
      if (entry.route === route) return entry.label
    }
  }

  if (route === 'campaign') return 'Suivi de campagne'
  // Reprendre un brouillon et en créer un ne se ressemblent pas : sans cette
  // distinction, l'écran annonce « Nouvelle campagne » alors qu'il en rouvre une.
  if (route === 'builder') return resuming ? 'Reprendre la campagne' : 'Nouvelle campagne'

  return ''
}
