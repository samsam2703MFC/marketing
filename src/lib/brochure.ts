import type {
  BrochureFormat,
  BrochureSettings,
  PrintFile,
  PrintMechanic,
  PrintProduct,
  SavedBrochure,
  Shop,
  SocialShop,
} from './api/module'
import { familyImage, seasonImage, seasonLabel } from '../views/builder/illustrations'

/**
 * Le générateur de brochures : leaflet A5 recto-verso, dépliant A4 trois volets.
 *
 * Le contenu vient du dossier d'impression de la campagne (offre, produits,
 * prix, conditions, palette) et des boutiques telles que le module Social les
 * tient (adresse, horaires, téléphone, langues). Ce fichier n'invente rien :
 * un prix douteux reste « à confirmer », un texte néerlandais qu'aucune donnée
 * ne fournit reste « à écrire », et le contrôle avant impression les nomme.
 */

export type Lang = 'fr' | 'nl'

export type TextKey =
  | 'eyebrow'
  | 'title'
  | 'phrase'
  | 'cta'
  | 'ctaSub'
  | 'innerTitle'
  | 'innerSub'
  | 'flapTitle'
  | 'flapText'
  | 'conditions'

export const TEXT_LABELS: Record<TextKey, string> = {
  eyebrow: 'Surtitre',
  title: 'Titre',
  phrase: 'Accroche',
  cta: 'Appel à l’action',
  ctaSub: 'Sous l’appel',
  innerTitle: 'Titre des produits',
  innerSub: 'Sous-titre des produits',
  flapTitle: 'Titre du rabat',
  flapText: 'Texte du rabat',
  conditions: 'Période et conditions',
}

/** Les textes que chaque support imprime, dans l'ordre de lecture. */
export const FORMAT_TEXTS: Record<BrochureFormat, TextKey[]> = {
  'leaflet-a5': ['eyebrow', 'title', 'phrase', 'cta', 'ctaSub', 'innerTitle', 'innerSub', 'conditions'],
  'depliant-a4': ['eyebrow', 'title', 'phrase', 'innerTitle', 'innerSub', 'cta', 'flapTitle', 'flapText', 'conditions'],
}

/** Textes propres à la campagne : aucune donnée ne les donne en néerlandais, ils s'écrivent. */
const FREE_TEXT: TextKey[] = ['eyebrow', 'title', 'phrase', 'innerSub']

export interface FormatDef {
  id: BrochureFormat
  label: string
  sub: string
  /** Format fini, en millimètres. */
  trimW: number
  trimH: number
  faces: [string, string]
  /** Produits qu'il porte au plus. */
  maxProducts: number
}

export const FORMATS: Record<BrochureFormat, FormatDef> = {
  'leaflet-a5': { id: 'leaflet-a5', label: 'Leaflet A5', sub: '148 × 210 mm · recto-verso', trimW: 148, trimH: 210, faces: ['Recto', 'Verso'], maxProducts: 6 },
  'depliant-a4': { id: 'depliant-a4', label: 'Dépliant A4', sub: '297 × 210 mm · 3 volets roulés', trimW: 297, trimH: 210, faces: ['Extérieur', 'Intérieur'], maxProducts: 9 },
}

/** Fond perdu et marge des traits de coupe, en millimètres. */
export const BLEED = 3
export const MARKS = 7

/**
 * Volets d'un dépliant roulé : le rabat qui se replie à l'intérieur est plus étroit de 3 mm, sans
 * quoi il bute sur le pli. Extérieur : rabat, dos, couverture ; intérieur : l'envers, dans l'autre sens.
 */
export const FOLD_PANELS = { outside: [97, 100, 100], inside: [100, 100, 97] } as const

export interface TemplateDef {
  id: string
  name: string
  hint: string
}

