import { isDocOffer } from '../../lib/api/module'
import type {
  BrochureFormat,
  Catalogue,
  CatalogueBrochureTexts,
  CatalogueDocItem,
  CatalogueDocLook,
  CatalogueDocPage,
  CatalogueDocument,
  CatalogueLang,
  CatalogueShopInfo,
  CatalogueSupport,
  PrintMechanic,
} from '../../lib/api/module'
import { FORMATS, FORMAT_TEXTS, TEXT_LABELS, formatPrice, splitLabel } from '../../lib/brochure'
import { seasonImage } from '../builder/illustrations'
import type { BrochureCheck, BrochureDoc, BrochureProduct, BrochureShop, TextKey } from '../../lib/brochure'

/**
 * Le leaflet A5 et le dépliant A4 tirés d'un catalogue (21/11/2026, fusion des imprimés, étape 2 — Sam : « fusionner
 * leaflet, brochure et catalogue »). Le contenu est celui d'un catalogue : la source (gamme, campagne, au choix), les
 * produits cochés et leurs promotions, les prix du webshop de chaque boutique, sa fiche (adresse, horaires, téléphone),
 * le QR de la dernière page, le titre et le visuel de la couverture. L'API compose le document de chaque version ; ce
 * fichier le traduit dans le modèle des brochures, que les pages des brochures (`brochure/Pages.tsx`) impriment.
 * Rien n'est inventé : un prix absent du webshop s'imprime « ? € » en épreuve et bloque le PDF de l'imprimeur.
 */

export type LeafletSupport = Exclude<CatalogueSupport, 'catalogue'>

export const SUPPORT_FORMAT: Record<LeafletSupport, BrochureFormat> = { leaflet: 'leaflet-a5', depliant: 'depliant-a4' }

export const SUPPORT_LABELS: Record<CatalogueSupport, string> = { catalogue: 'Catalogue', leaflet: 'Leaflet A5', depliant: 'Dépliant A4' }

export const supportOf = (cat: Pick<Catalogue, 'support'>): CatalogueSupport => cat.support ?? 'catalogue'

/** Le nom dans une phrase : « le catalogue », « le leaflet A5 », « le dépliant A4 ». */
export const SUPPORT_NOUNS: Record<CatalogueSupport, string> = { catalogue: 'catalogue', leaflet: 'leaflet A5', depliant: 'dépliant A4' }

export const isLeaflet = (cat: Pick<Catalogue, 'support'>): boolean => supportOf(cat) !== 'catalogue'

export const leafletFormat = (cat: Pick<Catalogue, 'support'>): BrochureFormat => (supportOf(cat) === 'depliant' ? 'depliant-a4' : 'leaflet-a5')

/** Les textes d'un support, dans l'ordre de lecture. */
export const leafletTextKeys = (cat: Pick<Catalogue, 'support'>): TextKey[] => FORMAT_TEXTS[leafletFormat(cat)]

/** Textes propres à l'imprimé : récrits en français, ils sont à récrire en néerlandais. */
const FREE_TEXT: TextKey[] = ['eyebrow', 'title', 'phrase', 'innerSub', 'flapTitle', 'flapText', 'cta']

const asset = (path: string): string => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
const absolute = (url: string | null | undefined): string | null => (url ? new URL(url, window.location.href).href : null)

type PageOf<K extends CatalogueDocPage['kind']> = Extract<CatalogueDocPage, { kind: K }>
const pageOf = <K extends CatalogueDocPage['kind']>(doc: CatalogueDocument, kind: K): PageOf<K> | undefined =>
  doc.pages.find((page): page is PageOf<K> => page.kind === kind)

/** Un élément de la page qu'on a éteint (« Apparence » des pages de la marque) ne s'imprime pas non plus sur le leaflet. */
const shown = (look: CatalogueDocLook | undefined, key: string): boolean => look?.[key]?.show !== false

/** Les cases du document (produits et promotions), dans l'ordre où l'API les range. */
export function leafletItems(doc: CatalogueDocument): CatalogueDocItem[] {
  return doc.pages.flatMap((page) => (page.kind === 'products' || page.kind === 'presentation' ? page.products : []))
}

