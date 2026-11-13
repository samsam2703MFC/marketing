// Palette de la marque — SOURCE UNIQUE des couleurs proposées en régie (fonds
// d'écran, couleurs de texte des scènes, listes de choix…). Les valeurs sont
// celles déjà utilisées partout dans le rendu et dans le back office : ajouter
// une teinte ici la rend disponible d'un coup dans toutes les listes de couleurs.
// Aucun import, aucun DOM : ce module tourne aussi côté serveur.
export const RUBY = '#8D1D2C';
export const INK = '#232220';
// Fond crème des écrans (le « canevas » de tous les éléments).
export const STAGE_BG = '#F5EFE4';

export const BRAND_COLORS = [
  { id: 'noir', name: 'Noir', hex: '#000000' },
  { id: 'encre', name: 'Encre', hex: '#232220' },
  { id: 'rubis', name: 'Rubis', hex: '#8D1D2C' },
  { id: 'terre', name: 'Terre', hex: '#6E4A2B' },
  { id: 'caramel', name: 'Caramel', hex: '#C97B4A' },
  { id: 'or', name: 'Or', hex: '#B8860B' },
  { id: 'vert', name: 'Vert', hex: '#2E6E4E' },
  { id: 'gris', name: 'Gris', hex: '#8A847C' },
  { id: 'lin', name: 'Lin', hex: '#E7E1D8' },
  { id: 'sable', name: 'Sable', hex: '#EFE9E0' },
  { id: 'creme', name: 'Crème', hex: '#FBF8F2' },
  { id: 'fond', name: 'Fond des écrans', hex: '#F5EFE4' },
  { id: 'blanc', name: 'Blanc', hex: '#FFFFFF' },
];
