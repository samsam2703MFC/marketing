import type { CSSProperties } from 'react'
import { CATALOGUE_COVER_FONTS, isDocOffer } from '../../lib/api/module'
import type {
  CatalogueCoverFont,
  CatalogueDocLook,
  CatalogueDocFiller,
  CatalogueDocItem,
  CatalogueDocOffer,
  CatalogueDocPage,
  CatalogueDocProduct,
  CatalogueDocument,
  CatalogueFormat,
  CatalogueHeader,
  CatalogueLang,
  CatalogueLayout,
  CatalogueTemplate,
} from '../../lib/api/module'
import { qrPath } from '../../lib/qr'
import { fontFaces } from '../brochure/Pages'
import { familyImage, seasonImage } from '../builder/illustrations'
import CATALOGUE_CSS from './catalogue-pages.css?inline'
import { ALLERGEN_NAMES, AllergenIcon, Allergens, type AllergenCode } from './allergens'

/**
 * Les pages d'un catalogue, en millimètres : ce que l'aperçu montre est ce qui part à
 * l'impression (même balisage, même feuille de style), comme les brochures — et par le même
 * moteur (`lib/print.ts`), avec les mêmes polices de la marque (`fontFaces`).
 *
 * Le document est composé par l'API (`…/catalogues/{id}/document`) : 8 à 16 pages, par 2 ; la
 * couverture, la page 2, l'avant-dernière et la dernière page viennent de la Charte des catalogues
 * (`cover`, `brand`, `back`), les pages intérieures portent leurs produits et leurs prix. Ici, rien
 * n'est recalculé : on met en page.
 *
 * A5 (148 × 210 mm) ou A4 (210 × 297 mm), mêmes proportions : `--u` met tout à l'échelle.
 */

export type CatalogueSheetMode = 'preview' | 'proof' | 'printer'

export const FORMAT_MM: Record<CatalogueFormat, { w: number; h: number }> = {
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 },
}

/** Fond perdu et marge des traits de coupe, en millimètres (ceux des brochures). */
const BLEED = 3
const MARKS = 7

export const LAYOUT_LABELS: Record<CatalogueLayout, { label: string; capacity: number }> = {
  vedette: { label: '1 vedette + 4', capacity: 5 },
  grille: { label: 'Grille 2 × 3', capacity: 6 },
  liste: { label: 'Liste avec prix', capacity: 12 },
  mosaique: { label: 'Grandes vignettes 2 × 2', capacity: 4 },
  pleine: { label: 'Pleine page', capacity: 1 },
  presentation: { label: 'Présentation seule', capacity: 0 },
  presentation_liste: { label: 'Présentation + liste', capacity: 8 },
}

/**
 * Les variantes de gabarit (2-3 possibilités pour chaque mise en page). Pages de produits : A
 * Classique (fond papier, titre centré) · B Bandeau (bandeau de la couleur principale, titre à
 * gauche) · C Épuré (fond blanc, titre à gauche souligné). Présentations : A Illustration · B Pleine
 * couleur · C Photo pleine.
 */
export const TEMPLATE_LABELS: Record<'products' | 'presentation', Record<CatalogueTemplate, { label: string; hint: string }>> = {
  products: {
    A: { label: 'Classique', hint: 'fond papier, titre centré' },
    B: { label: 'Bandeau', hint: 'bandeau de couleur, titre à gauche' },
    C: { label: 'Épuré', hint: 'fond blanc, titre à gauche' },
  },
  presentation: {
    A: { label: 'Illustration', hint: 'dessin au centre, fond papier' },
    B: { label: 'Pleine couleur', hint: 'fond de couleur, dessin en blanc' },
    C: { label: 'Photo pleine', hint: 'grande image en haut' },
  },
}

/**
 * L'en-tête d'une page de produits (client, 14/11/2026 : « la catégorie est sur une page avec son
 * illustration — 2 ou 3 possibilités de montrer le titre et l'illustration ») : l'illustration est le
 * dessin de la famille de la catégorie, sinon celui de la gamme, sinon rien. Indépendant du gabarit.
 */
export const HEADER_LABELS: Record<CatalogueHeader, { label: string; hint: string }> = {
  titre: { label: 'Titre + pictogramme', hint: 'le titre et un petit pictogramme' },
  bandeau: { label: 'Bandeau illustré', hint: 'bandeau de couleur, illustration en blanc' },
  grande: { label: 'Grande illustration', hint: 'grande illustration en haut, puis le titre' },
}

export const isPresentation = (layout: CatalogueLayout): boolean => layout === 'presentation' || layout === 'presentation_liste'

const mm = (value: number): string => `${value}mm`

const asset = (path: string): string => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href

export function formatCents(cents: number | null, lang: CatalogueLang): string {
  if (cents === null) return '—'
  return (cents / 100).toLocaleString(lang === 'nl' ? 'nl-BE' : 'fr-BE', { style: 'currency', currency: 'EUR' })
}

