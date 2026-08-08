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
}

function item(route: Route, label: string): NavItem {
  return { route, label, icon: ICONS[route] ?? '' }
}

const NETWORK: NavGroup[] = [
  { label: 'Pilotage', items: [item('dashboard', 'Tableau de bord'), item('calendar', 'Calendrier marketing')] },
  { label: 'Campagnes', items: [item('campaigns', 'Campagnes')] },
  {
    label: 'Outils de campagne',
    items: [item('promotions', 'Promotions'), item('bundles', 'Bundles & Menus'), item('vouchers', 'Vouchers / Bons')],
  },
  {
    label: 'Diffusion',
    items: [item('physical', 'Pub physique & PLV'), item('digital', 'Pub digitale'), item('agencies', 'Agences & prestataires')],
  },
  { label: 'Performance', items: [item('analysis', 'Marketing Analyse'), item('roi', 'ROI & rentabilité')] },
  {
    label: 'Réseau',
    items: [
      item('crm', 'Fidélité & CRM'),
      item('funds', 'Fonds & Royalties'),
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