export const TEMPLATES: TemplateDef[] = [
  { id: 'fetes', name: 'Fêtes', hint: 'illustration de la gamme' },
  { id: 'epure', name: 'Épuré', hint: 'un produit, son prix' },
  { id: 'ruby', name: 'Ruby', hint: 'fond plein, couleur de la campagne' },
  { id: 'abricot', name: 'Abricot', hint: 'titre fort, trois produits' },
  { id: 'noir', name: 'Noir', hint: 'vitrine, effet nuit' },
  { id: 'duo', name: 'Duo', hint: 'titre à gauche, produits à droite' },
  { id: 'carte', name: 'Carte', hint: 'façon menu, prix alignés' },
]

// ---------------------------------------------------------------------------
// Boutiques et versions
// ---------------------------------------------------------------------------

/** Une boutique prête à imprimer : identité de ce module, coordonnées du module Social. */
export interface BrochureShop {
  /** Identifiant de ce module (`mar_shop`). */
  id: number
  /** Numéro de caisse (code `erp-N`), celui du webshop. */
  n: number | null
  name: string
  address: string
  hours: string
  hoursNl: string
  phone: string
  langs: Lang[]
  test: boolean
  /** Le module Social ne connaît pas cette boutique : ses coordonnées manquent. */
  unknown: boolean
}

const shopNumber = (shop: Shop): number | null => {
  const match = /^erp-(\d+)$/.exec(shop.code)
  return match ? Number(match[1]) : null
}

const langsOf = (raw: string[] | undefined): Lang[] => {
  const langs = (raw ?? []).filter((lang): lang is Lang => lang === 'fr' || lang === 'nl')
  return langs.length ? langs : ['fr']
}

/**
 * Les boutiques d'une campagne : celles qu'elle vise, ou tout le périmètre pour une campagne réseau
 * qui n'en nomme aucune (« tout le réseau »).
 */
export function campaignShops(
  scope: 'RESEAU' | 'LOCALE',
  targeted: Array<{ shop_id: number }>,
  perimeter: Shop[],
  social: SocialShop[],
): BrochureShop[] {
  const ids = new Set(targeted.map((shop) => shop.shop_id))
  const chosen = scope === 'RESEAU' && ids.size === 0 ? perimeter : perimeter.filter((shop) => ids.has(shop.id))

  return chosen.map((shop) => {
    const n = shopNumber(shop)
    const known = n === null ? undefined : social.find((row) => Number(row.id) === n)

    return {
      id: shop.id,
      n,
      name: known?.name || shop.name,
      address: known?.address?.trim() ?? '',
      hours: known?.hours?.trim() ?? '',
      hoursNl: known?.hoursNl?.trim() ?? '',
      phone: known?.phone?.trim() ?? '',
      langs: langsOf(known?.langs),
      test: known?.test === true,
      unknown: known === undefined,
    }
  })
}

export interface Version {
  key: string
  shop: BrochureShop | null
  lang: Lang
  label: string
}

/**
 * Les versions à tirer : une générale par langue de la marque, puis une par boutique et par
 * langue de la boutique. Une boutique bilingue en reçoit deux ; une boutique écartée, aucune.
 */
export function buildVersions(shops: BrochureShop[], excluded: number[], brandLangs: Lang[]): Version[] {
  const versions: Version[] = brandLangs.map((lang) => ({
    key: `general-${lang}`,
    shop: null,
    lang,
    label: `Générale · ${lang.toUpperCase()}`,
  }))

  for (const shop of shops) {
    if (excluded.includes(shop.id)) continue
    for (const lang of shop.langs) {
      versions.push({ key: `shop-${shop.id}-${lang}`, shop, lang, label: `${shop.name} · ${lang.toUpperCase()}` })
    }
  }

  return versions
}

export const brandLangsOf = (raw: string[] | undefined): Lang[] => {
  const langs = langsOf(raw)
  return langs.includes('fr') ? (['fr', ...langs.filter((lang) => lang !== 'fr')] as Lang[]) : langs
}

// ---------------------------------------------------------------------------
// Produits et prix
// ---------------------------------------------------------------------------

export const productKey = (product: PrintProduct): string => product.sku_ref ?? product.label