/** La feuille des pages et les polices, pour l'aperçu et la fenêtre d'impression. */
export function catalogueCss(): string {
  return `${fontFaces()}\n${CATALOGUE_CSS}`
}

/** Dimensions d'une page imprimée, en millimètres. */
export function sheetSize(format: CatalogueFormat, mode: CatalogueSheetMode): { w: number; h: number } {
  const size = FORMAT_MM[format]
  if (mode !== 'printer') return size
  const margin = BLEED + MARKS
  return { w: size.w + margin * 2, h: size.h + margin * 2 }
}

function Qr({ url, size }: { url: string; size: number }) {
  const path = qrPath(url)
  return (
    <svg className="cat-qr" viewBox={`0 0 ${path.size} ${path.size}`} width={mm(size)} height={mm(size)} shapeRendering="crispEdges" aria-label={url}>
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}

/** Le prix ; barré par une remise programmée de TFBuddy : l'ancien prix à côté, rayé. */
function Price({ product, lang }: { product: CatalogueDocProduct | CatalogueDocOffer; lang: CatalogueLang }) {
  const old = product.oldPriceCents ?? null
  return (
    <span className="cat-prices">
      {old !== null ? <s className="cat-old">{formatCents(old, lang)}</s> : null}
      <span className={`cat-price${product.priceCents === null ? ' cat-price--none' : ''}${old !== null ? ' cat-price--promo' : ''}`}>{formatCents(product.priceCents, lang)}</span>
    </span>
  )
}

/** Le poids d'une pièce (17/11/2026, obligatoire) : « 85 g », « 1,2 kg » ; rien quand l'ERP ne le dit pas. */
export function formatWeight(grams: number | null | undefined, lang: CatalogueLang): string | null {
  if (grams == null || grams <= 0) return null
  if (grams >= 1000) return (grams / 1000).toLocaleString(lang === 'nl' ? 'nl-BE' : 'fr-BE', { maximumFractionDigits: 2 }).replace(/\u202f/g, '\u00a0') + '\u00a0kg'
  return String(grams) + '\u00a0g'
}

/** Sous le nom : le poids et les pictogrammes des allergènes (17/11/2026, obligatoires au catalogue imprimé). */
function Facts({ product, lang }: { product: CatalogueDocProduct; lang: CatalogueLang }) {
  const w = formatWeight(product.weightGrams, lang)
  // Vide, la case reste (dans une ligne de liste, elle tient sa colonne) ; la feuille de style la masque dans une vignette.
  return (
    <span className="cat-facts">
      {w ? <span className="cat-weight">{w}</span> : null}
      <Allergens codes={product.allergens} lang={lang} />
    </span>
  )
}

/**
 * La disponibilité de la page, en pied de page (client, 14/11/2026 : « la disponibilité en dessous de page en
 * footer, par catégorie ») : une ligne composée par l'API (`availabilityFooter`) ; rien sans donnée.
 */
function AvailabilityFooter({ text }: { text?: string | null }) {
  return text ? <div className="cat-foot">{text}</div> : null
}

/** La vignette d'une promotion (bundle, « 2+1 », « 3 pour 2 ») : badge, produits, prix et ancien prix, période. */
function OfferCard({ offer, lang, family, big = false, row = false }: { offer: CatalogueDocOffer; lang: CatalogueLang; family: Fam; big?: boolean; row?: boolean }) {
  // L'image choisie dans la médiathèque remplace les photos des produits ; sans rien, le dessin de la famille.
  const shown = offer.imageUrl ? [] : offer.products.slice(0, row ? 3 : big ? 4 : offer.products.length > 2 ? 4 : 2)
  const fallback = absolute(familyImage(family.name)) ?? family.fallback
  const photos = (
    <span className={`cat-offer__photos cat-offer__photos--${Math.max(1, shown.length)}`}>
      {offer.imageUrl ? (
        <span className="cat-photo cat-photo--media"><img src={offer.imageUrl} alt="" /></span>
      ) : shown.length === 0 ? (
        <span className={`cat-photo${fallback ? ' cat-photo--drawing' : ''}`}>{fallback ? <img src={fallback} alt="" /> : <span className="cat-photo__none" />}</span>
      ) : null}
      {shown.map((p) => (
        <Photo key={p.id} product={{ id: p.id, name: p.name, imageUrl: p.imageUrl, priceCents: null, currency: 'EUR' }} family={family} />
      ))}
    </span>
  )
  const names = offer.products.map((p) => `${p.quantity !== null && p.quantity !== 1 ? `${p.quantity} × ` : ''}${p.name}`).join(' + ')
  const more = offer.moreProducts > 0 ? (lang === 'nl' ? ` + ${offer.moreProducts} andere` : ` + ${offer.moreProducts} autre${offer.moreProducts > 1 ? 's' : ''}`) : ''
  return (
    <div className={`cat-offer cat-offer--${offer.type}${big ? ' cat-offer--big' : ''}${row ? ' cat-offer--row' : ''}`}>
      <span className="cat-offer__badge">{offer.badge}</span>
      {photos}
      <div className="cat-offer__text">
        <div className="cat-name">{offer.name}</div>
        {names && !row ? <div className="cat-offer__items">{names + more}</div> : null}
        {offer.deal ? <div className="cat-offer__deal">{offer.deal}</div> : null}
        {offer.priceCents !== null ? <Price product={offer} lang={lang} /> : null}
        {offer.period ? <span className="cat-avail">{offer.period}</span> : null}
      </div>
    </div>
  )
}

/**
 * La famille d'une page pour les vignettes sans photo : le dessin de la famille de son titre, sinon
 * l'illustration de l'en-tête de la page (famille de la catégorie ou gamme) — jamais un cercle vide quand on
 * a un dessin.
 */
type Fam = { name: string; fallback: string | null }
const famOf = (page: { title: string; drawing?: string | null }): Fam => ({ name: page.title, fallback: drawingAsset(page.drawing) })

/** La photo du webshop ; sans elle, le dessin de la famille (celui des brochures), jamais une photo inventée. */
function Photo({ product, family, className = '' }: { product: CatalogueDocProduct; family: Fam; className?: string }) {
  const drawing = product.imageUrl ? null : (absolute(familyImage(family.name)) ?? family.fallback)
  return (
    <span className={`cat-photo${drawing ? ' cat-photo--drawing' : ''}${product.imageUrl ? ' cat-photo--img' : ''} ${className}`}>
      {product.imageUrl ? <img src={product.imageUrl} alt="" /> : drawing ? <img src={drawing} alt="" /> : <span className="cat-photo__none" />}
    </span>
  )
}

const absolute = (url: string | null): string | null => (url ? new URL(url, window.location.href).href : null)

/** L'illustration d'une gamme en définition d'impression (celle des brochures). */
const seasonDrawing = (title: string): string | null => absolute(seasonImage(title)?.replace('/img/seasons/', '/img/print/') ?? null)

/**
 * La couverture (charte de la marque), dans l'un de ses trois gabarits (maquette A1) : A Pleine couleur (titre sur la
 * couleur principale, dessin au trait blanc ou photo en bas) · B Illustration (papier, dessin au centre, « La gamme »,
 * titre en couleur) · C Photo (visuel en haut, bandeau de couleur avec le titre).
 */
/**
 * La police et la couleur choisies pour le titre ou le sous-titre de la couverture (17/11/2026, design system) ; rien
 * de choisi : celles du gabarit. La manuscrite (Playwrite DEVA) s'écrit sans capitales forcées.
 */
function coverStyle(font: CatalogueCoverFont | null | undefined, color: string | null | undefined): CSSProperties | undefined {
  const css = CATALOGUE_COVER_FONTS.find((f) => f.id === font)?.css
  if (!css && !color) return undefined
  // --fs : la taille du titre selon la police (le gabarit est réglé pour la Vank, étroite) — Gotham est plus large,
  // Playwrite DEVA plus large et plus haute ; sans effet sur le sous-titre.
  return {
    ...(css ? { fontFamily: css } : {}),
    ...(font === 'playwrite' ? { textTransform: 'none', letterSpacing: 0, lineHeight: 1.5, ['--fs' as string]: 0.55 } : font === 'gotham' ? { fontWeight: 500, letterSpacing: '0.02em', lineHeight: 1.08, ['--fs' as string]: 0.6 } : {}),
    ...(color ? { color } : {}),
  } as CSSProperties
}

/**
 * Chaque élément d'une page de la marque (v1.12, 21/11/2026, Sam : « toutes les données du catalogue doivent être
 * éditables — visibles ou pas — + la typo et les couleurs ») : affiché sauf `show` faux ; sa police et sa couleur,
 * sinon celles du gabarit.
 */
const shown = (look: CatalogueDocLook | undefined, element: string): boolean => look?.[element]?.show !== false

function textStyle(look: CatalogueDocLook | undefined, element: string): CSSProperties | undefined {
  const font = look?.[element]?.font
  const color = look?.[element]?.color
  const css = CATALOGUE_COVER_FONTS.find((f) => f.id === font)?.css
  if (!css && !color) return undefined
  return {
    ...(css ? { fontFamily: css } : {}),
    ...(font === 'playwrite' ? { textTransform: 'none', letterSpacing: 0 } : font === 'vank' ? { letterSpacing: '0.01em' } : {}),
    ...(color ? { color } : {}),
  } as CSSProperties
}

function Cover({ page, doc }: { page: Extract<CatalogueDocPage, { kind: 'cover' }>; doc: CatalogueDocument }) {
  const template = page.template ?? 'A'
  const look = page.look
  const titleStyle = coverStyle(page.titleFont, page.titleColor)
  const subStyle = coverStyle(page.subtitleFont, page.subtitleColor)
  const kickerStyle = textStyle(look, 'kicker')
  const shopStyle = textStyle(look, 'shop')
  const showLogo = shown(look, 'logo')
  const showTitle = shown(look, 'title')
  const subtitle = shown(look, 'subtitle') ? page.subtitle : ''
  // Le dessin choisi (ou reconnu au titre) ; une charte d'avant l'assistant : l'illustration de la gamme reconnue au titre.
  const drawing = page.imageUrl || page.noVisual ? null : (drawingAsset(page.drawing) ?? seasonDrawing(page.title))
  const shop = page.eyebrow ? `L’Atelier By · ${page.eyebrow}` : null
  if (template === 'B') {
    return (
      <div className="cat-cover cat-cover--B">
        {showLogo ? <img className="cat-logo cat-logo--dark cat-cover__logoB" src={doc.charter.logoUrl ?? asset('img/logo.png')} alt="" /> : null}
        <div className="cat-cover__art">
          {page.imageUrl ? <img className="cat-cover__photoB" src={page.imageUrl} alt="" /> : drawing ? <img className="cat-cover__drawB" src={drawing} alt="" /> : null}
        </div>
        {page.kicker ? <div className="cat-cover__kicker" style={kickerStyle}>{page.kicker}</div> : null}
        {showTitle ? (
          <div className="cat-cover__title" data-fit="Titre de couverture" style={titleStyle}>
            {page.title}
          </div>
        ) : null}
        <div className="cat-cover__rule" />
        {subtitle ? <div className="cat-cover__subB" style={subStyle}>{subtitle}</div> : null}
        {shop ? <div className="cat-cover__shopB" style={shopStyle}>{shop}</div> : null}
      </div>
    )
  }
  if (template === 'C') {
    return (
      <div className="cat-cover cat-cover--C">
        <div className="cat-cover__top">
          {page.imageUrl ? <img className="cat-cover__photoC" src={page.imageUrl} alt="" /> : drawing ? <img className="cat-cover__drawC" src={drawing} alt="" /> : null}
        </div>
        <div className="cat-cover__band">
          {showLogo ? <img className={`cat-logo${doc.charter.logoUrl ? ' cat-logo--custom' : ''}`} src={doc.charter.logoUrl ?? asset('img/logo-white.png')} alt="" /> : null}
          {page.kicker ? <div className="cat-cover__kicker" style={kickerStyle}>{page.kicker}</div> : null}
          {showTitle ? (
            <div className="cat-cover__title" data-fit="Titre de couverture" style={titleStyle}>
              {page.title}
            </div>
          ) : null}
          {subtitle ? <div className="cat-cover__sub" style={subStyle}>{subtitle}</div> : null}
          {shop ? <div className="cat-cover__shop" style={shopStyle}>{shop}</div> : null}
        </div>
      </div>
    )
  }
  const logo = doc.charter.logoUrl ?? asset('img/logo-white.png')
  return (
    <div className="cat-cover">
      {/* Le gabarit A n'a pas de « La gamme » (maquette A1) : rien n'y change pour les couvertures déjà imprimées. */}
      {showLogo ? <img className={`cat-logo${doc.charter.logoUrl ? ' cat-logo--custom' : ''}`} src={logo} alt="" /> : null}
      {showTitle ? (
        <div className="cat-cover__title" data-fit="Titre de couverture" style={titleStyle}>
          {page.title}
        </div>
      ) : null}
      {subtitle ? <div className="cat-cover__sub" style={subStyle}>{subtitle}</div> : null}
      {shop ? <div className="cat-cover__shop" style={shopStyle}>{shop}</div> : null}
      {page.imageUrl ? (
        <div className="cat-cover__visual">
          <img src={page.imageUrl} alt="" />
        </div>
      ) : drawing ? (
        <img className="cat-cover__drawing" src={drawing} alt="" />
      ) : null}
    </div>
  )
}

/**
 * Page 2 et avant-dernière page (charte de la marque) : une image, un titre, un texte. Paragraphes
 * séparés par une ligne vide ; un paragraphe de plusieurs lignes devient une liste (« Nos services »).
 */
function Brand({ page, doc }: { page: Extract<CatalogueDocPage, { kind: 'brand' }>; doc: CatalogueDocument }) {
  const blocks = page.text.split(/\n\s*\n/).map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean)).filter((lines) => lines.length)
  const logo = doc.charter.logoUrl ?? asset('img/logo.png')
  // Gabarits (maquette A2) : A texte seul · B image en haut · C image en bas (pleine largeur) ; sans gabarit : B avec une image.
  const template = page.template ?? (page.imageUrl ? 'B' : 'A')
  const top = template === 'B' && page.imageUrl
  const bottom = template === 'C' && page.imageUrl
  const look = page.look
  const logoTag = shown(look, 'logo') ? <img className="cat-logo cat-logo--dark cat-brand__logo" src={logo} alt="" /> : null
  return (
    <div className={`cat-brand cat-brand--${page.slot} cat-brand--t${template}${top ? ' cat-brand--image' : ''}`}>
      {bottom ? logoTag : top ? (
        <div className="cat-brand__visual">
          <img src={page.imageUrl ?? undefined} alt="" />
        </div>
      ) : (
        logoTag
      )}
      {shown(look, 'title') ? <div className="cat-brand__title" style={textStyle(look, 'title')}>{page.title}</div> : null}
      <div className="cat-brand__rule" />
      <div className="cat-brand__text" data-fit={page.title} style={shown(look, 'text') ? textStyle(look, 'text') : { display: 'none' }}>
        {blocks.map((lines, index) =>
          lines.length > 1 ? (
            <ul key={index}>
              {lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <p key={index}>{lines[0]}</p>
          ),
        )}
      </div>
      {page.slot === 'penultimate' && shown(look, 'legend') && (page.allergens ?? []).length ? <AllergenLegend codes={page.allergens ?? []} lang={doc.version.lang} /> : null}
      {bottom ? (
        <div className="cat-brand__visual cat-brand__visual--bottom">
          <img src={page.imageUrl ?? ''} alt="" />
        </div>
      ) : null}
    </div>
  )
}

