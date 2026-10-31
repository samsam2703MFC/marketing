import type { CSSProperties, ReactNode } from 'react'
import { BLEED, FOLD_PANELS, FORMATS, MARKS, formatPrice, hoursText, mechanicText } from '../../lib/brochure'
import type { BrochureDoc, BrochureProduct, TextKey } from '../../lib/brochure'
import { qrPath } from '../../lib/qr'
import type { QrPath } from '../../lib/qr'

/**
 * Les pages d'une brochure, en millimètres : ce qui s'affiche dans l'aperçu est
 * ce qui part à l'impression (même balisage, même feuille de style).
 *
 * Chaque face est composée au format fini plus 3 mm de fond perdu : les fonds
 * et les bandeaux qui touchent un bord débordent dans cette marge, que
 * l'imprimeur coupe. Les textes restent à l'intérieur du format fini.
 *
 * Un texte porte `data-k` (sa clé) : un clic dessus, dans l'aperçu, l'ouvre en
 * édition. Un bloc de taille fixe porte `data-fit` : l'aperçu signale ceux dont
 * le contenu déborde.
 */

export type Side = 0 | 1
export type SheetMode = 'preview' | 'proof' | 'printer'

const mm = (value: number): string => `${value}mm`

const QR_CACHE = new Map<string, QrPath>()