/**
 * Le nom et la précision d'un libellé : « Bûche Praliné & Noisettes – 4/6 personnes » se lit
 * « Bûche Praliné & Noisettes », puis « 4/6 personnes ». Seul un dernier segment chiffré se détache.
 */
export function splitLabel(label: string): { name: string; sub: string } {
  const parts = label.split(/\s+[–—-]\s+/u)
  if (parts.length > 1 && /\d/.test(parts[parts.length - 1])) {
    return { name: parts.slice(0, -1).join(' – '), sub: parts[parts.length - 1] }
  }
  return { name: label, sub: '' }
}

/** Le prix que l'offre affiche sans saisie : après mécanique, sinon le prix de départ. */
const autoPrice = (product: PrintProduct): number | null => product.price_after ?? product.price_before

/**
 * Un prix douteux ne part pas à l'impression : absent, ou à 1,00 € ou moins — le prix par défaut
 * de l'ERP pour un article dont le tarif n'a pas été saisi.
 */
export const doubtfulPrice = (product: PrintProduct): boolean => {
  const price = autoPrice(product)
  return price === null || price <= 1
}

export interface BrochureProduct {
  key: string
  name: string
  sub: string
  family: string | null
  image: string | null
  /** L'image est le dessin de la famille, pas la photo du produit. */
  illustration: boolean
  /** Prix barré, quand la mécanique en donne un autre. */
  before: number | null
  price: number | null
  /** Prix douteux et non saisi : imprimé « ? € » en épreuve, bloquant pour l'imprimeur. */
  toConfirm: boolean
  manual: boolean
  mechanic: PrintMechanic | null
}

export function resolveProduct(product: PrintProduct, manual: number | null): BrochureProduct {
  const { name, sub } = splitLabel(product.label)
  const photo = product.options.show_photo ? product.image_url : null
  // Le dessin de la famille (viennoiserie, pâtisserie…), jamais celui de la saison : un sapin à côté de
  // chaque bûche ne montrerait aucun produit.
  const drawing = photo ? null : familyImage(product.family ?? '')
  const auto = autoPrice(product)
  const discounted = product.price_after !== null && product.price_before !== null && product.price_after < product.price_before

  return {
    key: productKey(product),
    name,
    sub,
    family: product.family,
    image: photo ?? drawing,
    illustration: photo === null && drawing !== null,
    before: manual === null && discounted ? product.price_before : null,
    price: manual ?? (doubtfulPrice(product) ? null : auto),
    toConfirm: manual === null && doubtfulPrice(product),
    manual: manual !== null,
    mechanic: product.mechanic,
  }
}

/** Les produits cochés, dans l'ordre des réglages. */
export function chosenProducts(file: PrintFile, settings: BrochureSettings): BrochureProduct[] {
  const byKey = new Map(file.products.map((product) => [productKey(product), product]))
  return settings.products
    .filter((row) => row.on && byKey.has(row.key))
    .map((row) => resolveProduct(byKey.get(row.key) as PrintProduct, row.price))
}

export function formatPrice(amount: number, lang: Lang): string {
  return amount.toLocaleString(lang === 'nl' ? 'nl-BE' : 'fr-BE', { style: 'currency', currency: 'EUR' })
}

const decimal = (value: number): string => String(value).replace('.', ',')