/**
 * La légende des allergènes, à l'avant-dernière page (17/11/2026, Sam : « avec explication sur l'avant-dernière
 * page ») : le pictogramme et le nom de chaque allergène présent dans les produits du catalogue, et ce qu'ils disent.
 */
function AllergenLegend({ codes, lang }: { codes: string[]; lang: CatalogueLang }) {
  const nl = lang === 'nl'
  return (
    <div className="cat-allegend">
      <div className="cat-allegend__title">{nl ? 'Allergenen' : 'Allergènes'}</div>
      <div className="cat-allegend__grid">
        {codes.map((c) => (
          <span key={c} className="cat-allegend__item">
            <AllergenIcon code={c} />
            {ALLERGEN_NAMES[c as AllergenCode]?.[lang] ?? c}
          </span>
        ))}
      </div>
      <p className="cat-allegend__note">
        {nl
          ? 'De pictogrammen naast elk product tonen de allergenen van het recept (verordening EU 1169/2011). Sporen worden niet vermeld: vraag de volledige lijst in de winkel.'
          : 'Les pictogrammes à côté de chaque produit indiquent les allergènes de sa recette (règlement UE 1169/2011). Les traces ne sont pas indiquées : demandez la liste complète en boutique.'}
      </p>
    </div>
  )
}

