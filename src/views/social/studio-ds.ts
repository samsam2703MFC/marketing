/**
 * Le design system de la marque appliqué au visuel d'un post (repris de social/public/ds-catalogue.js) :
 * palette des fonds, ton de chaque style, couleurs du trait d'une illustration, polices et formes des
 * textes posés, modèles d'étiquette, logos. Ce sont des constantes de la charte, pas des données.
 *
 * Le visuel exporté garde ses propres polices (Gotham Light, Regular et Medium, Vank, Playwrite) : elles
 * sont déclarées sous des noms à part (`Studio …`, StudioVisuel.css) pour ne pas toucher au Gotham de
 * l'interface, qui suit le design system du Marketing (400 = Medium, 700 = Regular).
 */

/** Les fichiers de l'application (logo, polices) : le dossier public du Marketing. */
export const ASSET = (() => {
  const b = import.meta.env.BASE_URL || '/'
  return b.endsWith('/') ? b : `${b}/`
})()

export interface Fond {
  id: string
  nom: string
  hex: string
  ton: 'clair' | 'fonce'
}

export const FONDS: Fond[] = [
  { id: 'creme', nom: 'Crème', hex: '#F5EFE4', ton: 'clair' },
  { id: 'beige', nom: 'Beige', hex: '#EAE4DC', ton: 'clair' },
  { id: 'beige-clair', nom: 'Beige clair', hex: '#F4EFE8', ton: 'clair' },
  { id: 'blanc', nom: 'Blanc', hex: '#FFFFFF', ton: 'clair' },
  { id: 'abricot', nom: 'Abricot', hex: '#F2C9A0', ton: 'clair' },
  { id: 'ruby', nom: 'Ruby', hex: '#8D1D2C', ton: 'fonce' },
  { id: 'noir', nom: 'Noir', hex: '#232220', ton: 'fonce' },
  { id: 'popup', nom: 'Pop-Up', hex: '#78554B', ton: 'fonce' },
  { id: 'ambre', nom: 'Ambre foncé', hex: '#6B4420', ton: 'fonce' },
]

/** Le ton de chaque style du studio (les autres sont clairs) ; plein cadre : le fond est la photo (null). */
export const TONS: Record<string, 'clair' | 'fonce' | null> = {
  ruby: 'fonce',
  noir: 'fonce',
  encadre: 'fonce',
  nuit: 'fonce',
  plein: null,
  pleinbandeau: null,
  pleinencart: null,
  pleinhaut: null,
  pleinfilet: null,
}

/** Le ton d'un style (clair : texte foncé ; foncé : texte clair ; null : le fond est la photo). */
export const tonDe = (style: string) => (Object.prototype.hasOwnProperty.call(TONS, style) ? TONS[style] : 'clair')

export const TRAITS: { id: string; nom: string; hex: string | null }[] = [
  { id: 'origine', nom: 'D’origine', hex: null },
  { id: 'ruby', nom: 'Ruby', hex: '#8D1D2C' },
  { id: 'noir', nom: 'Noir', hex: '#232220' },
  { id: 'blanc', nom: 'Blanc', hex: '#FFFFFF' },
  { id: 'abricot', nom: 'Abricot', hex: '#F2C9A0' },
  { id: 'creme', nom: 'Crème', hex: '#F5EFE4' },
]

export interface Police {
  id: string
  nom: string
  detail: string
  font: string
  weight: number
  tt: string
  ls: string
}

export const POLICES: Police[] = [
  { id: 'titre', nom: 'Titre', detail: 'Vank', font: "'Studio Vank','Studio Gotham'", weight: 400, tt: 'uppercase', ls: '0' },
  { id: 'gras', nom: 'Gras', detail: 'Gotham Medium', font: "'Studio Gotham'", weight: 500, tt: 'uppercase', ls: '0.06em' },
  { id: 'texte', nom: 'Texte', detail: 'Gotham Light', font: "'Studio Gotham'", weight: 300, tt: 'none', ls: '0' },
  { id: 'script', nom: 'Manuscrit', detail: 'Playwrite', font: "'Studio Playwrite','Studio Gotham'", weight: 300, tt: 'none', ls: '0' },
]

export const FORMES = [
  { id: 'etiquette', nom: 'Étiquette' },
  { id: 'pastille', nom: 'Pastille' },
  { id: 'bandeau', nom: 'Bandeau' },
  { id: 'texte', nom: 'Texte seul' },
]