export function mechanicText(mechanic: PrintMechanic | null, lang: Lang): string | null {
  if (!mechanic) return null
  if (lang === 'fr') return mechanic.text
  switch (mechanic.type) {
    case 'PERCENT':
      return mechanic.value === null ? null : `−${decimal(mechanic.value)} %`
    case 'BUY_X_GET_Y':
      return mechanic.buy && mechanic.get ? `${mechanic.buy} + ${mechanic.get} gratis` : null
    case 'FREE_DELIVERY':
      return 'Gratis levering'
    case 'CROSSED_PRICE':
    case 'BUNDLE_FIXED':
      return mechanic.value === null ? null : formatPrice(mechanic.value, 'nl')
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------

const MONTHS: Record<Lang, string[]> = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
}

const longDate = (iso: string, lang: Lang): string => {
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS[lang][month - 1]} ${year}`
}

/** Période et conditions en néerlandais, tirées de l'offre comme le dossier d'impression les tire en français. */
function conditionsNl(file: PrintFile): { text: string; untranslated: string | null } {
  const offer = file.offer
  const from = offer?.starts_on ?? file.campaign.starts_on
  const to = offer?.ends_on ?? file.campaign.ends_on
  const parts: string[] = []

  if (from && to) parts.push(`Van ${longDate(from, 'nl')} tot en met ${longDate(to, 'nl')}`)
  if (offer && offer.is_cumulative === false) parts.push('Niet cumuleerbaar met andere promoties')
  if (offer?.max_qty_per_ticket) parts.push(`${offer.max_qty_per_ticket} per kasticket`)
  if (offer?.hour_from && offer.hour_to) parts.push(`van ${offer.hour_from.slice(0, 5)} tot ${offer.hour_to.slice(0, 5)}`)
  // Le périmètre de l'offre est un texte libre, saisi en français : il passe tel quel, et le contrôle le signale.
  const scope = offer?.scope_label?.trim() || null
  if (scope) parts.push(scope)

  return { text: parts.join(' · '), untranslated: scope }
}

export const webshopHost = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/+$/, '')

/**
 * Les textes par défaut d'une langue. `null` : aucune donnée ne le donne dans cette langue, il
 * s'écrit (le contrôle avant impression le demande).
 */
export function defaultTexts(file: PrintFile, lang: Lang, host: string): Record<TextKey, string | null> {
  const year = (file.offer?.starts_on ?? file.campaign.starts_on ?? '').slice(0, 4)
  const season = file.campaign.type_label ? seasonLabel(file.campaign.type_label) : ''

  if (lang === 'nl') {
    return {
      eyebrow: null,
      title: null,
      phrase: null,
      cta: 'Bestel in de winkel of online',
      ctaSub: host,
      innerTitle: 'Onze selectie',
      innerSub: null,
      flapTitle: 'Bestel, wij maken het klaar',
      flapText: 'Reserveer in de winkel of via de webshop en haal je bestelling af op de dag van je keuze.',
      conditions: conditionsNl(file).text,
    }
  }

  return {
    eyebrow: [season, year].filter(Boolean).join(' '),
    title: file.offer?.title || file.campaign.name,
    phrase: file.offer?.mechanic_text ?? '',
    cta: 'Commandez en boutique ou en ligne',
    ctaSub: host,
    innerTitle: 'Notre sélection',
    innerSub: '',
    flapTitle: 'Commandez, on prépare',
    flapText: 'Réservez en boutique ou sur le webshop, et passez chercher votre commande le jour de votre choix.',
    conditions: [file.legal.period_text, file.legal.conditions_text].filter(Boolean).join(' · '),
  }
}

/** Le texte saisi, sinon celui par défaut. En néerlandais, un texte à écrire montre le français en attendant. */
export function textsFor(file: PrintFile, settings: BrochureSettings, lang: Lang, host: string): Record<TextKey, string> {
  const frDefaults = defaultTexts(file, 'fr', host)
  const defaults = defaultTexts(file, lang, host)
  const out = {} as Record<TextKey, string>

  for (const key of Object.keys(TEXT_LABELS) as TextKey[]) {
    const fr = settings.texts.fr?.[key] ?? frDefaults[key] ?? ''
    const own = settings.texts[lang]?.[key]
    out[key] = own ?? defaults[key] ?? (lang === 'nl' ? fr : '')
  }

  return out
}

/** Les textes néerlandais à écrire pour ce support : ceux qui ont un texte français et aucune traduction. */
export function missingDutch(file: PrintFile, settings: BrochureSettings, format: BrochureFormat, host: string): TextKey[] {
  const frDefaults = defaultTexts(file, 'fr', host)
  return FORMAT_TEXTS[format].filter((key) => {
    if (!FREE_TEXT.includes(key)) return false
    const fr = (settings.texts.fr?.[key] ?? frDefaults[key] ?? '').trim()
    const nl = (settings.texts.nl?.[key] ?? '').trim()
    return fr !== '' && nl === ''
  })
}

export function hoursText(shop: BrochureShop, lang: Lang): string {
  const raw = lang === 'nl' ? shop.hoursNl || shop.hours : shop.hours
  if (!raw) return ''
  const match = /^(.+?)\s*[–—-]\s*(.+)$/u.exec(raw)
  if (!match) return lang === 'nl' ? `Openingsuren: ${raw}` : `Horaires : ${raw}`
  return lang === 'nl' ? `Open van ${match[1]} tot ${match[2]}` : `Ouvert de ${match[1]} à ${match[2]}`
}

// ---------------------------------------------------------------------------
// QR code
// ---------------------------------------------------------------------------

/**
 * Le lien du QR code : le webshop de la boutique (`?shop={n° de caisse}`), sur une catégorie si
 * demandé — le même lien que les posts du module Social. Une version générale, un magasin test ou
 * une boutique sans numéro de caisse ouvrent le webshop sans boutique.
 */
export function webshopLink(base: string, shop: BrochureShop | null, qr: BrochureSettings['qr']): string {
  const params: Array<[string, string]> = []
  if (shop && shop.n !== null && !shop.test) params.push(['shop', String(shop.n)])
  if (qr.mode === 'category' && qr.category) {
    if (qr.group) params.push(['category', `group:${qr.group}`], ['sub', `category:${qr.category}`])
    else params.push(['category', `category:${qr.category}`])
  }
  const root = base.endsWith('/') ? base : `${base}/`
  return params.length ? `${root}?${params.map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%3A/g, ':')}`).join('&')}` : root
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export function defaultSettings(file: PrintFile): BrochureSettings {
  return {
    template: 'fetes',
    texts: {},
    products: file.products.map((product) => ({ key: productKey(product), on: true, price: null })),
    qr: { mode: 'webshop', category: null, group: null },
    excludedShops: [],
    cropMarks: true,
  }
}