function ProductCard({ product, lang, family, big = false }: { product: CatalogueDocItem; lang: CatalogueLang; family: Fam; big?: boolean }) {
  if (isDocOffer(product)) return <OfferCard offer={product} lang={lang} family={family} big={big} />
  return (
    <div className={`cat-card${big ? ' cat-card--big' : ''}${product.oldPriceCents != null ? ' cat-card--promo' : ''}`}>
      {product.promo ? <span className="cat-offer__badge cat-card__badge">{product.promo.label}</span> : null}
      <Photo product={product} family={family} />
      <div className="cat-card__text">
        <div className="cat-name">{product.name}</div>
        <Facts product={product} lang={lang} />
        <Price product={product} lang={lang} />
      </div>
    </div>
  )
}

/** Un dessin livré avec le module (`img/print/…`), par son chemin. */
const drawingAsset = (path: string | null | undefined): string | null => (path ? asset(path) : null)

/** La place libre d'une page de produits : la photo de la médiathèque, ou l'illustration. */
function Filler({ filler, style }: { filler: CatalogueDocFiller; style?: CSSProperties }) {
  const drawing = drawingAsset(filler.drawing)
  return (
    <div className={`cat-filler cat-filler--${filler.kind}${drawing ? ' cat-filler--drawing' : ''}`} style={style}>
      {drawing ? <img src={drawing} alt="" /> : filler.imageUrl ? <img src={filler.imageUrl} alt="" /> : null}
    </div>
  )
}

