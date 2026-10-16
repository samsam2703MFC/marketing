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
  | 'social-com'
  | 'social-google'
  | 'social-ads'
  | 'social-camp'
  | 'social-roi'
  | 'social-suivi'
  | 'social-fr'
  | 'social-leads'
  /** Paramètres du module Social : un écran, ouvert sur un onglet ou une section. */
  | 'social-set-conn'
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
  'social-com': 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5',
  'social-google': 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'social-set-conn': 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
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
}

/**
 * Écran du module Social & Ads affiché par chaque route `social-*` : la clé de
 * page de ce module (`SA.href`) et son fichier. Le module renvoie la clé de
 * l'écran ouvert dans le cadre, ce qui permet au menu de suivre.
 */
export const SOCIAL_PAGES: Partial<Record<Route, { key: string; file: string; query?: string }>> = {
  'social-cal': { key: 'cal', file: 'SA Calendrier.dc.html' },
  'social-grid': { key: 'grid', file: 'SA Grille.dc.html' },
  'social-post': { key: 'post', file: 'SA Post.dc.html' },
  'social-ctrl': { key: 'ctrl', file: 'SA Controle.dc.html' },
  'social-com': { key: 'com', file: 'SA Commentaires.dc.html' },
  'social-google': { key: 'google', file: 'SA Google.dc.html' },
  'social-ads': { key: 'ads', file: 'SA Publicites.dc.html' },
  'social-camp': { key: 'camp', file: 'SA Campagnes.dc.html' },
  'social-roi': { key: 'roi', file: 'SA Retour.dc.html' },
  'social-suivi': { key: 'suivi', file: 'SA Suivi.dc.html' },
  'social-fr': { key: 'fr', file: 'SA Franchise.dc.html' },
  'social-leads': { key: 'leads', file: 'SA Leads.dc.html' },
  'social-set-conn': { key: 'set', file: 'SA Parametres.dc.html', query: 'tab=conn' },
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
      item('social-com', 'Commentaires (vert, orange, rouge)'),
      item('social-google', 'Avis Google (réputation digitale)'),
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
    ],
  },
  // Le paramétrage du module Social, Meta en tête : chaque entrée ouvre l'écran
  // Paramètres sur son onglet, ou sur sa section de l'onglet « API Meta ».
  {
    label: 'Paramètres Meta & Social',
    items: [
      item('social-set-conn', 'Connexions Meta'),
      item('social-set-cles', 'Clés d’accès & token'),
      item('social-set-ids', 'Identifiants par boutique'),
      item('social-set-pf', 'Portefeuille Business Manager'),
      item('social-set-version', 'Version & permissions'),
      item('social-set-dsa', 'Transparence UE (DSA)'),
      item('social-set-tpl', 'Modèles de posts'),
      item('social-set-grp', 'Groupes de boutiques'),
      item('social-set-rights', 'Droits'),
      item('social-set-log', 'Journal d’activité'),
      item('social-set-tfb', 'API TFBuddy'),
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
