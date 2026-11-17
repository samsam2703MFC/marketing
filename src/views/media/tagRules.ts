import * as api from '../../lib/api/module'
import type { MediaAsset, MediaMoment, MediaProposalFamily, MediaProposalInput, MediaRef } from '../../lib/api/module'
import { webshopProducts } from './sources'
import type { WebshopProduct } from './sources'

/**
 * Les étiquettes proposées : ce que la médiathèque déduit seule, pour qu'on n'ait plus qu'à valider.
 *
 * Rien n'est inventé : chaque proposition dit d'après quoi elle est faite.
 *  - le produit : le nom de la photo comparé aux noms du webshop (ou la photo du webshop elle-même) ;
 *  - le moment : le rayon ou la catégorie du produit (« Viennoiserie → matin », « Traiteur → midi »,
 *    « Biscuiterie → après-midi ») — les créneaux de la régie d'affichage ;
 *  - la saison : un nom de saison dans le nom, le rayon ou la catégorie (« Noël », « Pâques »…) ;
 *  - le détourage : un fond transparent (lu dans le fichier, à l'import).
 * Le format (carré, portrait, paysage) n'est pas proposé : il se lit dans la taille.
 */

export interface ProposalDraft {
  family: MediaProposalFamily
  value: string
  label: string
  reason: string
}