/**
 * L'en-tête d'une page de produits (client, 14/11/2026 : « commencer avec le nom de la gamme et son illustration,
 * ensuite catégorie produit (possibilité ou pas en lettres manuscrites), ensuite les produits ») : la gamme et son
 * illustration selon l'en-tête choisi (titre + pictogramme · bandeau · grande illustration), puis la catégorie en
 * sous-titre. Sans gamme : la catégorie seule, avec le dessin de sa famille.
 */
function Heading({ page }: { page: Extract<CatalogueDocPage, { kind: 'products' }> }) {
  const header = page.header ?? 'titre'
  const drawing = drawingAsset(page.drawing)
  const photo = drawing ? null : (page.gammeImageUrl ?? null)
  const src = drawing ?? photo
  const gamme = page.gammeTitle ?? null
  const script = page.script ? ' cat-h__script' : ''
  return (
    <div className={`cat-h cat-h--${header}${src ? '' : ' cat-h--nodraw'}${gamme ? ' cat-h--gamme' : ''}`}>
      <div className="cat-h__top">
        {src && header === 'grande' ? (
          <span className={`cat-h__big${photo ? ' is-photo' : ''}`}>
            <img src={src} alt="" />
          </span>
        ) : src ? (
          <img className={`cat-h__mark${photo ? ' is-photo' : ''}`} src={src} alt="" />
        ) : null}
        <span className={`cat-h__text${gamme ? '' : script}`}>{gamme ?? page.title}</span>
      </div>
      {gamme ? <div className={`cat-h__sub${script}`}>{page.title}</div> : null}
    </div>
  )
}