const MODEL_TEXTS: Record<CatalogueLang, Record<'cta' | 'innerTitle' | 'flapTitle' | 'flapText', string>> = {
  fr: {
    cta: 'Commandez en boutique ou en ligne',
    innerTitle: 'Notre sélection',
    flapTitle: 'Commandez, on prépare',
    flapText: 'Réservez en boutique ou sur le webshop, et passez chercher votre commande le jour de votre choix.',
  },
  nl: {
    cta: 'Bestel in de winkel of online',
    innerTitle: 'Onze selectie',
    flapTitle: 'Bestel, wij maken het klaar',
    flapText: 'Reserveer in de winkel of via de webshop en haal je bestelling af op de dag van je keuze.',
  },
}

/**
 * Les textes que donne le document : la couverture (surtitre, titre, accroche), la dernière page (l'appel du QR et
 * l'adresse du webshop), la disponibilité des produits (période et conditions) ; le reste, ceux du modèle.
 */
export function documentTexts(doc: CatalogueDocument): Record<TextKey, string> {
  const lang = doc.version.lang
  const cover = pageOf(doc, 'cover')
  const back = pageOf(doc, 'back')
  const products = pageOf(doc, 'products')
  const model = MODEL_TEXTS[lang]
  return {
    // Le surtitre de la couverture ; pas son « La gamme », que le titre (le nom de la gamme) répète.
    eyebrow: cover && shown(cover.look, 'kicker') ? (cover.eyebrow ?? '') : '',
    title: cover && shown(cover.look, 'title') ? cover.title : '',
    phrase: cover && shown(cover.look, 'subtitle') ? cover.subtitle : '',
    cta: back?.qrLabel?.trim() || model.cta,
    ctaSub: back?.host ?? '',
    innerTitle: model.innerTitle,
    innerSub: '',
    flapTitle: model.flapTitle,
    flapText: model.flapText,
    conditions: products?.availabilityFooter ?? '',
  }
}

