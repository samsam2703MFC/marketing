import type { CSSProperties } from 'react'
import type { CatalogueDocPage, CatalogueDocProduct, CatalogueDocument, CatalogueFormat, CatalogueLang } from '../../lib/api/module'
import { qrPath } from '../../lib/qr'
import { fontFaces } from '../brochure/Pages'
import { familyImage, seasonImage } from '../builder/illustrations'
import CATALOGUE_CSS from './catalogue-pages.css?inline'

/**
 * Les pages d'un catalogue, en millimètres : ce que l'aperçu montre est ce qui part à
 * l'impression (même balisage, même feuille de style), comme les brochures — et par le même
 * moteur (`lib/print.ts`), avec les mêmes polices de la marque (`fontFaces`).
 *
 * Le document est composé par l'API (`…/catalogues/{id}/document`) : 8, 12 ou 16 pages ; la
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

export const LAYOUT_LABELS: Record<'vedette' | 'grille' | 'liste', { label: string; capacity: number }> = {
  vedette: { label: '1 vedette + 4', capacity: 5 },
  grille: { label: 'Grille 2 × 3', capacity: 6 },
  liste: { label: 'Liste avec prix', capacity: 12 },
}

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

function Price({ product, lang }: { product: CatalogueDocProduct; lang: CatalogueLang }) {
  return <span className={`cat-price${product.priceCents === null ? ' cat-price--none' : ''}`}>{formatCents(product.priceCents, lang)}</span>
}

/** La photo du webshop ; sans elle, le dessin de la famille (celui des brochures), jamais une photo inventée. */
function Photo({ product, family, className = '' }: { product: CatalogueDocProduct; family: string; className?: string }) {
  const drawing = product.imageUrl ? null : absolute(familyImage(family))
  return (
    <span className={`cat-photo${drawing ? ' cat-photo--drawing' : ''} ${className}`}>
      {product.imageUrl ? <img src={product.imageUrl} alt="" /> : drawing ? <img src={drawing} alt="" /> : <span className="cat-photo__none" />}
    </span>
  )
}

const absolute = (url: string | null): string | null => (url ? new URL(url, window.location.href).href : null)

/** L'illustration d'une gamme en définition d'impression (celle des brochures). */
const seasonDrawing = (title: string): string | null => absolute(seasonImage(title)?.replace('/img/seasons/', '/img/print/') ?? null)

function Cover({ page, doc }: { page: Extract<CatalogueDocPage, { kind: 'cover' }>; doc: CatalogueDocument }) {
  const logo = doc.charter.logoUrl ?? asset('img/logo-white.png')
  // Sans visuel dans la charte : l'illustration de la gamme (Noël, Saint-Nicolas…), au trait blanc.
  const drawing = page.imageUrl ? null : seasonDrawing(page.title)
  return (
    <div className="cat-cover">
      <img className={`cat-logo${doc.charter.logoUrl ? ' cat-logo--custom' : ''}`} src={logo} alt="" />
      <div className="cat-cover__title" data-fit="Titre de couverture">
        {page.title}
      </div>
      {page.subtitle ? <div className="cat-cover__sub">{page.subtitle}</div> : null}
      {page.eyebrow ? <div className="cat-cover__shop">{`L’Atelier By · ${page.eyebrow}`}</div> : null}
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
  return (
    <div className={`cat-brand cat-brand--${page.slot}${page.imageUrl ? ' cat-brand--image' : ''}`}>
      {page.imageUrl ? (
        <div className="cat-brand__visual">
          <img src={page.imageUrl} alt="" />
        </div>
      ) : (
        <img className="cat-logo cat-logo--dark cat-brand__logo" src={logo} alt="" />
      )}
      <div className="cat-brand__title">{page.title}</div>
      <div className="cat-brand__rule" />
      <div className="cat-brand__text" data-fit={page.title}>
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
    </div>
  )
}

function ProductCard({ product, lang, family, big = false }: { product: CatalogueDocProduct; lang: CatalogueLang; family: string; big?: boolean }) {
  return (
    <div className={`cat-card${big ? ' cat-card--big' : ''}`}>
      <Photo product={product} family={family} />
      <div className="cat-card__text">
        <div className="cat-name">{product.name}</div>
        <Price product={product} lang={lang} />
      </div>
    </div>
  )
}

function Products({ page, lang }: { page: Extract<CatalogueDocPage, { kind: 'products' }>; lang: CatalogueLang }) {
  const [first, ...rest] = page.products
  return (
    <div className={`cat-inner cat-inner--${page.layout}`}>
      <div className="cat-h">{page.title}</div>
      <div className="cat-body" data-fit={page.title}>
        {page.products.length === 0 ? (
          <div className="cat-empty">Page vide</div>
        ) : page.layout === 'liste' ? (
          <div className="cat-list">
            {page.products.map((product) => (
              <div className="cat-row" key={product.id}>
                <Photo product={product} family={page.title} />
                <span className="cat-name">{product.name}</span>
                <i />
                <Price product={product} lang={lang} />
              </div>
            ))}
          </div>
        ) : page.layout === 'vedette' && first ? (
          <>
            <ProductCard product={first} lang={lang} family={page.title} big />
            <div className="cat-grid cat-grid--2x2">
              {rest.map((product) => (
                <ProductCard key={product.id} product={product} lang={lang} family={page.title} />
              ))}
            </div>
          </>
        ) : (
          <div className="cat-grid cat-grid--2x3">
            {page.products.map((product) => (
              <ProductCard key={product.id} product={product} lang={lang} family={page.title} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Back({ page, doc }: { page: Extract<CatalogueDocPage, { kind: 'back' }>; doc: CatalogueDocument }) {
  const lang = doc.version.lang
  const shop = page.shop
  const logo = doc.charter.logoUrl ?? asset('img/logo.png')
  return (
    <div className="cat-back">
      <img className="cat-logo cat-logo--dark" src={logo} alt="" />
      <div className="cat-back__title">{page.title}</div>
      {page.text ? <div className="cat-back__text">{page.text}</div> : null}
      {page.qrUrl ? (
        <div className="cat-back__qr">
          <Qr url={page.qrUrl} size={30} />
          <div>
            <div className="cat-back__host">{page.host}</div>
            <div className="cat-back__hint">
              {shop ? (lang === 'nl' ? `De webshop van ${shop.name}` : `Le webshop de ${shop.name}`) : lang === 'nl' ? 'Al onze winkels' : 'Toutes nos boutiques'}
            </div>
          </div>
        </div>
      ) : null}
      <div className="cat-back__shop">
        <div className="cat-back__who">{shop ? `L’Atelier By — ${shop.name}` : 'L’Atelier By'}</div>
        {shop ? (
          <p>
            {[shop.address, shop.hours ? (lang === 'nl' ? `Open ${shop.hours}` : `Ouvert ${shop.hours}`) : '', shop.phone].filter(Boolean).map((line, index) => (
              <span key={index}>
                {index > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </p>
        ) : (
          <p>{lang === 'nl' ? `Al onze winkels op ${page.host ?? ''}` : `Toutes nos boutiques sur ${page.host ?? ''}`}</p>
        )}
      </div>
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
    <div className={`cat-face cat-face--${page.kind}`} style={style} lang={doc.version.lang}>
      <div className="cat-trim">
        {page.kind === 'cover' ? <Cover page={page} doc={doc} /> : null}
        {page.kind === 'brand' ? <Brand page={page} doc={doc} /> : null}
        {page.kind === 'products' ? <Products page={page} lang={doc.version.lang} /> : null}
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