/** Rangées de la grille restées libres : la place libre les prend toutes, en pleine largeur. */
export function freeRows(layout: CatalogueLayout, count: number): number {
  if (layout === 'grille') return 3 - Math.ceil(count / 2)
  if (layout === 'vedette') return 2 - Math.ceil(Math.max(0, count - 1) / 2)
  if (layout === 'mosaique') return 2 - Math.ceil(count / 2)
  return 0
}

function Products({ page, lang }: { page: Extract<CatalogueDocPage, { kind: 'products' }>; lang: CatalogueLang }) {
  const [first, ...rest] = page.products
  const template = page.template ?? 'A'
  const filler = page.filler ?? null
  const rows = filler ? freeRows(page.layout, page.products.length) : 0
  const span: CSSProperties = { gridColumn: '1 / -1', gridRow: `span ${rows}` }
  return (
    <div className={`cat-inner cat-inner--${page.layout} cat-t-${template} cat-head-${page.header ?? 'titre'}`}>
      <Heading page={page} />
      <div className="cat-body" data-fit={page.title}>
        {page.products.length === 0 ? (
          filler ? <Filler filler={filler} style={{ flex: '1 1 0' }} /> : <div className="cat-empty">{lang === 'nl' ? 'Lege pagina' : 'Page vide'}</div>
        ) : page.layout === 'liste' ? (
          <>
            <ProductList products={page.products} lang={lang} family={famOf(page)} />
            {filler ? <Filler filler={filler} style={{ flex: '1 1 0' }} /> : null}
          </>
        ) : page.layout === 'vedette' && first ? (
          <>
            <ProductCard product={first} lang={lang} family={famOf(page)} big />
            <div className="cat-grid cat-grid--2x2">
              {rest.map((product) => (
                <ProductCard key={product.id} product={product} lang={lang} family={famOf(page)} />
              ))}
              {filler && rows > 0 ? <Filler filler={filler} style={span} /> : null}
            </div>
          </>
        ) : page.layout === 'pleine' ? (
          <FullPage items={page.products} lang={lang} family={famOf(page)} />
        ) : page.layout === 'mosaique' ? (
          <div className="cat-grid cat-grid--2x2 cat-grid--mosaique">
            {page.products.map((product) => (
              <ProductCard key={product.id} product={product} lang={lang} family={famOf(page)} />
            ))}
            {filler && rows > 0 ? <Filler filler={filler} style={span} /> : null}
          </div>
        ) : (
          <div className="cat-grid cat-grid--2x3">
            {page.products.map((product) => (
              <ProductCard key={product.id} product={product} lang={lang} family={famOf(page)} />
            ))}
            {filler && rows > 0 ? <Filler filler={filler} style={span} /> : null}
          </div>
        )}
      </div>
      <AvailabilityFooter text={page.availabilityFooter} />
    </div>
  )
}

/**
 * Pleine page (client, 17/11/2026 : « une possibilité de produit pleine page, 1 seul produit et sa promotion par
 * exemple ») : le produit en grand — photo, nom, poids et allergènes, prix (barré par sa remise, son badge et sa
 * période) — et, dessous, la promotion qui le contient (bundle, « 2+1 ») que l'API a placée avec lui.
 */
function FullPage({ items, lang, family }: { items: CatalogueDocItem[]; lang: CatalogueLang; family: Fam }) {
  const product = items.find((item): item is CatalogueDocProduct => !isDocOffer(item)) ?? null
  const offers = items.filter(isDocOffer)
  if (!product) return <>{offers.map((offer) => <OfferCard key={offer.id} offer={offer} lang={lang} family={family} big />)}</>
  return (
    <div className={`cat-full${product.oldPriceCents != null ? ' cat-full--promo' : ''}`}>
      <div className="cat-full__visual">
        {product.promo ? <span className="cat-offer__badge cat-full__badge">{product.promo.label}</span> : null}
        <Photo product={product} family={family} className="cat-full__photo" />
      </div>
      <div className="cat-full__text">
        <div className="cat-name cat-full__name">{product.name}</div>
        <Facts product={product} lang={lang} />
        <Price product={product} lang={lang} />
        {product.promo?.period ? <span className="cat-avail">{product.promo.period}</span> : null}
      </div>
      {offers.map((offer) => (
        <div className="cat-full__offer" key={offer.id}>
          <div className="cat-full__also">{lang === 'nl' ? 'Ook in promotie' : 'Aussi en promotion'}</div>
          <OfferCard offer={offer} lang={lang} family={family} row />
        </div>
      ))}
    </div>
  )
}

function ProductList({ products, lang, family }: { products: CatalogueDocItem[]; lang: CatalogueLang; family: Fam }) {
  return (
    <div className="cat-list">
      {products.map((product) =>
        isDocOffer(product) ? (
          <OfferCard key={product.id} offer={product} lang={lang} family={family} row />
        ) : (
          <div className="cat-row" key={product.id}>
            <Photo product={product} family={family} />
            <span className="cat-name">{product.name}</span>
            <Facts product={product} lang={lang} />
            <i />
            <Price product={product} lang={lang} />
          </div>
        ),
      )}
    </div>
  )
}