/** Un texte posé sur le visuel (promotion, formule, prix…) ; aussi la forme d'un modèle d'étiquette. */
export interface TextePose {
  id: string
  txt?: string
  sous?: string
  source?: string
  forme?: string
  police?: string
  couleur?: string | null
  fond?: string | null
  taille?: number
  rot?: number
  x?: number
  y?: number
}

export interface ModeleEtiquette extends Omit<TextePose, 'txt' | 'sous' | 'source'> {
  nom: string
  ds?: boolean
}

export const ETIQUETTES: ModeleEtiquette[] = [
  { id: 'ds-pastille-ruby', nom: 'Pastille Ruby', forme: 'pastille', police: 'titre', couleur: 'blanc', fond: 'ruby', taille: 72, rot: -8, x: 80, y: 24 },
  { id: 'ds-etiquette-abricot', nom: 'Étiquette Abricot', forme: 'etiquette', police: 'gras', couleur: 'noir', fond: 'abricot', taille: 48, rot: 0, x: 50, y: 84 },
  { id: 'ds-bandeau-noir', nom: 'Bandeau Noir', forme: 'bandeau', police: 'titre', couleur: 'creme', fond: 'noir', taille: 56, rot: 0, x: 50, y: 10 },
  { id: 'ds-pastille-creme', nom: 'Pastille Crème', forme: 'pastille', police: 'titre', couleur: 'ruby', fond: 'creme', taille: 64, rot: 6, x: 20, y: 76 },
  { id: 'ds-manuscrit-ruby', nom: 'Manuscrit Ruby', forme: 'texte', police: 'script', couleur: 'ruby', fond: null, taille: 52, rot: -4, x: 30, y: 30 },
]

export interface Logo {
  id: string
  nom: string
  src?: string
  hex?: string
  apercu?: string
}

/** Logo du visuel : selon le style, les fichiers d'origine (foncé, clair), ou recoloré (masque sur le logo blanc). */
export const LOGOS: Logo[] = [
  { id: 'auto', nom: 'Selon le style' },
  { id: 'fonce', nom: 'Foncé', src: `${ASSET}img/logo.png`, apercu: '#F5EFE4' },
  { id: 'clair', nom: 'Clair', src: `${ASSET}img/logo-white.png`, apercu: '#232220' },
  { id: 'noir', nom: 'Noir', hex: '#232220', apercu: '#F5EFE4' },
  { id: 'ruby', nom: 'Ruby', hex: '#8D1D2C', apercu: '#F5EFE4' },
  { id: 'abricot', nom: 'Abricot', hex: '#F2C9A0', apercu: '#232220' },
  { id: 'creme', nom: 'Crème', hex: '#F5EFE4', apercu: '#8D1D2C' },
]

/** Les formats du visuel : la planche garde 1080 px sur le petit côté, l'image sort aux dimensions de Meta. */
export interface Format {
  w: number
  h: number
  out: [number, number]
  ratio: string
}

export const FORMATS: Record<string, Format> = {
  carre: { w: 1080, h: 1080, out: [1080, 1080], ratio: '1/1' },
  portrait: { w: 1080, h: 1350, out: [1080, 1350], ratio: '4/5' },
  story: { w: 1080, h: 1920, out: [1080, 1920], ratio: '9/16' },
  paysage: { w: 2057, h: 1080, out: [1200, 630], ratio: '1200/630' },
}

/** Une photo du visuel (zoom 0,5–3, cadrage en % de la case). */
export interface PhotoVisuel {
  src: string
  cut?: boolean
  name?: string
  zoom?: number
  x?: number
  y?: number
}

/** Une illustration du design system posée sur le visuel. */
export interface IllusPosee {
  src: string
  name?: string
  x?: number
  y?: number
  taille?: number
  trait?: string
}

/** Les réglages du visuel composé, tels que le post les garde (`visual.v`). */
export interface Visuel {
  style: string
  format: string
  textes: TextePose[]
  fondu: number
  logo: string
  cutMode: string
  fond?: string | null
  illus?: IllusPosee | null
  couleurs?: Record<string, string>
  showLogo: boolean
  showEyebrow: boolean
  showTitle: boolean
  showPhrase: boolean
  showPrice: boolean
  showPromo: boolean
  showSite: boolean
  nl: { eyebrow: string; title: string; phrase: string; unit: string; promoSub: string }
  eyebrow: string
  title: string
  phrase: string
  price: string
  unit: string
  promo: string
  promoSub: string
  site: string
  phraseFont: string
  phraseColor: string
}

/** Une ligne du contrôle qualité du visuel. */
export interface Qc {
  niveau: 'erreur' | 'attention' | 'conseil'
  msg: string
}