function Qr({ url, size }: { url: string; size: number }) {
  let path = QR_CACHE.get(url)
  if (!path) {
    path = qrPath(url)
    QR_CACHE.set(url, path)
  }
  return (
    <svg className="bro-qr" viewBox={`0 0 ${path.size} ${path.size}`} width={mm(size)} height={mm(size)} shapeRendering="crispEdges" aria-label={url}>
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}

/** Un texte du document, éditable au clic dans l'aperçu. Vide, il ne s'imprime pas. */
function Txt({ doc, k, className }: { doc: BrochureDoc; k: TextKey; className: string }) {
  const value = doc.texts[k]
  if (!value.trim()) return null
  return (
    <div className={className} data-k={k}>
      {value}
    </div>
  )
}

function Price({ doc, product, className = '' }: { doc: BrochureDoc; product: BrochureProduct; className?: string }) {
  return (
    <span className={`bro-price ${className}`}>
      {product.before !== null ? <s>{formatPrice(product.before, doc.lang)}</s> : null}
      {product.price === null ? <b className="bro-q">? €</b> : <b>{formatPrice(product.price, doc.lang)}</b>}
    </span>
  )
}

/** La mécanique en clair, quand le prix seul ne la dit pas (remise, X + Y, livraison). */
function Mechanic({ doc, product }: { doc: BrochureDoc; product: BrochureProduct }) {
  if (!product.mechanic || ['CROSSED_PRICE', 'BUNDLE_FIXED'].includes(product.mechanic.type)) return null
  const text = mechanicText(product.mechanic, doc.lang)
  return text ? <span className="bro-mech">{text}</span> : null
}

function Dot({ src, drawing = false, className = '' }: { src: string | null; drawing?: boolean; className?: string }) {
  if (!src) return null
  return (
    <span className={`bro-dot${drawing ? ' bro-dot--drawing' : ''} ${className}`}>
      <img src={src} alt="" />
    </span>
  )
}

/** Le bandeau bas d'un panneau, qui déborde dans le fond perdu. */
function Band({ doc, className = '' }: { doc: BrochureDoc; className?: string }) {
  return (
    <div className={`bro-band ${className}`} data-fit="Bandeau">
      <Txt doc={doc} k="cta" className="bro-cta" />
      <Txt doc={doc} k="ctaSub" className="bro-ctasub" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Couverture : le recto du leaflet, le volet de couverture du dépliant
// ---------------------------------------------------------------------------

function Cover({ doc }: { doc: BrochureDoc }) {
  const first = doc.products[0]
  const logo = ['ruby', 'noir', 'duo'].includes(doc.template) ? doc.logoWhite : doc.logo

  const head = (
    <>
      <img className="bro-logo" src={logo} alt={doc.brandName} />
      <Txt doc={doc} k="eyebrow" className="bro-eyebrow" />
      <div className="bro-titlebox" data-fit="Titre">
        <Txt doc={doc} k="title" className="bro-title" />
      </div>
      <Txt doc={doc} k="phrase" className="bro-phrase" />
    </>
  )

  const hero = first ? (
    <div className="bro-hero">
      {first.image ?? doc.cover ? <img src={first.image ?? doc.cover ?? ''} alt="" className={first.image && !first.illustration ? '' : 'bro-hero__drawing'} /> : null}
      <span className="bro-badge">
        {first.price === null ? <b className="bro-q">? €</b> : <b>{formatPrice(first.price, doc.lang)}</b>}
        <small>{first.name}</small>
      </span>
    </div>
  ) : doc.cover ? (
    <img className="bro-illus" src={doc.cover} alt="" />
  ) : null

  switch (doc.template) {
    case 'epure':
      return (
        <div className="bro-cover">
          {head}
          {hero}
          <Txt doc={doc} k="ctaSub" className="bro-foot" />
        </div>
      )
    case 'noir':
      return (
        <div className="bro-cover">
          {head}
          {hero}
          <Txt doc={doc} k="cta" className="bro-foot bro-foot--script" />
        </div>
      )
    case 'ruby':
      return (
        <div className="bro-cover">
          {head}
          {doc.cover ? <img className="bro-illus bro-illus--white" src={doc.cover} alt="" /> : <span className="bro-grow" />}
          <div className="bro-foot">
            <Txt doc={doc} k="cta" className="bro-cta" />
            <Txt doc={doc} k="ctaSub" className="bro-ctasub" />
          </div>
        </div>
      )
    case 'abricot':
      return (
        <div className="bro-cover">
          {head}
          {/* Sans photo ni dessin de famille, l'illustration de la gamme plutôt que trois ronds vides. */}
          {doc.products.slice(0, 3).some((product) => product.image) ? (
            <div className="bro-dots">
              {doc.products.slice(0, 3).map((product) => (
                <Dot key={product.key} src={product.image} drawing={product.illustration} />
              ))}
            </div>
          ) : doc.cover ? (
            <img className="bro-illus bro-illus--left" src={doc.cover} alt="" />
          ) : null}
          <Band doc={doc} />
        </div>
      )
    case 'duo':
      return (
        <div className="bro-cover">
          <div className="bro-duo__left">
            <div className="bro-duo__bg" />
            {head}
          </div>
          <div className="bro-duo__right" data-fit="Produits">
            {doc.products.slice(0, 4).map((product) => (
              <div className="bro-duo__item" key={product.key}>
                <Dot src={product.image} drawing={product.illustration} />
                <div>
                  <div className="bro-name">{product.name}</div>
                  <Price doc={doc} product={product} />
                </div>
              </div>
            ))}
            <Txt doc={doc} k="ctaSub" className="bro-duo__host" />
          </div>
        </div>
      )
    case 'carte':
      return (
        <div className="bro-cover">
          {head}
          <div className="bro-menu" data-fit="Carte">
            {doc.products.slice(0, 6).map((product) => (
              <div className="bro-menu__row" key={product.key}>
                <span className="bro-name">{product.name}</span>
                <i />
                <Price doc={doc} product={product} />
              </div>
            ))}
          </div>
          {doc.cover ? <img className="bro-illus bro-illus--small" src={doc.cover} alt="" /> : <span className="bro-grow" />}
          <Band doc={doc} />
        </div>
      )
    default:
      return (
        <div className="bro-cover">
          {head}
          {doc.cover ? <img className="bro-illus" src={doc.cover} alt="" /> : <span className="bro-grow" />}
          <Band doc={doc} />
        </div>
      )
  }
}

// ---------------------------------------------------------------------------
// Boutique : bloc du verso, dos du dépliant
// ---------------------------------------------------------------------------

function ShopLines({ doc }: { doc: BrochureDoc }) {
  const shop = doc.shop
  if (!shop) {
    return (
      <>
        <div className="bro-who">{doc.brandName}</div>
        <p>{doc.lang === 'nl' ? `Al onze winkels op ${doc.host}` : `Toutes nos boutiques sur ${doc.host}`}</p>
      </>
    )
  }
  const lines = [shop.address, hoursText(shop, doc.lang), shop.phone].filter(Boolean)
  return (
    <>
      <div className="bro-who">
        {doc.brandName} {shop.name}
      </div>
      <p>
        {lines.map((line, index) => (
          <span key={index}>
            {index > 0 ? <br /> : null}
            {line}
          </span>
        ))}
      </p>
    </>
  )
}

function QrBox({ doc, size }: { doc: BrochureDoc; size: number }) {
  return (
    <div className="bro-qrbox">
      <Qr url={doc.qrUrl} size={size} />
      <span>{doc.qrLabel}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------

function ProductRow({ doc, product }: { doc: BrochureDoc; product: BrochureProduct }) {
  return (
    <div className={`bro-item${product.image ? '' : ' bro-item--noimg'}`}>
      <Dot src={product.image} drawing={product.illustration} />
      <div className="bro-item__text">
        <div className="bro-name">{product.name}</div>
        {product.sub ? <small>{product.sub}</small> : null}
        <Mechanic doc={doc} product={product} />
      </div>
      <Price doc={doc} product={product} className="bro-item__price" />
    </div>
  )
}

function MenuRow({ doc, product }: { doc: BrochureDoc; product: BrochureProduct }) {
  return (
    <div className="bro-menu__row">
      <span className="bro-name">
        {product.name}
        {product.sub ? <small> · {product.sub}</small> : null}
      </span>
      <i />
      <Price doc={doc} product={product} />
    </div>
  )
}

function Products({ doc, products }: { doc: BrochureDoc; products: BrochureProduct[] }) {
  if (doc.template === 'carte') {
    return (
      <div className="bro-menu bro-menu--list">
        {products.map((product) => (
          <MenuRow key={product.key} doc={doc} product={product} />
        ))}
      </div>
    )
  }
  return (
    <div className={`bro-items${products.length > 4 ? ' bro-items--dense' : ''}`}>
      {products.map((product) => (
        <ProductRow key={product.key} doc={doc} product={product} />
      ))}
    </div>
  )
}

function HeroProduct({ doc, product }: { doc: BrochureDoc; product: BrochureProduct }) {
  return (
    <div className="bro-solo">
      <Dot src={product.image} drawing={product.illustration} className="bro-dot--big" />
      <div className="bro-name">{product.name}</div>
      {product.sub ? <small>{product.sub}</small> : null}
      <Mechanic doc={doc} product={product} />
      <Price doc={doc} product={product} className="bro-solo__price" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

/** Le verso du leaflet : les produits, les conditions, la boutique. */
function LeafletBack({ doc }: { doc: BrochureDoc }) {
  return (
    <div className="bro-back">
      <Txt doc={doc} k="innerTitle" className="bro-h" />
      <Txt doc={doc} k="innerSub" className="bro-sub" />
      <div className="bro-back__products" data-fit="Produits">
        <Products doc={doc} products={doc.products} />
      </div>
      <div className="bro-legalbox" data-fit="Conditions">
        <Txt doc={doc} k="conditions" className="bro-legal" />
      </div>
      <div className="bro-shop" data-fit="Boutique">
        <div className="bro-shop__lines">
          <ShopLines doc={doc} />
        </div>
        <QrBox doc={doc} size={22} />
      </div>
    </div>
  )
}

/** Le rabat du dépliant : commander, retirer, le QR code. */
function Flap({ doc }: { doc: BrochureDoc }) {
  return (
    <div className="bro-flap" data-fit="Rabat">
      <img className="bro-flap__img" src={doc.flapImage} alt="" />
      <Txt doc={doc} k="flapTitle" className="bro-h bro-h--small" />
      <Txt doc={doc} k="flapText" className="bro-flap__text" />
      <QrBox doc={doc} size={26} />
    </div>
  )
}

/** Le dos du dépliant : la boutique et les conditions. */
function Spine({ doc }: { doc: BrochureDoc }) {
  return (
    <div className="bro-spine">
      <img className="bro-logo" src={doc.logoWhite} alt={doc.brandName} />
      <div className="bro-spine__foot" data-fit="Dos">
        <ShopLines doc={doc} />
        <Txt doc={doc} k="conditions" className="bro-legal" />
      </div>
    </div>
  )
}

/** L'intérieur du dépliant : un produit par volet jusqu'à trois, sinon des listes réparties. */
function Inside({ doc, index }: { doc: BrochureDoc; index: number }) {
  const products = doc.products
  const solo = products.length <= 3
  const per = Math.ceil(products.length / 3) || 1
  const mine = solo ? products.slice(index, index + 1) : products.slice(index * per, index * per + per)

  return (
    <div className="bro-inside">
      {/* Le titre au-dessus du premier volet seulement : les produits des trois volets restent alignés. */}
      {index === 0 ? (
        <div className="bro-inside__head" data-fit="Titre des produits">
          <Txt doc={doc} k="innerTitle" className="bro-h" />
          <Txt doc={doc} k="innerSub" className="bro-sub" />
        </div>
      ) : null}
      <div className="bro-inside__body" data-fit={`Volet ${index + 1}`}>
        {solo ? mine.map((product) => <HeroProduct key={product.key} doc={doc} product={product} />) : <Products doc={doc} products={mine} />}
      </div>
      {index === 2 ? <Txt doc={doc} k="cta" className="bro-inside__cta" /> : null}
    </div>
  )
}

interface PanelDef {
  width: number
  className: string
  content: ReactNode
}

function panelsOf(doc: BrochureDoc, side: Side): PanelDef[] {
  if (doc.format === 'leaflet-a5') {
    return side === 0
      ? [{ width: 148, className: 'bro-p-cover', content: <Cover doc={doc} /> }]
      : [{ width: 148, className: 'bro-p-back', content: <LeafletBack doc={doc} /> }]
  }
  if (side === 0) {
    const [flap, spine, cover] = FOLD_PANELS.outside
    return [
      { width: flap, className: 'bro-p-flap', content: <Flap doc={doc} /> },
      { width: spine, className: 'bro-p-spine', content: <Spine doc={doc} /> },
      { width: cover, className: 'bro-p-cover', content: <Cover doc={doc} /> },
    ]
  }
  return FOLD_PANELS.inside.map((width, index) => ({ width, className: 'bro-p-inside', content: <Inside doc={doc} index={index} /> }))
}

/** Une face au format fini plus le fond perdu. */
export function Face({ doc, side }: { doc: BrochureDoc; side: Side }) {
  const def = FORMATS[doc.format]
  const panels = panelsOf(doc, side)
  let left = 0

  const style = {
    width: mm(def.trimW + BLEED * 2),
    height: mm(def.trimH + BLEED * 2),
    '--b': mm(BLEED),
    '--p': doc.colors.primary,
    '--s': doc.colors.secondary,
    '--a': doc.colors.accent,
    '--i': doc.colors.ink,
  } as CSSProperties

  return (
    <div className={`bro-face bro-t-${doc.template} bro-f-${doc.format}`} style={style} lang={doc.lang}>
      <div className="bro-trim">
        {panels.map((panel, index) => {
          const x = left
          left += panel.width
          const panelStyle = {
            left: mm(x),
            width: mm(panel.width),
            // La couverture se met à l'échelle de son volet ; le reste garde des corps lisibles.
            '--u': panel.className === 'bro-p-cover' ? panel.width / 148 : doc.format === 'leaflet-a5' ? 1 : 0.9,
            '--bl': index === 0 ? mm(BLEED) : '0mm',
            '--br': index === panels.length - 1 ? mm(BLEED) : '0mm',
          } as CSSProperties
          return (
            <section key={index} className={`bro-panel ${panel.className}`} style={panelStyle}>
              <div className="bro-panel__bg" />
              <div className="bro-panel__in">{panel.content}</div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Les plis du dépliant, à partir du bord gauche du format fini. */
function folds(doc: BrochureDoc, side: Side): number[] {
  if (doc.format !== 'depliant-a4') return []
  const widths = side === 0 ? FOLD_PANELS.outside : FOLD_PANELS.inside
  return [widths[0], widths[0] + widths[1]]
}

function Marks({ doc, side, offset }: { doc: BrochureDoc; side: Side; offset: number }) {
  const def = FORMATS[doc.format]
  const w = def.trimW
  const h = def.trimH
  const o = offset
  const reach = offset - BLEED
  const xs = [o, o + w]
  const ys = [o, o + h]
  const total = { w: w + o * 2, h: h + o * 2 }

  return (
    <svg className="bro-marks" viewBox={`0 0 ${total.w} ${total.h}`} width={mm(total.w)} height={mm(total.h)}>
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
        {folds(doc, side).map((fold) => (
          <g key={`f${fold}`} strokeDasharray="1 1">
            <line x1={o + fold} y1={0} x2={o + fold} y2={reach} />
            <line x1={o + fold} y1={total.h - reach} x2={o + fold} y2={total.h} />
          </g>
        ))}
      </g>
    </svg>
  )
}

/** Dimensions d'une page imprimée, en millimètres. */
export function pageSize(doc: Pick<BrochureDoc, 'format'>, mode: SheetMode, marks: boolean): { w: number; h: number } {
  const def = FORMATS[doc.format]
  if (mode === 'proof') return { w: def.trimW, h: def.trimH }
  const margin = BLEED + (marks || mode === 'preview' ? MARKS : 0)
  return { w: def.trimW + margin * 2, h: def.trimH + margin * 2 }
}

/**
 * Une page : en épreuve, au format fini (le fond perdu est rogné) ; pour l'imprimeur, avec le fond
 * perdu et, si demandé, les traits de coupe ; dans l'aperçu, avec le format fini en pointillé.
 */
export function Sheet({ doc, side, mode, marks, watermark = false }: { doc: BrochureDoc; side: Side; mode: SheetMode; marks: boolean; watermark?: boolean }) {
  const size = pageSize(doc, mode, marks)
  const offset = mode === 'proof' ? 0 : (size.w - FORMATS[doc.format].trimW) / 2
  const facePos = mode === 'proof' ? -BLEED : offset - BLEED

  return (
    <div className={`bro-page bro-page--${mode}`} style={{ width: mm(size.w), height: mm(size.h) }}>
      <div className="bro-page__face" style={{ left: mm(facePos), top: mm(facePos) }}>
        <Face doc={doc} side={side} />
      </div>
      {mode === 'preview' ? (
        <div
          className="bro-page__trim"
          style={{ left: mm(offset), top: mm(offset), width: mm(FORMATS[doc.format].trimW), height: mm(FORMATS[doc.format].trimH) }}
        >
          {folds(doc, side).map((fold) => (
            <span key={fold} className="bro-page__fold" style={{ left: mm(fold) }} />
          ))}
        </div>
      ) : null}
      {mode !== 'proof' && (marks || mode === 'preview') ? <Marks doc={doc} side={side} offset={offset} /> : null}
      {watermark ? <div className="bro-page__watermark">{doc.lang === 'nl' ? 'PROEF' : 'ÉPREUVE'}</div> : null}
    </div>
  )
}

/** Les polices de la marque, en adresses absolues : la fenêtre d'impression n'a pas la base de l'application. */
export function fontFaces(): string {
  const root = new URL(`${import.meta.env.BASE_URL}fonts/`, window.location.href).href
  const face = (family: string, file: string, weight: number) =>
    `@font-face{font-family:'${family}';src:url('${root}${file}');font-weight:${weight};font-display:block}`
  return [
    face('Gotham', 'Gotham_Light.otf', 300),
    face('Gotham', 'Gotham_Regular.otf', 400),
    face('Gotham', 'Gotham_Medium.otf', 500),
    face('Vank', 'GC_Vank.ttf', 400),
    face('Playwrite', 'PlaywriteDEVA-Regular.ttf', 400),
  ].join('\n')
}