/**
 * La page de présentation d'une gamme : son illustration (la photo de sa couverture ou du webshop,
 * sinon son dessin de saison, sinon un cadre sobre — jamais une image inventée), son nom, un texte,
 * et au choix la liste de ses produits avec leurs prix.
 */
function Presentation({ page, lang }: { page: Extract<CatalogueDocPage, { kind: 'presentation' }>; lang: CatalogueLang }) {
  const drawing = drawingAsset(page.drawing)
  const withList = page.layout === 'presentation_liste'
  // « Photo pleine » préfère la photo ; les deux autres, le dessin au trait.
  const photoFirst = page.template === 'C'
  const visual = photoFirst ? (page.imageUrl ? { src: page.imageUrl, photo: true } : drawing ? { src: drawing, photo: false } : null)
    : drawing ? { src: drawing, photo: false } : page.imageUrl ? { src: page.imageUrl, photo: true } : null
  return (
    <div className={`cat-pres cat-pres--${withList ? 'liste' : 'seule'} cat-t-${page.template}`}>
      <div className={`cat-pres__visual${visual ? (visual.photo ? ' is-photo' : ' is-drawing') : ' is-none'}`}>
        {visual ? <img src={visual.src} alt="" /> : null}
      </div>
      <div className="cat-pres__head">
        <div className="cat-pres__eyebrow">{lang === 'nl' ? 'Het gamma' : 'La gamme'}</div>
        <div className="cat-pres__title" data-fit="Titre de la présentation">
          {page.title}
        </div>
        <div className="cat-pres__rule" />
        {page.text ? <div className="cat-pres__text">{page.text}</div> : null}
      </div>
      {withList && page.products.length ? (
        <div className="cat-pres__list" data-fit={page.title}>
          <ProductList products={page.products} lang={lang} family={famOf(page)} />
        </div>
      ) : null}
      {withList ? <AvailabilityFooter text={page.availabilityFooter} /> : null}
    </div>
  )
}