/** Le texte récrit, sinon celui du document. Vide : rien n'est imprimé. */
export function leafletTexts(texts: CatalogueBrochureTexts | null | undefined, doc: CatalogueDocument): Record<TextKey, string> {
  const own = texts?.[doc.version.lang] ?? {}
  const base = documentTexts(doc)
  const out = { ...base }
  for (const key of Object.keys(TEXT_LABELS) as TextKey[]) {
    const value = own[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

const euros = (cents: number | null | undefined): number | null => (cents === null || cents === undefined ? null : cents / 100)

const label = (text: string | null | undefined): PrintMechanic | null => (text ? { type: 'LABEL', value: null, buy: null, get: null, text } : null)

function weightText(grams: number | null | undefined, lang: CatalogueLang): string {
  if (!grams) return ''
  if (grams < 1000) return `${grams} g`
  return `${(grams / 1000).toLocaleString(lang === 'nl' ? 'nl-BE' : 'fr-BE', { maximumFractionDigits: 2 })} kg`
}

/** Une case du document en produit de brochure : son nom, sa précision (ou son poids), sa photo, son prix, sa promotion. */
export function toBrochureProduct(item: CatalogueDocItem, lang: CatalogueLang): BrochureProduct {
  if (isDocOffer(item)) {
    const image = item.imageUrl ?? item.products.find((product) => product.imageUrl)?.imageUrl ?? null
    const before = euros(item.oldPriceCents)
    const price = euros(item.priceCents)
    return {
      key: item.id,
      name: item.name,
      sub: item.deal ?? '',
      family: null,
      image: absolute(image),
      illustration: false,
      before: before !== null && price !== null && before > price ? before : null,
      price,
      toConfirm: price === null,
      manual: false,
      mechanic: label(item.badge),
    }
  }
  const { name, sub } = splitLabel(item.name)
  const before = euros(item.oldPriceCents)
  const price = euros(item.priceCents)
  return {
    key: String(item.id),
    name,
    sub: sub || weightText(item.weightGrams, lang),
    family: null,
    image: absolute(item.imageUrl),
    illustration: false,
    before: before !== null && price !== null && before > price ? before : null,
    price,
    toConfirm: price === null,
    manual: false,
    mechanic: label(item.promo?.label),
  }
}

/** La boutique d'une version : sa fiche (TFBuddy, sinon la charte), dans la langue du document. */
function shopOf(info: CatalogueShopInfo | null, lang: CatalogueLang): BrochureShop | null {
  if (!info) return null
  return {
    id: info.id,
    n: info.erpShopId,
    name: info.name,
    address: info.address,
    hours: info.hours,
    hoursNl: info.hours,
    phone: [info.phone, info.phone2].filter(Boolean).join(' · '),
    langs: [lang],
    test: false,
    unknown: false,
  }
}

export interface LeafletInput {
  cat: Pick<Catalogue, 'support' | 'brochureTemplate' | 'brochureTexts'>
  doc: CatalogueDocument
  proof: boolean
  /** Un autre modèle que celui du leaflet (les vignettes du choix du modèle). */
  template?: string
}

/**
 * Le visuel de la couverture, comme la couverture du catalogue le choisit : sa photo, sinon son dessin (`img/print/…`),
 * sinon le dessin de la saison de son titre ; « sans visuel » : rien.
 */
function coverVisual(cover: PageOf<'cover'> | undefined): string | null {
  if (!cover || cover.noVisual) return null
  if (cover.imageUrl) return absolute(cover.imageUrl)
  // Le dessin livré avec l'écran d'abord (comme `CataloguePages`) : l'adresse que l'API en donne est la sienne.
  if (cover.drawing) return asset(cover.drawing)
  if (cover.drawingUrl) return absolute(cover.drawingUrl)
  const season = seasonImage(cover.title)
  return season ? absolute(season.replace('/img/seasons/', '/img/print/')) : null
}

/** Le document d'une version, prêt pour les pages des brochures. */
export function leafletDoc({ cat, doc, proof, template }: LeafletInput): BrochureDoc {
  const format = leafletFormat(cat)
  const lang = doc.version.lang
  const cover = pageOf(doc, 'cover')
  const back = pageOf(doc, 'back')
  const colors = doc.charter.colors
  const host = back?.host ?? ''
  return {
    format,
    template: template ?? cat.brochureTemplate ?? 'papier',
    lang,
    colors: { primary: colors.primary, secondary: colors.secondary, accent: colors.accent, ink: colors.ink },
    brandName: 'L’Atelier By',
    logo: absolute(doc.charter.logoUrl) ?? asset('img/logo.png'),
    logoWhite: asset('img/logo-white.png'),
    cover: coverVisual(cover),
    flapImage: asset('img/click-collect.png'),
    texts: leafletTexts(cat.brochureTexts, doc),
    products: leafletItems(doc).slice(0, FORMATS[format].maxProducts).map((item) => toBrochureProduct(item, lang)),
    shop: shopOf(doc.version.shop, lang),
    qrUrl: back?.qrUrl ?? '',
    qrLabel: [host || 'webshop', doc.version.shop?.name].filter(Boolean).join(' · '),
    host,
    proof,
  }
}

const list = (names: string[]): string => (names.length > 3 ? `${names.slice(0, 3).join(', ')} et ${names.length - 3} autre(s)` : names.join(', '))

/** Les avertissements du document que le contrôle du leaflet dit déjà autrement. */
const HANDLED = new Set(['PRODUCTS_OVERFLOW', 'PAGES_EMPTY', 'CATEGORY_NO_PAGE', 'PAGES_OVER_FORMAT', 'SHOP_ADDRESS_MISSING', 'WEBSHOP_URL_UNKNOWN', 'PRODUCT_NO_PRICE'])

/** Où se corrige un point : l'étape de l'assistant du leaflet. */
export type LeafletTarget = 1 | 2 | 3 | 'cover' | 'back'

export interface LeafletCheck extends Omit<BrochureCheck, 'target'> {
  target?: LeafletTarget
}

/**
 * Le contrôle avant impression d'une version : les produits (combien, leurs prix), les textes néerlandais, la boutique,
 * le QR code, les photos, puis ce que dit la composition de l'API.
 */
export function leafletChecks(cat: Pick<Catalogue, 'support' | 'products' | 'brochureTexts'>, doc: CatalogueDocument, overflow: string[] = []): LeafletCheck[] {
  const checks: LeafletCheck[] = []
  const format = leafletFormat(cat)
  const def = FORMATS[format]
  const lang = doc.version.lang
  const checked = cat.products.filter((row) => row.on).length
  const items = leafletItems(doc).map((item) => toBrochureProduct(item, lang))

  if (checked === 0) {
    checks.push({ level: 'stop', label: 'Aucun produit coché', detail: `Le ${def.label.toLowerCase()} présente des produits : cochez-en un au moins.`, target: 2 })
  } else if (checked > def.maxProducts) {
    checks.push({
      level: 'stop',
      label: `${checked} produits cochés, ${def.maxProducts} au plus`,
      detail: `Le ${def.label.toLowerCase()} n’en porte pas davantage lisiblement : décochez-en (les ${def.maxProducts} premiers s’impriment).`,
      target: 2,
    })
  }

  const shownItems = items.slice(0, def.maxProducts)
  const noPrice = shownItems.filter((product) => product.price === null)
  if (noPrice.length) {
    checks.push({
      level: 'stop',
      label: `Sans prix au webshop : ${list(noPrice.map((product) => product.name))}`,
      detail: 'Le prix se saisit dans TFBuddy ; en attendant, l’épreuve imprime « ? € ».',
      target: 2,
    })
  } else if (shownItems.length) {
    const low = shownItems.filter((product) => product.price !== null && product.price <= 1)
    checks.push({ level: 'ok', label: 'Prix du webshop', detail: doc.version.shop ? `Ceux de ${doc.version.shop.name}.` : 'Le prix le plus répandu dans les boutiques.' })
    if (low.length) {
      checks.push({
        level: 'warn',
        label: `Prix de ${formatPrice(1, 'fr')} ou moins : ${list(low.map((product) => product.name))}`,
        detail: 'C’est souvent le prix par défaut d’un article dont le tarif n’a pas été saisi : vérifiez-le dans TFBuddy.',
        target: 2,
      })
    }
  }

  if (lang === 'nl') {
    const fr = cat.brochureTexts?.fr ?? {}
    const nl = cat.brochureTexts?.nl ?? {}
    const pending = leafletTextKeys(cat).filter((key) => FREE_TEXT.includes(key) && (fr[key] ?? '').trim() !== '' && nl[key] === undefined)
    if (pending.length) {
      checks.push({
        level: 'warn',
        label: `Récrit en français seulement : ${pending.map((key) => TEXT_LABELS[key]).join(', ')}`,
        detail: 'La version néerlandaise garde le texte du catalogue (couverture, dernière page). Écrivez-le en néerlandais à l’étape 3.',
        target: 3,
      })
    }
    for (const warning of doc.warnings.filter((w) => w.code === 'NL_TEXT_MISSING')) {
      checks.push({ level: 'warn', label: warning.message, target: /couverture/i.test(warning.message) ? 'cover' : /Dernière/i.test(warning.message) ? 'back' : 3 })
    }
  }

  const shop = doc.version.shop
  if (shop) {
    const absent = [!shop.hours && 'horaires', !shop.phone && 'téléphone'].filter(Boolean) as string[]
    if (!shop.address) {
      checks.push({ level: 'stop', label: `${shop.name} : adresse inconnue`, detail: 'TFBuddy ne la donne pas : complétez la fiche de la boutique, ou retirez la boutique à l’étape 1.', target: 1 })
    } else if (absent.length) {
      checks.push({ level: 'warn', label: `${shop.name} : ${absent.join(' et ')} manquant(s)`, detail: 'Ils se saisissent dans la page « Le magasin » des pages de la marque.', target: 'back' })
    } else {
      checks.push({ level: 'ok', label: `${shop.name} : adresse, horaires, téléphone` })
    }
  }

  const back = pageOf(doc, 'back')
  if (back?.qrUrl) {
    checks.push({ level: 'ok', label: 'QR code', detail: back.qrUrl })
  } else {
    checks.push({ level: 'stop', label: 'Pas de QR code', detail: 'L’adresse du webshop est inconnue (ni celle de la boutique dans la charte, ni le réglage du module Social).', target: 'back' })
  }

  const noPhoto = shownItems.filter((product) => !product.image)
  if (noPhoto.length) {
    checks.push({ level: 'warn', label: `Sans photo : ${list(noPhoto.map((product) => product.name))}`, detail: 'Le produit s’imprime sans vignette. La photo se met dans TFBuddy.' })
  }

  if (overflow.length) {
    checks.push({ level: 'warn', label: `Texte coupé : ${overflow.join(', ')}`, detail: 'Le bloc est plein : raccourcissez le texte ou cochez moins de produits.', target: 3 })
  }

  for (const warning of doc.warnings) {
    if (HANDLED.has(warning.code) || warning.code === 'NL_TEXT_MISSING') continue
    checks.push({ level: 'warn', label: warning.message, target: warning.code.startsWith('PRODUCT') || warning.code.startsWith('PRICE') || warning.code.startsWith('OFFER') ? 2 : undefined })
  }

  return checks
}

export const leafletBlocked = (checks: LeafletCheck[]): boolean => checks.some((check) => check.level === 'stop')