/**
 * Les réglages enregistrés, rapprochés du dossier d'impression : un produit retiré de l'offre
 * disparaît, un produit ajouté depuis arrive coché en fin de liste.
 */
export function normalizeSettings(saved: Partial<BrochureSettings> | undefined, file: PrintFile): BrochureSettings {
  const base = defaultSettings(file)
  if (!saved) return base

  const keys = new Set(file.products.map(productKey))
  const kept = (saved.products ?? []).filter((row) => keys.has(row.key))
  const seen = new Set(kept.map((row) => row.key))

  return {
    template: TEMPLATES.some((template) => template.id === saved.template) ? (saved.template as string) : base.template,
    texts: saved.texts && !Array.isArray(saved.texts) ? saved.texts : {},
    products: [...kept, ...base.products.filter((row) => !seen.has(row.key))],
    qr: saved.qr ?? base.qr,
    excludedShops: saved.excludedShops ?? [],
    cropMarks: saved.cropMarks ?? base.cropMarks,
  }
}

export const savedFor = (list: SavedBrochure[], format: BrochureFormat): Partial<BrochureSettings> | undefined =>
  list.find((row) => row.format === format)?.settings

// ---------------------------------------------------------------------------
// Document à mettre en page
// ---------------------------------------------------------------------------

export interface Palette {
  primary: string
  secondary: string
  accent: string
  ink: string
}

export interface BrochureDoc {
  format: BrochureFormat
  template: string
  lang: Lang
  colors: Palette
  brandName: string
  logo: string
  logoWhite: string
  /** Le visuel de la campagne, sinon l'illustration de sa gamme. */
  cover: string | null
  /** L'illustration du rabat (commande et retrait). */
  flapImage: string
  texts: Record<TextKey, string>
  products: BrochureProduct[]
  shop: BrochureShop | null
  qrUrl: string
  qrLabel: string
  host: string
  /** Épreuve : les prix à confirmer s'impriment « ? € », hachurés. */
  proof: boolean
}