/** Minuscules, sans accents, sans ponctuation : « Pâtisserie » → « patisserie ». */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Le mot ou l'expression, en mots entiers. */
function has(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `)
}

/** Ce qu'un nom de fichier porte en trop : numéros, « IMG », « copie », « final »… */
const NOISE = new Set(['img', 'dsc', 'dscn', 'pxl', 'photo', 'image', 'copie', 'copy', 'final', 'def', 'web', 'hd', 'jpg', 'jpeg', 'png', 'webp'])

function cleanName(name: string): string {
  return fold(name)
    .split(' ')
    .filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w) && !/^v\d+$/.test(w))
    .join(' ')
}

/** Les règles du moment, dans l'ordre : le salé passe avant la tarte (« Tartes salées » → midi). */
export const MOMENT_RULES: Array<{ moment: MediaMoment; label: string; words: string[] }> = [
  {
    moment: 'midi',
    label: 'midi',
    words: ['traiteur', 'sandwich', 'sandwichs', 'sandwiches', 'salade', 'salades', 'sale', 'sales', 'salee', 'salees', 'snack', 'snacking', 'lunch', 'plat', 'plats', 'quiche', 'quiches', 'pizza', 'pizzas', 'soupe', 'soupes', 'wrap', 'wraps', 'panini', 'club', 'bagel', 'bagels', 'croque', 'burger', 'burgers', 'pita', 'bowl', 'poke'],
  },
  {
    moment: 'matin',
    label: 'matin',
    words: ['viennoiserie', 'viennoiseries', 'croissant', 'croissants', 'petit dejeuner', 'petits dejeuners', 'brioche', 'brioches', 'couque', 'couques', 'chausson', 'chaussons', 'pain au chocolat', 'pains au chocolat', 'pain aux raisins', 'pains aux raisins'],
  },
  {
    moment: 'apres-midi',
    label: 'après-midi',
    words: ['patisserie', 'patisseries', 'biscuiterie', 'biscuit', 'biscuits', 'cookie', 'cookies', 'gateau', 'gateaux', 'tarte', 'tartes', 'tartelette', 'tartelettes', 'cupcake', 'cupcakes', 'entremets', 'gouter', 'glace', 'glaces', 'macaron', 'macarons', 'brownie', 'brownies', 'cake', 'cakes', 'muffin', 'muffins', 'eclair', 'eclairs', 'donut', 'donuts', 'cheesecake', 'tiramisu', 'crumble', 'gaufre', 'gaufres'],
  },
]

/** Les mots d'une saison (seules les saisons de la médiathèque sont proposées). */
const SEASON_WORDS: Record<string, string[]> = {
  noel: ['noel', 'nouvel an', 'buche', 'buches'],
  epiphanie: ['epiphanie', 'galette des rois', 'galettes des rois'],
  'saint-valentin': ['saint valentin', 'st valentin'],
  paques: ['paques'],
  'fete-des-meres': ['fete des meres'],
  'saint-nicolas': ['saint nicolas', 'st nicolas'],
  printemps: ['printemps'],
  ete: ['ete'],
  automne: ['automne'],
  hiver: ['hiver'],
}

/** Le produit du webshop que le nom désigne : le même nom, sinon le nom de produit le plus long qu'il contient. */
export function matchProduct(name: string, products: WebshopProduct[]): { product: WebshopProduct; reason: string } | null {
  const wanted = cleanName(name)
  if (wanted.length < 3) return null
  const exact = products.find((p) => fold(p.name) === wanted)
  if (exact) return { product: exact, reason: 'nom du webshop' }

  let best: WebshopProduct | null = null
  for (const p of products) {
    const own = fold(p.name)
    if (own.length >= 5 && has(wanted, own) && (!best || own.length > fold(best.name).length)) best = p
  }
  if (best) return { product: best, reason: `nom proche du webshop (« ${best.name} »)` }

  // Le nom du fichier, plus court, contenu dans un seul nom du webshop.
  if (wanted.length >= 6) {
    const inside = products.filter((p) => has(fold(p.name), wanted))
    if (inside.length === 1) return { product: inside[0], reason: `nom proche du webshop (« ${inside[0].name} »)` }
  }
  return null
}

/** Le moment tiré du premier texte qui parle : rayon, catégorie, classement, puis nom. */
export function matchMoment(texts: Array<{ kind: string; text: string | null | undefined }>): ProposalDraft | null {
  for (const { kind, text } of texts) {
    if (!text) continue
    const folded = fold(text)
    for (const rule of MOMENT_RULES) {
      if (rule.words.some((w) => has(folded, w))) {
        return { family: 'moment', value: rule.moment, label: api.MEDIA_MOMENTS.find((m) => m.value === rule.moment)?.label ?? rule.label, reason: `${kind} ${text} → ${rule.label}` }
      }
    }
  }
  return null
}

export function matchSeason(texts: Array<{ kind: string; text: string | null | undefined }>, seasons: MediaRef[]): ProposalDraft | null {
  for (const { kind, text } of texts) {
    if (!text) continue
    const folded = fold(text)
    for (const season of seasons) {
      const words = SEASON_WORDS[season.code]
      if (words?.some((w) => has(folded, w))) {
        return { family: 'saison', value: season.code, label: season.label, reason: `${kind} « ${text} »` }
      }
    }
  }
  return null
}

export interface ProposalInput {
  name: string
  /** La photo d'un produit du webshop : le produit est connu. */
  product?: WebshopProduct | null
  /** Catégorie et sous-catégorie de la médiathèque. */
  categories?: Array<string | null | undefined>
  /** Un fond transparent a été lu dans le fichier. */
  transparent?: boolean
  /** Ce que la fiche porte déjà : ces familles ne sont pas proposées. */
  has?: { moment?: boolean; product?: boolean; season?: boolean; cutout?: boolean }
}

/** Les propositions pour une image. */
export function proposeFor(input: ProposalInput, products: WebshopProduct[], seasons: MediaRef[]): ProposalDraft[] {
  const out: ProposalDraft[] = []
  const match = input.product ? { product: input.product, reason: 'photo du webshop' } : matchProduct(input.name, products)
  const product = match?.product ?? null
  if (match && !input.has?.product) out.push({ family: 'produit', value: String(match.product.id), label: match.product.name, reason: match.reason })

  const texts = [
    { kind: 'rayon', text: product?.rayon },
    { kind: 'catégorie', text: product?.categorie },
    ...(input.categories ?? []).map((text) => ({ kind: 'classement', text })),
    { kind: 'nom', text: product?.name ?? input.name },
  ]
  const moment = input.has?.moment ? null : matchMoment(texts)
  if (moment) out.push(moment)
  const season = input.has?.season ? null : matchSeason([{ kind: 'nom', text: input.name }, ...texts], seasons.filter((s) => s.code !== 'toute-annee'))
  if (season) out.push(season)
  if (input.transparent && !input.has?.cutout) out.push({ family: 'detouree', value: '1', label: 'Détourée', reason: 'fond transparent' })
  return out
}

/** Les propositions d'une fiche déjà dans la médiathèque. */
export function proposeForAsset(asset: MediaAsset, products: WebshopProduct[], seasons: MediaRef[], product?: WebshopProduct | null): MediaProposalInput[] {
  if (asset.kind !== 'image' || asset.archived) return []
  return proposeFor(
    {
      name: asset.name,
      product,
      categories: [asset.subcategory?.label, asset.category?.label],
      has: { moment: asset.tags.moments.length > 0, product: asset.tags.products.length > 0, season: asset.season !== null, cutout: asset.cutout },
    },
    products,
    seasons,
  ).map((p) => ({ mediaId: Number(asset.id), family: p.family, value: p.value, label: p.label, reason: p.reason }))
}

/**
 * Cherche et enregistre les propositions de fiches (après un dépôt, un versement depuis le webshop,
 * ou « Chercher des propositions »). Le webshop muet : rien n'est proposé, rien ne casse.
 */
export async function proposeForAssets(assets: MediaAsset[], seasons: MediaRef[], productOf?: (asset: MediaAsset) => WebshopProduct | null | undefined): Promise<{ created: number; proposals: number } | null> {
  const products = await webshopProducts().catch(() => [] as WebshopProduct[])
  const items = assets.flatMap((a) => proposeForAsset(a, products, seasons, productOf?.(a)))
  if (!items.length) return null
  let created = 0
  let proposals = 0
  for (let i = 0; i < items.length; i += 400) {
    const result = await api.proposeMediaTags(items.slice(i, i + 400))
    created += result.created
    proposals = result.proposals
  }
  return { created, proposals }
}