function Back({ page, doc }: { page: Extract<CatalogueDocPage, { kind: 'back' }>; doc: CatalogueDocument }) {
  const lang = doc.version.lang
  const shop = page.shop
  const logo = doc.charter.logoUrl ?? asset('img/logo.png')
  const look = page.look
  // Chaque élément (v1.12) : une ligne masquée des coordonnées arrive déjà vide du document ; l'aperçu de l'assistant
  // la masque ici aussi.
  const line = (element: string, value: string | null | undefined): string => (shown(look, element) ? value ?? '' : '')
  // Les coordonnées : adresse, horaires, téléphone(s), e-mail (17/11/2026 : « rajouter mail, téléphone 2 »).
  const phones = shop ? [line('phone', shop.phone), line('phone', shop.phone2)].filter(Boolean).join(' · ') : ''
  const hours = shop ? line('hours', shop.hours) : ''
  // Les horaires des fêtes de la boutique (21/11/2026), sous les horaires ; leurs retours à la ligne sont gardés.
  const holidays = shop ? line('holidays', shop.holidayHours) : ''
  const lines = shop ? [line('address', shop.address), hours ? (lang === 'nl' ? `Open ${hours}` : `Ouvert ${hours}`) : '', holidays, phones, line('email', shop.email)].filter(Boolean) : []
  const logoTag = shown(look, 'logo') ? <img className="cat-logo cat-logo--dark" src={logo} alt="" /> : null
  const titleTag = shown(look, 'title') ? <div className="cat-back__title" style={textStyle(look, 'title')}>{page.title}</div> : null
  const textTag = page.text && shown(look, 'text') ? <div className="cat-back__text" style={textStyle(look, 'text')}>{page.text}</div> : null
  const qr = page.qrUrl && shown(look, 'qr') ? page.qrUrl : null
  const shopStyle = textStyle(look, 'shop')
  const showShop = shown(look, 'shop')
  if (page.template === 'B') {
    // Boutique en avant (maquette A3, gabarit B) : l'adresse et les horaires en grand, le QR plus petit en bas.
    return (
      <div className="cat-back cat-back--B">
        {logoTag}
        {titleTag}
        {textTag}
        {showShop ? (
          <div className="cat-back__shopB">
            <div className="cat-back__who" style={shopStyle}>{shop ? `L’Atelier By — ${shop.name}` : 'L’Atelier By'}</div>
            {lines.map((text, index) => (
              <p key={index} style={shopStyle} className={text === holidays ? 'cat-back__holidays' : undefined}>{text}</p>
            ))}
          </div>
        ) : null}
        {qr ? (
          <div className="cat-back__qr cat-back__qr--small">
            <Qr url={qr} size={20} />
            <div>
              <div className="cat-back__host">{page.host}</div>
              <div className="cat-back__hint">{shop ? (lang === 'nl' ? `De webshop van ${shop.name}` : `Le webshop de ${shop.name}`) : lang === 'nl' ? 'Al onze winkels' : 'Toutes nos boutiques'}</div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div className="cat-back">
      {logoTag}
      {titleTag}
      {textTag}
      {qr ? (
        <div className="cat-back__qr">
          <Qr url={qr} size={30} />
          <div>
            <div className="cat-back__host">{page.host}</div>
            <div className="cat-back__hint">
              {shop ? (lang === 'nl' ? `De webshop van ${shop.name}` : `Le webshop de ${shop.name}`) : lang === 'nl' ? 'Al onze winkels' : 'Toutes nos boutiques'}
            </div>
          </div>
        </div>
      ) : null}
      {showShop ? (
        <div className="cat-back__shop">
          <div className="cat-back__who" style={shopStyle}>{shop ? `L’Atelier By — ${shop.name}` : 'L’Atelier By'}</div>
          {shop ? (
            <p style={shopStyle}>
              {[line('address', shop.address), hours ? (lang === 'nl' ? `Open ${hours}` : `Ouvert ${hours}`) : '', holidays, line('phone', shop.phone)].filter(Boolean).map((text, index) => (
                <span key={index} className={text === holidays ? 'cat-back__holidays' : undefined}>
                  {index > 0 ? <br /> : null}
                  {text}
                </span>
              ))}
            </p>
          ) : page.host ? (
            <p style={shopStyle}>{lang === 'nl' ? `Al onze winkels op ${page.host}` : `Toutes nos boutiques sur ${page.host}`}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Une page au format fini plus le fond perdu (les fonds débordent dans la marge que l'imprimeur coupe). */
export function CataloguePage({ doc, index }: { doc: CatalogueDocument; index: number }) {
  const page = doc.pages[index]
  const size = FORMAT_MM[doc.catalogue.format]
  const style = {
    width: mm(size.w + BLEED * 2),
    height: mm(size.h + BLEED * 2),
    '--u': size.w / 148,
    '--b': mm(BLEED),
    '--p': doc.charter.colors.primary,
    '--s': doc.charter.colors.secondary,
    '--a': doc.charter.colors.accent,
    '--i': doc.charter.colors.ink,
  } as CSSProperties
  return (
    <div className={`cat-face cat-face--${page.kind}${page.kind === 'products' || page.kind === 'presentation' ? ` cat-face--t${page.template ?? 'A'}` : ''}${page.kind === 'cover' ? ` cat-face--cover${page.template ?? 'A'}` : ''}`} style={style} lang={doc.version.lang}>
      <div className="cat-trim">
        {page.kind === 'cover' ? <Cover page={page} doc={doc} /> : null}
        {page.kind === 'brand' ? <Brand page={page} doc={doc} /> : null}
        {page.kind === 'products' ? <Products page={page} lang={doc.version.lang} /> : null}
        {page.kind === 'presentation' ? <Presentation page={page} lang={doc.version.lang} /> : null}
        {page.kind === 'back' ? <Back page={page} doc={doc} /> : null}
      </div>
    </div>
  )
}

function Marks({ format, offset }: { format: CatalogueFormat; offset: number }) {
  const { w, h } = FORMAT_MM[format]
  const reach = offset - BLEED
  const total = { w: w + offset * 2, h: h + offset * 2 }
  const xs = [offset, offset + w]
  const ys = [offset, offset + h]
  return (
    <svg className="cat-marks" viewBox={`0 0 ${total.w} ${total.h}`} width={mm(total.w)} height={mm(total.h)}>
      <g stroke="#000" strokeWidth="0.25" fill="none">
        {xs.map((x) => (
          <g key={`x${x}`}>
            <line x1={x} y1={0} x2={x} y2={reach} />
            <line x1={x} y1={total.h - reach} x2={x} y2={total.h} />
          </g>
        ))}
        {ys.map((y) => (
          <g key={`y${y}`}>
            <line x1={0} y1={y} x2={reach} y2={y} />
            <line x1={total.w - reach} y1={y} x2={total.w} y2={y} />
          </g>
        ))}
      </g>
    </svg>
  )
}

/**
 * Une feuille : en aperçu et en épreuve, au format fini (fond perdu rogné) ; pour l'imprimeur,
 * avec 3 mm de fond perdu et les traits de coupe.
 */
export function CatalogueSheet({ doc, index, mode }: { doc: CatalogueDocument; index: number; mode: CatalogueSheetMode }) {
  const size = sheetSize(doc.catalogue.format, mode)
  const offset = mode === 'printer' ? BLEED + MARKS : 0
  return (
    <div className={`cat-sheet cat-sheet--${mode}`} style={{ width: mm(size.w), height: mm(size.h) }}>
      <div className="cat-sheet__face" style={{ left: mm(offset - BLEED), top: mm(offset - BLEED) }}>
        <CataloguePage doc={doc} index={index} />
      </div>
      {mode === 'printer' ? <Marks format={doc.catalogue.format} offset={offset} /> : null}
    </div>
  )
}