const asset = (path: string): string => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href

const absolute = (url: string | null): string | null => (url ? new URL(url, window.location.href).href : null)

/** L'illustration d'une gamme en définition d'impression (560 px) : celle des écrans (200 px) s'imprime floue. */
const PRINT_SEASONS = ['automne', 'b2b', 'chandeleur', 'epiphanie', 'ete', 'fete-des-meres', 'glace', 'hiver', 'noel', 'paques', 'printemps', 'saint-nicolas', 'saint-valentin']
const forPrint = (url: string | null): string | null => {
  const match = url ? /\/img\/seasons\/([a-z-]+)\.png$/.exec(url) : null
  return match && PRINT_SEASONS.includes(match[1]) ? (url as string).replace('/img/seasons/', '/img/print/') : url
}

export interface DocInput {
  file: PrintFile
  settings: BrochureSettings
  format: BrochureFormat
  version: Version
  webshopUrl: string
  categoryName: string | null
  proof: boolean
}

export function buildDoc({ file, settings, format, version, webshopUrl, categoryName, proof }: DocInput): BrochureDoc {
  const host = webshopHost(webshopUrl)
  const cover =
    file.visual?.file_url ??
    seasonImage(file.campaign.type_label ?? '') ??
    seasonImage(file.campaign.name) ??
    seasonImage(file.products[0]?.family ?? '') ??
    null

  return {
    format,
    template: settings.template,
    lang: version.lang,
    colors: file.campaign.colors,
    brandName: file.brand.name ?? 'L’Atelier By',
    logo: absolute(file.brand.logo_url) ?? asset('img/logo.png'),
    logoWhite: asset('img/logo-white.png'),
    cover: absolute(file.visual?.file_url ? cover : forPrint(cover)),
    flapImage: asset('img/click-collect.png'),
    texts: textsFor(file, settings, version.lang, host),
    products: chosenProducts(file, settings).map((product) => ({
      ...product,
      image: absolute(product.image),
      // La précision du libellé se traduit (« 4/6 personnes ») ; le nom du produit, lui, n'a pas de version néerlandaise.
      sub: version.lang === 'nl' ? product.sub.replace(/\bpersonnes\b/giu, 'personen').replace(/\bpièces\b/giu, 'stuks') : product.sub,
    })),
    shop: version.shop,
    qrUrl: webshopLink(webshopUrl, version.shop, settings.qr),
    qrLabel: ['webshop', version.shop?.name, settings.qr.mode === 'category' ? categoryName : null].filter(Boolean).join(' · '),
    host,
    proof,
  }
}

// ---------------------------------------------------------------------------
// Contrôle avant impression
// ---------------------------------------------------------------------------

export interface BrochureCheck {
  level: 'ok' | 'warn' | 'stop'
  label: string
  detail?: string
  /** Le panneau où cela se corrige. */
  target?: 'products' | 'texts' | 'shops'
}

const list = (names: string[]): string => (names.length > 3 ? `${names.slice(0, 3).join(', ')} et ${names.length - 3} autre(s)` : names.join(', '))

