/**
 * Catalogue produits — miroir local partiel des tables ERP `product_category`
 * et `product` (marque 1), en attendant que TFBuddy expose des routes
 * catalogue. Même statut que `seasons.ts` : à remplacer par des appels API.
 *
 * Les produits sont rattachés ici à leur famille d'affichage (Tartes,
 * Pâtisserie…) plutôt qu'à leur catégorie feuille ERP (`11210`, `15400`…),
 * les identifiants restant ceux de l'ERP.
 */

export interface OfferCategory {
  /** `product_category.id` de la famille dans l'ERP. */
  id: number
  name: string
  /** Illustration servie depuis `public/img`. */
  image: string
}

export interface OfferProduct {
  /** `product.id` dans l'ERP. */
  id: number
  name: string
  /** Famille d'affichage (`OfferCategory.id`). */
  categoryId: number
}

export const CATEGORIES: OfferCategory[] = [
  { id: 11000, name: 'Tartes', image: '/img/sweet-tart-small.png' },
  { id: 15000, name: 'Pâtisserie', image: '/img/cake-slice.png' },
  { id: 12000, name: 'Pain', image: '/img/bread-1.png' },
  { id: 13000, name: 'Petite Boulangerie', image: '/img/rolls.png' },
  { id: 16000, name: 'Viennoiserie', image: '/img/croissant.png' },
  { id: 21300, name: 'Salades', image: '/img/salads.png' },
  { id: 32000, name: 'Biscuiterie', image: '/img/cookies.png' },
]

export const PRODUCTS: OfferProduct[] = [
  // Tartes
  { id: 1121001, name: 'Tarte Fraises', categoryId: 11000 },
  { id: 1121002, name: 'Tarte Framboises', categoryId: 11000 },
  { id: 1121003, name: 'Tarte TuttiFrutti', categoryId: 11000 },
  { id: 1122002, name: 'Croûte aux fraises', categoryId: 11000 },
  { id: 1131001, name: 'Tarte Sucre Blanc', categoryId: 11000 },
  { id: 1110105, name: 'Citron Meringué – 120⌀', categoryId: 11000 },
  { id: 1110106, name: 'Passion Sauvage – 120⌀', categoryId: 11000 },
  // Pâtisserie
  { id: 1540001, name: 'Éclair chocolat', categoryId: 15000 },
  { id: 1540009, name: 'Mousse au chocolat', categoryId: 15000 },
  { id: 1540010, name: 'Tiramisu', categoryId: 15000 },
  { id: 1540013, name: 'Mousse Passion & Coulis de Framboise', categoryId: 15000 },
  { id: 1540017, name: 'Sablé Plougastel – Fraise', categoryId: 15000 },
  // Pain
  { id: 1200001, name: 'Pain Demi-Gris', categoryId: 12000 },
  { id: 1200002, name: 'Pain 10 Céréales', categoryId: 12000 },
  { id: 1200003, name: 'Pain Doré', categoryId: 12000 },
  { id: 1200005, name: 'Fermier Seigle & Levain', categoryId: 12000 },
  { id: 1200006, name: 'Pavé Seigle & Froment', categoryId: 12000 },
  // Petite Boulangerie
  { id: 1300003, name: 'Baguette Tradition 500 g.', categoryId: 13000 },
  { id: 1300004, name: 'Pistolet Seigle & Céréales', categoryId: 13000 },
  { id: 1300005, name: 'Brioche tressée au sucre perlé', categoryId: 13000 },
  { id: 1300007, name: 'Cramique', categoryId: 13000 },
  { id: 1300008, name: 'Craquelin', categoryId: 13000 },
  // Viennoiserie
  { id: 1610006, name: 'Croissant', categoryId: 16000 },
  { id: 1610001, name: 'Croissant Amandes', categoryId: 16000 },
  { id: 1610004, name: 'Pain au Chocolat', categoryId: 16000 },
  { id: 1610002, name: 'Suisse', categoryId: 16000 },
  { id: 1610007, name: 'Gosette Pomme', categoryId: 16000 },
  // Salades
  { id: 2130001, name: 'Salade Campagnarde', categoryId: 21300 },
  { id: 2130002, name: 'Salade Italienne', categoryId: 21300 },
  { id: 2130003, name: 'Salade Saumon fumé', categoryId: 21300 },
  { id: 2130004, name: 'Salade Poulet & Parmesan', categoryId: 21300 },
  { id: 2130005, name: 'Salade Grecque', categoryId: 21300 },
  { id: 2130006, name: 'Salade Chèvre', categoryId: 21300 },
  // Biscuiterie
  { id: 3210001, name: 'Cookie Chocolat Blanc', categoryId: 32000 },
  { id: 3210002, name: 'Cookie Chocolat Noir', categoryId: 32000 },
  { id: 3210003, name: 'Cookie Double Chocolat', categoryId: 32000 },
  { id: 3200006, name: 'Amandes & Cannelles – 100 g', categoryId: 32000 },
  { id: 3200007, name: 'Rocher Coco', categoryId: 32000 },
]