export function checksFor(
  file: PrintFile,
  settings: BrochureSettings,
  format: BrochureFormat,
  version: Version,
  webshopUrl: string,
  today: string,
): BrochureCheck[] {
  const checks: BrochureCheck[] = []
  const products = chosenProducts(file, settings)
  const def = FORMATS[format]

  if (products.length === 0) {
    checks.push({ level: 'stop', label: 'Aucun produit coché', detail: 'La brochure présente l’offre : cochez au moins un produit.', target: 'products' })
  } else if (products.length > def.maxProducts) {
    checks.push({
      level: 'stop',
      label: `${products.length} produits cochés, ${def.maxProducts} au plus`,
      detail: `Le ${def.label.toLowerCase()} n’en porte pas davantage lisiblement : décochez-en.`,
      target: 'products',
    })
  }

  const toConfirm = products.filter((product) => product.toConfirm)
  if (toConfirm.length) {
    checks.push({
      level: 'stop',
      label: `Prix à confirmer : ${list(toConfirm.map((product) => product.name))}`,
      detail: 'Le catalogue ne donne pas de prix, ou 1,00 € (prix par défaut de l’ERP). Saisissez le prix dans la liste des produits.',
      target: 'products',
    })
  } else if (products.length) {
    checks.push({
      level: 'ok',
      label: 'Prix confirmés',
      detail: file.price_source === 'boutiques' ? 'Prix relus dans les boutiques.' : 'Prix du catalogue de l’ERP.',
    })
  }

  if (version.lang === 'nl') {
    const missing = missingDutch(file, settings, format, webshopHost(webshopUrl))
    if (missing.length) {
      checks.push({
        level: 'stop',
        label: `Textes néerlandais à écrire : ${missing.map((key) => TEXT_LABELS[key]).join(', ')}`,
        detail: 'Le français s’affiche en attendant ; il ne part pas à l’imprimeur dans une version NL.',
        target: 'texts',
      })
    }
    const scope = conditionsNl(file).untranslated
    if (scope && !(settings.texts.nl?.conditions ?? '').trim()) {
      checks.push({ level: 'warn', label: `Conditions NL : « ${scope} » reste en français`, detail: 'Le périmètre de l’offre est un texte libre. Réécrivez les conditions en néerlandais.', target: 'texts' })
    }
    checks.push({ level: 'warn', label: 'Noms des produits en français', detail: 'Le catalogue ne donne pas de nom néerlandais.' })
  }

  const shop = version.shop
  if (shop) {
    if (shop.unknown) {
      checks.push({ level: 'stop', label: `${shop.name} : boutique inconnue du module Social`, detail: 'Ni adresse, ni horaires, ni téléphone. Écartez-la ou complétez-la dans le module Social.', target: 'shops' })
    } else {
      const absent = [!shop.address && 'adresse', !shop.hours && 'horaires', !shop.phone && 'téléphone'].filter(Boolean) as string[]
      if (!shop.address) {
        checks.push({ level: 'stop', label: `${shop.name} : adresse manquante`, detail: 'Une brochure de boutique sans adresse ne s’imprime pas. Complétez la fiche dans le module Social, ou écartez la boutique.', target: 'shops' })
      } else if (absent.length) {
        checks.push({ level: 'warn', label: `${shop.name} : ${absent.join(' et ')} manquant(s)`, target: 'shops' })
      } else {
        checks.push({ level: 'ok', label: `${shop.name} : adresse, horaires, téléphone` })
      }
      if (shop.test) {
        checks.push({ level: 'warn', label: `${shop.name} est un magasin test`, detail: 'Pas de webshop : le QR code ouvre le webshop sans boutique.', target: 'shops' })
      }
    }
  }

  checks.push({ level: 'ok', label: 'QR code', detail: webshopLink(webshopUrl, shop, settings.qr) })

  const withoutPhoto = products.filter((product) => product.image === null || product.illustration)
  if (withoutPhoto.length) {
    checks.push({
      level: 'warn',
      label: `Sans photo : ${list(withoutPhoto.map((product) => product.name))}`,
      detail: 'Le dessin de la famille la remplace quand il existe. La photo s’ajoute à l’étape « Photos » de l’assistant.',
    })
  }

  if (!file.legal.period_text) {
    checks.push({ level: 'warn', label: 'Période de l’offre absente', detail: 'Les dates de l’offre manquent au dossier d’impression.', target: 'texts' })
  }

  const ends = file.offer?.ends_on ?? file.campaign.ends_on
  if (ends && ends < today) {
    checks.push({ level: 'warn', label: `L’offre s’est terminée le ${longDate(ends, 'fr')}` })
  }

  return checks
}

export const blocking = (checks: BrochureCheck[]): boolean => checks.some((check) => check.level === 'stop')
