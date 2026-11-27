import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, ReactNode } from 'react'
import * as api from '../../lib/api/module'
import type { Catalogue, CatalogueDocument, CatalogueHeader, CatalogueLang, CatalogueLayout, CataloguePageCount, CatalogueTemplate } from '../../lib/api/module'
import { CatalogueSheet, FORMAT_MM, HEADER_LABELS, LAYOUT_LABELS, TEMPLATE_LABELS, catalogueCss, formatCents, isPresentation } from './CataloguePages'
import type { CatalogueSheetMode } from './CataloguePages'
import { HeaderIcon, LayoutIcon, TemplateIcon } from './CatalogueIcons'
import './catalogue-wizard.css'
// Après la feuille de l'assistant : celle de « Gamme par gamme » la précise (mêmes poids de sélecteurs).
import StepGammes, { initialBlocks } from './CatalogueGammes'

/**
 * L'assistant de l'éditeur de catalogue (21/11/2026, Sam : « dans l'éditeur de catalogue faire un assistant comme dans le
 * dashboard franchisé — feuilletage, drag and drop — le plus complet possible »). Le parcours du franchisé
 * (consultant_BO, panel/public/dashboard/catalogue.js), côté marque :
 *   1 · Catalogue — format, pages, langues, boutiques (une version chacune), les 4 pages de la marque ;
 *   2 · Produits — les produits du webshop, par catégorie, et les promotions ;
 *   3 · Présentation — une sous-étape par catégorie (comment présenter ses produits, pleine page, gabarit, en-tête,
 *       produits montrés), puis la mise en page finale : les catégories en blocs, à glisser-déposer ; « Réglages page
 *       par page » ouvre l'éditeur détaillé ;
 *   4 · Validation — ce que dit la composition de chaque version (FR / NL, générale / par boutique), point par point ;
 *   5 · Feuilleter et imprimer — le catalogue comme imprimé et plié (la page tourne), puis le PDF et son état.
 * Tout s'enregistre au fil de l'eau par l'API des catalogues ; l'aperçu est le document que l'API compose.
 */

export type WizardStep = 1 | 2 | 3 | 4 | 5

const MM = 96 / 25.4
const STEPS: Array<{ n: WizardStep; label: string; hint: string }> = [
  { n: 1, label: 'Catalogue', hint: 'format, pages, boutiques' },
  { n: 2, label: 'Produits', hint: 'par catégorie, promotions' },
  { n: 3, label: 'Gamme par gamme', hint: 'présentation, mise en page' },
  { n: 4, label: 'Validation', hint: 'ce qui s’imprimera' },
  { n: 5, label: 'Feuilleter, imprimer', hint: 'le PDF, son état' },
]
/** Les mises en page qu'une catégorie choisit (la pleine page se choisit à part ; les présentations, page par page). */
const MEP_LAYOUTS: CatalogueLayout[] = ['vedette', 'grille', 'liste', 'mosaique']
/** Ce que chacune tient, dit par la place des produits (les mots du dashboard franchisé). */
const DISPOS: Record<string, [string, string]> = {
  liste: ['1 par largeur', 'liste avec prix · 12'],
  grille: ['2 par largeur', 'grille 2 × 3 · 6'],
  mosaique: ['2 grandes', 'vignettes 2 × 2 · 4'],
  vedette: ['1 vedette + 4', 'la vedette en haut · 5'],
}
const MEP_COLORS = ['#8D1D2C', '#B0792A', '#3f7a52', '#2F5D8A', '#7A4E8C', '#A0522D']
const OTHER_COLOR = '#9a948c'
const PAGE_COUNTS: CataloguePageCount[] = [8, 10, 12, 14, 16]
const BRAND_PAGES = 4
export const STATUS_LABELS: Record<api.CatalogueStatus, string> = { brouillon: 'Brouillon', pret: 'PDF prêt', imprime: 'Imprimé' }

const blankPage = (): api.CataloguePageRow => ({ layout: 'grille', category: null, template: 'A', gamme: null, filler: null, fillerMediaId: null, header: 'titre', script: false })

// -------------------------------------------------------------------------------------------------
// La mise en page d'une catégorie (le calcul de l'assistant du franchisé, mepPoser)
// -------------------------------------------------------------------------------------------------

/** Les pages d'une catégorie (hors présentations), dans l'ordre du catalogue. */
export function categoryPages(pages: api.CataloguePageRow[], c: number): number[] {
  return pages.map((_, i) => i).filter((i) => !isPresentation(pages[i].layout) && pages[i].category === c)
}

/** Le réglage d'une catégorie lu dans ses pages : sa pleine page (et son produit), la mise en page des autres, gabarit, en-tête, manuscrite. */
export function categoryState(pages: api.CataloguePageRow[], c: number) {
  const idx = categoryPages(pages, c)
  const full = idx.find((i) => pages[i].layout === 'pleine')
  const other = idx.find((i) => pages[i].layout !== 'pleine')
  const first = idx.length ? pages[idx[0]] : null
  return {
    idx,
    pleine: full !== undefined,
    produit: full !== undefined ? (pages[full].product ?? null) : null,
    layout: other !== undefined ? pages[other].layout : null,
    template: (first?.template ?? 'A') as CatalogueTemplate,
    script: !!first?.script,
    header: (first?.header ?? 'titre') as CatalogueHeader,
  }
}

export interface CategorySettings {
  layout?: CatalogueLayout
  pleine?: boolean
  produit?: number | null
  template?: CatalogueTemplate
  script?: boolean
  header?: CatalogueHeader
}

/**
 * Refait les pages d'une catégorie : sa pleine page (au choix, avec son produit), puis assez de pages de la mise en page
 * choisie pour ses autres produits. Elles prennent la place des anciennes (une catégorie sans page : avant les catégories
 * qui la suivent, sinon avant les pages libres de la fin). Les pages libres font la place ; au-delà, le catalogue prend
 * 2 pages de plus (16 au plus), comme le Marketing quand une catégorie arrive. `free` : les pages libres d'avant.
 */
export function layoutCategory(
  input: { pages: api.CataloguePageRow[]; pageCount: number; cats: number[]; count: number; free: Set<api.CataloguePageRow> },
  c: number,
  wanted: CategorySettings,
): { pages: api.CataloguePageRow[]; pageCount: CataloguePageCount; grew: boolean } | { error: string } {
  const { pages: before, cats, count, free } = input
  const e = categoryState(before, c)
  const r = {
    layout: wanted.layout ?? (e.layout && MEP_LAYOUTS.includes(e.layout) ? e.layout : 'grille'),
    pleine: wanted.pleine ?? e.pleine,
    produit: wanted.produit !== undefined ? wanted.produit : e.produit,
    template: wanted.template ?? e.template,
    script: wanted.script ?? e.script,
    header: wanted.header ?? e.header,
  }
  // Les anciennes pages se reprennent (place libre, gamme…) : la pleine page pour la pleine page, les autres ensuite.
  const old = e.idx.map((i) => before[i])
  const taken = new Set<api.CataloguePageRow>()
  const reuse = (layout: CatalogueLayout): api.CataloguePageRow => {
    const found = old.find((p) => p.layout === layout && !taken.has(p)) ?? old.find((p) => !taken.has(p))
    if (found) taken.add(found)
    return found ? { ...found } : blankPage()
  }
  const fresh: api.CataloguePageRow[] = []
  if (r.pleine) {
    const page: api.CataloguePageRow = { ...reuse('pleine'), layout: 'pleine', category: c, template: r.template, script: r.script, header: r.header, filler: null, fillerMediaId: null }
    if (r.produit !== null) page.product = r.produit
    else delete page.product
    fresh.push(page)
  }
  const rest = Math.max(0, count - (r.pleine ? 1 : 0))
  const needed = rest ? Math.ceil(rest / LAYOUT_LABELS[r.layout].capacity) : r.pleine ? 0 : 1
  for (let j = 0; j < needed; j++) {
    const page: api.CataloguePageRow = { ...reuse(r.layout), layout: r.layout, category: c, template: r.template, script: r.script, header: r.header }
    delete page.product
    fresh.push(page)
  }
  const pages = before.filter((_, i) => !e.idx.includes(i))
  let at = e.idx.length ? e.idx[0] : -1
  if (at < 0) {
    const after = cats.slice(cats.indexOf(c) + 1)
    at = pages.findIndex((p) => !isPresentation(p.layout) && p.category !== null && after.includes(p.category))
    if (at < 0) {
      at = pages.length
      while (at > 0 && free.has(pages[at - 1])) at--
    }
  }
  pages.splice(at, 0, ...fresh)
  // La place : les pages restées libres (de la fin d'abord), puis 2 pages de plus.
  let nb = input.pageCount
  for (let t = pages.length - 1; t >= 0 && pages.length > nb - BRAND_PAGES; t--) if (free.has(pages[t])) pages.splice(t, 1)
  const max = PAGE_COUNTS[PAGE_COUNTS.length - 1]
  while (pages.length > nb - BRAND_PAGES && nb < max) nb += 2
  if (pages.length > nb - BRAND_PAGES) {
    return { error: `Plus de place : un catalogue a ${max} pages au plus. Choisissez une mise en page plus dense pour cette catégorie, ou moins de produits.` }
  }
  while (pages.length < nb - BRAND_PAGES) pages.push(blankPage())
  return { pages, pageCount: nb as CataloguePageCount, grew: nb > input.pageCount }
}

/** Les doubles pages d'un catalogue de n pages, comme imprimé et plié : [gauche, droite], null = rien de ce côté. */
export function spreads(n: number): Array<[number | null, number | null]> {
  const out: Array<[number | null, number | null]> = [[null, 0]]
  for (let i = 1; i < n - 1; i += 2) out.push([i, i + 1 < n ? i + 1 : null])
  if (n > 1 && n % 2 === 0) out.push([n - 1, null])
  return out
}
const spreadLabel = (s: [number | null, number | null], n: number): string =>
  s[0] === null ? 'Couverture' : s[1] === null ? (s[0] === n - 1 ? 'Dernière page' : `Page ${s[0] + 1}`) : `Pages ${s[0] + 1}-${s[1] + 1}`

// -------------------------------------------------------------------------------------------------
// Petites pièces
// -------------------------------------------------------------------------------------------------

/** Une page du document, à la largeur demandée (le rendu de l'impression, réduit). */
export function Thumb({ doc, index, width, className = '' }: { doc: CatalogueDocument; index: number; width: number; className?: string }) {
  const size = FORMAT_MM[doc.catalogue.format]
  const zoom = width / (size.w * MM)
  return (
    <span className={`wz-thumb ${className}`} style={{ width, height: size.h * MM * zoom }}>
      <span style={{ zoom }}>
        <CatalogueSheet doc={doc} index={index} mode="preview" />
      </span>
    </span>
  )
}

export function Seg<T extends string | number | boolean>({ value, options, onChange, disabled = false, label }: { value: T | null; options: Array<[T, string]>; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <span className="wz-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" className={value === v ? 'is-on' : ''} disabled={disabled} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </span>
  )
}

export function Nav({ back, next, middle }: { back?: ReactNode; next?: ReactNode; middle?: ReactNode }) {
  return (
    <div className="wz-foot">
      {back}
      <span className="wz-grow" />
      {middle}
      {next}
    </div>
  )
}

// -------------------------------------------------------------------------------------------------
// L'assistant
// -------------------------------------------------------------------------------------------------

export interface WizardProps {
  step: WizardStep
  setStep: (step: WizardStep) => void
  cat: Catalogue
  doc: CatalogueDocument | null
  docError: string | null
  lang: CatalogueLang
  setLang: (lang: CatalogueLang) => void
  versionShop: number | null
  setVersionShop: (shop: number | null) => void
  versionShops: number[]
  shops: api.Shop[]
  shopName: (id: number) => string
  products: api.WebshopProduct[]
  byId: Map<number, api.WebshopProduct>
  categories: Map<number, api.WebshopCategory>
  webshopLoading: boolean
  busy: boolean
  change: (patch: api.CatalogueUpdate) => void
  onBrandPage: (docIndex: number) => void
  onCommonBrandPages: () => void
  print: (mode: CatalogueSheetMode, all: boolean) => void
  openDetail: (innerIndex: number | null) => void
  productsPanel: ReactNode
  offersPanel: ReactNode
  onDelete: () => void
}

export default function CatalogueWizard(props: WizardProps) {
  const { step, setStep, doc } = props
  return (
    <div className="wz">
      <style>{catalogueCss()}</style>
      <nav className="wz-steps" aria-label="Les étapes du catalogue">
        {STEPS.map((s) => (
          <button key={s.n} type="button" className={`wz-step${s.n === step ? ' is-on' : s.n < step ? ' is-done' : ''}`} onClick={() => setStep(s.n)} aria-current={s.n === step ? 'step' : undefined}>
            <span className="wz-step__no">{s.n < step ? '✓' : s.n}</span>
            <span className="wz-step__txt">
              <b>{s.label}</b>
              <i>{s.hint}</i>
            </span>
          </button>
        ))}
      </nav>
      {props.docError ? <p className="error">{props.docError}</p> : null}
      {step === 1 ? <StepCatalogue {...props} /> : null}
      {step === 2 ? <StepProducts {...props} /> : null}
      {step === 3 ? (props.cat.gammeBlocks != null ? <StepGammesHost {...props} /> : <StepPresentation {...props} />) : null}
      {step === 4 ? <StepValidation {...props} /> : null}
      {step === 5 ? <StepFlipbook {...props} /> : null}
      {!doc && step !== 2 ? <p className="muted">Composition du catalogue…</p> : null}
    </div>
  )
}

// --- 1 · Catalogue ---------------------------------------------------------------------------------

function StepCatalogue(p: WizardProps) {
  const { cat, doc, change, busy } = p
  const n = doc?.pages.length ?? 0
  const brand: Array<[number, string, string]> = doc ? [[0, 'Couverture', 'page 1'], [1, 'Page 2', 'le mot de la boulangerie'], [n - 2, 'Avant-dernière', `page ${n - 1}`], [n - 1, 'Dernière page', `page ${n}`]] : []
  const own = new Set(cat.brandPagesOwn ?? [])
  const slotOf = ['cover', 'page2', 'penultimate', 'back'] as const
  return (
    <div className="wz-body wz-body--2">
      <section className="wz-pan">
        <div className="wz-kick">Étape 1 · Catalogue</div>
        <h2 className="wz-title">{cat.title}</h2>
        <div className="wz-rows">
          <div className="wz-row">
            <span>Format</span>
            <Seg label="Format" value={cat.format} options={[['A5', 'A5'], ['A4', 'A4']]} disabled={busy} onChange={(format) => change({ format })} />
            <small>A5 : le livret plié ; A4 : la grande page.</small>
          </div>
          <div className="wz-row">
            <span>Pages</span>
            <Seg label="Pages" value={cat.pageCount} options={PAGE_COUNTS.map((x) => [x, String(x)])} disabled={busy} onChange={(pageCount) => change({ pageCount })} />
            <small>Toujours par 2, dont 4 de la marque : {cat.pageCount - BRAND_PAGES} pages de produits.</small>
          </div>
          <div className="wz-row">
            <span>Langues</span>
            <Seg
              label="Langues"
              value={cat.langs.includes('nl') ? (cat.langs.includes('fr') ? 'fr,nl' : 'nl') : 'fr'}
              options={[['fr', 'FR'], ['nl', 'NL'], ['fr,nl', 'FR + NL']]}
              disabled={busy}
              onChange={(v) => {
                const langs = v.split(',') as CatalogueLang[]
                change({ langs })
                if (!langs.includes(p.lang)) p.setLang(langs[0])
              }}
            />
            <small>Une version par langue ; sans texte néerlandais, le français s’imprime.</small>
          </div>
        </div>
        {cat.owner === 'marque' ? (
          <>
            <div className="wz-sub">Boutiques · une version chacune, à ses prix, avec son adresse et son QR</div>
            <div className="wz-shops">
              {p.shops.map((shop) => (
                <label key={shop.id} className={`wz-shop${cat.shopIds.includes(shop.id) ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={cat.shopIds.includes(shop.id)}
                    onChange={(event) => {
                      const next = event.target.checked ? [...cat.shopIds, shop.id] : cat.shopIds.filter((s) => s !== shop.id)
                      if (!event.target.checked && p.versionShop === shop.id) p.setVersionShop(null)
                      change({ shopIds: next })
                    }}
                  />
                  {shop.name}
                </label>
              ))}
            </div>
          </>
        ) : (
          <p className="wz-note">Catalogue de {cat.shop?.name ?? 'la boutique'} : ses prix, son adresse, son QR.</p>
        )}
        <Nav
          back={
            <button type="button" className="btn btn--danger btn--sm" onClick={p.onDelete}>
              Supprimer le catalogue
            </button>
          }
          next={
            <button type="button" className="btn btn--primary" onClick={() => p.setStep(2)}>
              Produits ›
            </button>
          }
        />
      </section>
      <aside className="wz-pan wz-brand">
        <div className="wz-kick">Les 4 pages de la marque</div>
        <p className="wz-note">{cat.owner === 'marque' ? 'Un clic ouvre la page pour ce catalogue seulement.' : 'Réglées pour tous les catalogues : les franchisés ne les changent pas.'}</p>
        <div className="wz-brand__grid">
          {doc
            ? brand.map(([i, label, hint], k) => (
                <button key={label} type="button" className="wz-brand__page" onClick={() => p.onBrandPage(i)} title={`${label} — ✎ modifier`}>
                  <Thumb doc={doc} index={i} width={118} />
                  <b>{label}</b>
                  <i>
                    {hint}
                    {own.has(slotOf[k]) ? ' · à lui' : ''}
                  </i>
                </button>
              ))
            : null}
        </div>
        {cat.owner === 'marque' ? (
          <button type="button" className="linklike" onClick={p.onCommonBrandPages}>
            Pages communes à tous les catalogues
          </button>
        ) : null}
      </aside>
    </div>
  )
}

// --- 2 · Produits ----------------------------------------------------------------------------------

function StepProducts(p: WizardProps) {
  const checked = p.cat.products.filter((row) => row.on).length
  return (
    <div className="wz-body wz-body--2">
      <div className="wz-col">
        <div className="wz-lead">
          <div className="wz-kick">Étape 2 · Produits</div>
          <p>
            Les produits du webshop, par catégorie : chaque catégorie cochée a ses pages ; les produits seuls vont en « Notre sélection ».{' '}
            <b>{checked} produit{checked > 1 ? 's' : ''} choisi{checked > 1 ? 's' : ''}.</b>
          </p>
        </div>
        {p.productsPanel}
      </div>
      <div className="wz-col">
        {p.offersPanel}
        <Nav
          back={
            <button type="button" className="btn" onClick={() => p.setStep(1)}>
              ‹ Catalogue
            </button>
          }
          next={
            <button type="button" className="btn btn--primary" onClick={() => p.setStep(3)}>
              Présentation ›
            </button>
          }
        />
      </div>
    </div>
  )
}

// --- 3 · Gamme par gamme (27/11/2026, maquettes M1 · M2 · M3) -------------------------------------------

function StepGammesHost(p: WizardProps) {
  const [zoomPage, setZoomPage] = useState<number | null>(null)
  return (
    <>
      <StepGammes
        cat={p.cat}
        doc={p.doc}
        lang={p.lang}
        busy={p.busy}
        products={p.products}
        byId={p.byId}
        categories={p.categories}
        change={p.change}
        setStep={p.setStep}
        openDetail={p.openDetail}
        onZoom={setZoomPage}
      />
      {zoomPage !== null && p.doc ? <Zoom doc={p.doc} index={zoomPage} onClose={() => setZoomPage(null)} onIndex={setZoomPage} /> : null}
    </>
  )
}

/**
 * Un catalogue d'avant les gammes (pages rangées catégorie par catégorie) : on lui propose de passer gamme par gamme,
 * avec ses gammes d'aujourd'hui (ses présentations, sinon sa source) ; un catalogue imprimé reste tel quel.
 */
function ToGammes(p: WizardProps) {
  const start = initialBlocks(p.cat)
  if (p.cat.status === 'imprime') return null
  return (
    <div className="wz-pan gp-convert">
      <div>
        <b>Construire ce catalogue gamme par gamme</b>
        <small>
          Les produits hors gamme d’abord, puis chaque gamme : sa page de présentation à gauche, ses catégories en face.
          {start.length ? ` Gammes reprises : ${start.length}.` : ' Vous ajoutez ensuite les gammes une à une.'} Les pages se refont dans ce nouvel ordre.
        </small>
      </div>
      <button type="button" className="btn" disabled={p.busy} onClick={() => p.change({ gammeBlocks: start })}>
        Passer gamme par gamme
      </button>
    </div>
  )
}

// --- 3 · Présentation (catalogue d'avant les gammes) ----------------------------------------------------

function StepPresentation(p: WizardProps) {
  const { cat, doc, byId, categories, lang, change, busy } = p
  const pages = cat.pages
  const docPages = doc?.pages ?? []
  const [sub, setSub] = useState(0)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [drag, setDrag] = useState<{ from: number; n: number } | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [zoomPage, setZoomPage] = useState<number | null>(null)

  const checkedIds = new Set(cat.products.filter((row) => row.on).map((row) => row.id))
  /** Les catégories de l'assistant : celles des produits choisis, dans l'ordre de leurs pages, puis les autres. */
  const cats = useMemo(() => {
    const withProducts: number[] = []
    for (const row of cat.products) {
      const c = row.on ? byId.get(row.id)?.categoryId : null
      if (c !== null && c !== undefined && !withProducts.includes(c)) withProducts.push(c)
    }
    const firstPage = (c: number) => {
      const i = pages.findIndex((pg) => !isPresentation(pg.layout) && pg.category === c)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    }
    return [...withProducts].sort((a, b) => firstPage(a) - firstPage(b) || withProducts.indexOf(a) - withProducts.indexOf(b))
  }, [cat.products, pages, byId])
  const catName = (c: number | null): string => {
    if (c === null) return 'Notre sélection'
    const found = categories.get(c)
    return found ? (lang === 'nl' ? found.nameNl || found.name : found.name) : `Catégorie ${c}`
  }
  const colorOf = (c: number | null) => {
    const i = c === null ? -1 : cats.indexOf(c)
    return i >= 0 && i < MEP_COLORS.length ? MEP_COLORS[i] : OTHER_COLOR
  }
  const countOf = (c: number, ids = checkedIds) => [...ids].filter((id) => byId.get(id)?.categoryId === c).length
  /** Les produits qu'une page porte, dans le document composé (les vignettes d'offres n'en sont pas). */
  const carried = (i: number): number => {
    const page = docPages[i + 2]
    return page && (page.kind === 'products' || page.kind === 'presentation') ? page.products.filter((item) => item.kind !== 'offer').length : 0
  }
  const isFree = (i: number): boolean => {
    const page = pages[i]
    return !isPresentation(page.layout) && carried(i) === 0 && (page.category === null || !cats.includes(page.category))
  }
  const freeSet = new Set(pages.filter((_, i) => isFree(i)))
  const final = sub >= cats.length

  function apply(c: number, wanted: CategorySettings, products?: api.CatalogueProductRow[]) {
    const ids = products ? new Set(products.filter((r) => r.on).map((r) => r.id)) : checkedIds
    const result = layoutCategory({ pages, pageCount: cat.pageCount, cats, count: countOf(c, ids), free: freeSet }, c, wanted)
    if ('error' in result) {
      setNotice({ kind: 'error', text: `« ${catName(c)} » : ${result.error}` })
      return
    }
    setNotice(result.grew ? { kind: 'info', text: `« ${catName(c)} » demande plus de place : le catalogue passe à ${result.pageCount} pages (toujours par 2).` } : null)
    change({ ...(products ? { products } : {}), pages: result.pages, ...(result.pageCount !== cat.pageCount ? { pageCount: result.pageCount } : {}) })
  }
  /** Montrer ou cacher un produit : son choix change, et les pages de sa catégorie se refont. */
  function toggleProduct(c: number, id: number, on: boolean) {
    const next = cat.products.map((row) => (row.id === id ? { ...row, on } : row))
    if (!next.some((row) => row.id === id)) next.push({ id, on })
    const state = categoryState(pages, c)
    apply(c, !on && state.produit === id ? { produit: null } : {}, next)
  }

  // --- la mise en page finale : les blocs ---
  type Block = { key: string; from: number; n: number; page: api.CataloguePageRow; free: boolean }
  const blocks: Block[] = []
  pages.forEach((page, i) => {
    const free = isFree(i)
    const key = isPresentation(page.layout) ? `g${i}` : free ? 'libre' : page.category === null ? 'sel' : `c${page.category}`
    const last = blocks[blocks.length - 1]
    if (last && last.key === key && !isPresentation(page.layout)) last.n++
    else blocks.push({ key, from: i, n: 1, page, free })
  })
  const blockName = (b: Block): string =>
    b.free ? (b.n > 1 ? 'Pages libres' : 'Page libre')
    : isPresentation(b.page.layout) ? `Présentation · ${doc?.pages[b.from + 2]?.kind === 'presentation' ? (doc.pages[b.from + 2] as { title: string }).title : 'gamme'}`
    : catName(b.page.category)
  function moveBlock(from: number, n: number, to: number) {
    if (to >= from && to <= from + n) return
    const moving = pages.slice(from, from + n)
    const rest = [...pages.slice(0, from), ...pages.slice(from + n)]
    rest.splice(to > from ? to - n : to, 0, ...moving)
    change({ pages: rest })
  }
  function nudge(b: Block, dir: -1 | 1) {
    const k = blocks.findIndex((x) => x.from === b.from)
    const other = blocks[k + dir]
    if (!other) return
    moveBlock(b.from, b.n, dir < 0 ? other.from : other.from + other.n)
  }
  function setCount(nb: CataloguePageCount) {
    const next = [...pages]
    for (let t = next.length - 1; t >= 0 && next.length > nb - BRAND_PAGES; t--) if (freeSet.has(next[t])) next.splice(t, 1)
    if (next.length > nb - BRAND_PAGES) {
      setNotice({ kind: 'error', text: `À ${nb} pages, des produits n’auraient plus de place : retirez des produits à l’étape 2, ou choisissez des mises en page plus denses.` })
      return
    }
    while (next.length < nb - BRAND_PAGES) next.push(blankPage())
    setNotice(null)
    change({ pageCount: nb, pages: next })
  }

  const inner = cat.pageCount - BRAND_PAGES
  const used = pages.filter((_, i) => !isFree(i)).length
  const others = pages.filter((pg, i) => !isFree(i) && (isPresentation(pg.layout) || pg.category === null || !cats.includes(pg.category))).length
  const range = (idx: number[]) => (idx.length ? `p. ${idx[0] + 3}${idx.length > 1 ? `-${idx[idx.length - 1] + 3}` : ''}` : 'pas de page')

  const subBar = (
    <div className="wz-subs" style={{ gridTemplateColumns: `repeat(${Math.min(cats.length + 1, 6)}, minmax(0, 1fr))` }}>
      {[...cats.map((c, i) => ({ i, label: catName(c), hint: `${countOf(c)} produit${countOf(c) > 1 ? 's' : ''}` })), { i: cats.length, label: 'Mise en page finale', hint: 'l’ordre, en glisser-déposer' }].map((x) => (
        <button key={x.i} type="button" className={`wz-sub-step${x.i === sub ? ' is-on' : x.i < sub ? ' is-done' : ''}${x.i === cats.length ? ' is-final' : ''}`} onClick={() => { setSub(x.i); setNotice(null) }}>
          <span className="wz-sub-step__no">{x.i < sub ? '✓' : x.i === cats.length ? '⠿' : x.i + 1}</span>
          <span className="wz-sub-step__txt">
            <b>{x.label}</b>
            <i>{x.hint}</i>
          </span>
        </button>
      ))}
    </div>
  )

  const side = (
    <aside className="wz-pan wz-gauge">
      <div className="wz-kick">
        Le catalogue · {cat.pageCount} pages {cat.format}
      </div>
      <b>
        {used} page{used > 1 ? 's' : ''} de produits sur {inner}
      </b>
      <div className="wz-gauge__bar">
        {cats.map((c) => (
          <i key={c} style={{ width: `${(100 * categoryPages(pages, c).length) / inner}%`, background: colorOf(c) }} />
        ))}
        {others ? <i style={{ width: `${(100 * others) / inner}%`, background: OTHER_COLOR }} /> : null}
      </div>
      <div className="wz-gauge__legend">
        {cats.map((c, k) => {
          const idx = categoryPages(pages, c)
          return (
            <button key={c} type="button" onClick={() => setSub(k)}>
              <i className="wz-dot" style={{ background: colorOf(c) }} />
              <span>{catName(c)}</span>
              <span className="wz-n">{final ? range(idx) : idx.length ? `${idx.length} page${idx.length > 1 ? 's' : ''}${k < sub ? ' ✓' : ''}` : 'pas de page'}</span>
            </button>
          )
        })}
        {others ? (
          <div>
            <i className="wz-dot" style={{ background: OTHER_COLOR }} />
            <span>Présentations, Notre sélection</span>
            <span className="wz-n">{others}</span>
          </div>
        ) : null}
        {inner - used > 0 ? (
          <div>
            <i className="wz-dot" style={{ background: '#D9D2C7' }} />
            <span>Pages libres</span>
            <span className="wz-n">{inner - used}</span>
          </div>
        ) : null}
      </div>
      <p className="wz-note">
        {final ? 'L’ordre des pages est celui de l’impression : la page 3 suit la page 2 de la marque.' : 'Une étape par catégorie choisie.'} Les 4 pages de la marque ne bougent pas.
      </p>
    </aside>
  )

  // --- une catégorie ---
  function categoryView(c: number) {
    const e = categoryState(pages, c)
    const n = countOf(c)
    const rest = Math.max(0, n - (e.pleine ? 1 : 0))
    const list = p.products.filter((x) => x.categoryId === c)
    const shown = list.filter((x) => checkedIds.has(x.id))
    const fullDoc = e.idx.find((i) => pages[i].layout === 'pleine')
    const fullPage = fullDoc !== undefined ? docPages[fullDoc + 2] : undefined
    const fullItem = fullPage && fullPage.kind === 'products' ? fullPage.products.find((item) => !api.isDocOffer(item)) : undefined
    const fullName = fullItem && !api.isDocOffer(fullItem) ? fullItem.name : null
    const prev = sub === 0 ? (
      <button type="button" className="btn" onClick={() => p.setStep(2)}>
        ‹ Produits
      </button>
    ) : (
      <button type="button" className="btn" onClick={() => setSub(sub - 1)}>
        ‹ {catName(cats[sub - 1])}
      </button>
    )
    return (
      <div className="wz-body wz-body--side">
        <section className="wz-pan">
          <div className="wz-kick">
            Étape 3 · Présentation — catégorie {sub + 1} sur {cats.length}
          </div>
          <div className="wz-cattitle">
            <h2>{catName(c)}</h2>
            <span>
              {n} produit{n > 1 ? 's' : ''} choisi{n > 1 ? 's' : ''}
            </span>
          </div>
          <div className={`wz-opt${e.pleine ? ' is-on' : ''}`}>
            <div className="wz-opt__t">
              <span>
                <i className="wz-dot" style={{ background: 'var(--wz-p)' }} />
                Un produit seul sur une page, avec sa promotion
              </span>
              <span className="wz-grow" />
              <Seg label="Pleine page" value={e.pleine} options={[[false, 'Non'], [true, 'Oui']]} disabled={busy || n === 0} onChange={(v) => apply(c, { pleine: v })} />
            </div>
            {e.pleine ? (
              <>
                <select className="wz-select" value={e.produit ?? ''} disabled={busy} onChange={(event) => apply(c, { produit: event.target.value ? Number(event.target.value) : null })} aria-label="Le produit de la pleine page">
                  <option value="">Le premier de la catégorie</option>
                  {shown.map((x) => (
                    <option key={x.id} value={x.id}>
                      {lang === 'nl' ? x.nameNl || x.name : x.name}
                    </option>
                  ))}
                </select>
                <small>{fullName ? `« ${fullName} » seul sur sa page, son poids, ses allergènes, son prix (barré par sa remise) et l’offre qui le contient.` : 'Le produit en grand, avec sa promotion quand il en a une.'}</small>
              </>
            ) : (
              <small>Une page de plus, avant les autres : le produit en grand, son poids, ses allergènes, son prix barré par sa remise et l’offre qui le contient.</small>
            )}
          </div>
          {!e.pleine || rest > 0 ? (
            <>
              <div className="wz-q">{e.pleine ? (rest > 1 ? `Et les ${rest} autres ?` : 'Et l’autre ?') : `Comment présenter ${n > 1 ? `ces ${n} produits` : 'ce produit'} ?`}</div>
              <div className="wz-lays">
                {MEP_LAYOUTS.map((layout) => {
                  const nb = Math.max(1, Math.ceil(rest / LAYOUT_LABELS[layout].capacity))
                  return (
                    <button key={layout} type="button" className={`wz-lay${e.layout === layout ? ' is-on' : ''}${nb > 2 ? ' is-much' : ''}`} disabled={busy} onClick={() => apply(c, { layout })}>
                      <LayoutIcon layout={layout} />
                      <b>{DISPOS[layout][0]}</b>
                      <small>{DISPOS[layout][1]}</small>
                      <em>
                        {nb} page{nb > 1 ? 's' : ''}
                        {nb > 2 ? ' · plus de 2' : ''}
                      </em>
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}
          <div className="wz-aps">
            {e.idx.length && doc ? (
              e.idx.map((i) => (
                <button key={i} type="button" className="wz-ap" onClick={() => setZoomPage(i + 2)} title="Ouvrir en grand">
                  <Thumb doc={doc} index={i + 2} width={e.idx.length > 2 ? 160 : 210} />
                  <span>
                    page <b>{i + 3}</b> · {pages[i].layout === 'pleine' ? 'pleine page' : `${carried(i)} produit${carried(i) > 1 ? 's' : ''}`}
                  </span>
                </button>
              ))
            ) : (
              <div className="wz-none">Pas encore de page pour cette catégorie : choisissez une mise en page.</div>
            )}
          </div>
          <div className="wz-opts">
            <div className="wz-opt">
              <div className="wz-opt__t">Gabarit</div>
              <div className="wz-tiles">
                {(['A', 'B', 'C'] as CatalogueTemplate[]).map((t) => (
                  <button key={t} type="button" className={`wz-tile${e.template === t ? ' is-on' : ''}`} disabled={!e.idx.length || busy} onClick={() => apply(c, { template: t })} title={TEMPLATE_LABELS.products[t].hint}>
                    <TemplateIcon family="products" template={t} />
                    <span>
                      {t} · {TEMPLATE_LABELS.products[t].label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="wz-opt">
              <div className="wz-opt__t">Titre et illustration</div>
              <div className="wz-tiles">
                {api.CATALOGUE_HEADERS.map((h) => (
                  <button key={h} type="button" className={`wz-tile${e.header === h ? ' is-on' : ''}`} disabled={!e.idx.length || busy} onClick={() => apply(c, { header: h })} title={HEADER_LABELS[h].hint}>
                    <HeaderIcon header={h} />
                    <span>{HEADER_LABELS[h].label}</span>
                  </button>
                ))}
              </div>
              <div className="wz-opt__t">
                Catégorie en lettres manuscrites
                <span className="wz-grow" />
                <Seg label="Manuscrite" value={e.script} options={[[false, 'Non'], [true, 'Oui']]} disabled={!e.idx.length || busy} onChange={(v) => apply(c, { script: v })} />
              </div>
            </div>
          </div>
          {notice ? <p className={notice.kind === 'error' ? 'error' : 'wz-info'}>{notice.text}</p> : null}
          <Nav
            back={prev}
            middle={
              <span className="wz-count">
                {e.idx.length} page{e.idx.length > 1 ? 's' : ''} · {used} pages de produits sur {inner}
                {inner - used ? ` · ${inner - used} libre${inner - used > 1 ? 's' : ''}` : ''}
              </span>
            }
            next={
              <button type="button" className="btn btn--primary" onClick={() => { setSub(sub + 1); setNotice(null) }}>
                {sub < cats.length - 1 ? catName(cats[sub + 1]) : 'Mise en page finale'} ›
              </button>
            }
          />
        </section>
        <div className="wz-col">
          {side}
          <section className="wz-pan wz-prods">
            <div className="wz-kick">Produits · {catName(c)}</div>
            <small>
              {shown.length} montré{shown.length > 1 ? 's' : ''} sur {list.length}
            </small>
            <table className="wz-table">
              <tbody>
                {list.map((x) => {
                  const on = checkedIds.has(x.id)
                  const last = on && shown.length === 1
                  return (
                    <tr key={x.id} className={on ? '' : 'is-off'}>
                      <td className="wz-table__ph">{x.imageUrl ? <img src={x.imageUrl} alt="" loading="lazy" /> : null}</td>
                      <td>{lang === 'nl' ? x.nameNl || x.name : x.name}</td>
                      <td className="wz-table__px">{formatCents(x.priceCents, lang)}</td>
                      <td>
                        <button
                          type="button"
                          className={`catv-sw${on ? ' is-on' : ''}`}
                          role="switch"
                          aria-checked={on}
                          aria-label={`${on ? 'Cacher' : 'Montrer'} ${x.name}`}
                          disabled={last || busy}
                          title={last ? 'Le dernier produit montré : pour retirer la catégorie, décochez-la à l’étape 2' : on ? 'Ne plus le montrer dans le catalogue' : 'Le montrer dans le catalogue'}
                          onClick={() => toggleProduct(c, x.id, !on)}
                        >
                          <span className="catv-sw__track" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    )
  }

  // --- la mise en page finale ---
  function finalView() {
    const n = docPages.length
    const brandThumb = (j: number, no: number) => (
      <div className="wz-th">
        {doc && doc.pages[j] ? <Thumb doc={doc} index={j} width={92} /> : <span className="wz-th__blank" />}
        <span>{no}</span>
      </div>
    )
    const sansPage = cats.filter((c) => !categoryPages(pages, c).length)
    return (
      <div className="wz-body wz-body--side">
        <section className="wz-pan">
          <div className="wz-kick">Étape 3 · Présentation — la mise en page finale</div>
          <div className="wz-cattitle">
            <h2>{cat.title}</h2>
            <span>
              {cat.pageCount} pages {cat.format} · glissez une catégorie pour changer l’ordre, ses pages la suivent
            </span>
          </div>
          <div className="wz-blocks">
            <div className="wz-block is-locked">
              <div className="wz-block__h">🔒 Marque</div>
              <div className="wz-block__pp">
                {brandThumb(0, 1)}
                {brandThumb(1, 2)}
              </div>
            </div>
            {blocks.map((b, k) => {
              const color = b.key.startsWith('c') ? colorOf(b.page.category) : null
              return (
                <div
                  key={`${b.key}-${b.from}`}
                  className={`wz-block${b.free ? ' is-free' : ''}${drag && drag.from === b.from ? ' is-dragging' : ''}${over === b.from ? ' is-over' : ''}`}
                  onDragOver={(event: ReactDragEvent) => {
                    if (!drag) return
                    event.preventDefault()
                    setOver(b.from)
                  }}
                  onDragLeave={() => setOver((o) => (o === b.from ? null : o))}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (drag) {
                      // Déposé sur un bloc : avant lui s'il est avant, après lui s'il est après.
                      const to = b.from > drag.from ? b.from + b.n : b.from
                      moveBlock(drag.from, drag.n, to)
                    }
                    setDrag(null)
                    setOver(null)
                  }}
                >
                  <div className="wz-block__h">
                    <span
                      className="wz-grip"
                      draggable
                      onDragStart={(event: ReactDragEvent) => {
                        setDrag({ from: b.from, n: b.n })
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', String(b.from))
                      }}
                      onDragEnd={() => {
                        setDrag(null)
                        setOver(null)
                      }}
                      title="Glisser pour déplacer"
                      aria-label={`Déplacer « ${blockName(b)} »`}
                    >
                      ⠿
                    </span>
                    {color ? <i className="wz-dot" style={{ background: color }} /> : null}
                    <span className="wz-block__nm">{blockName(b)}</span>
                    <span className="wz-block__pg">
                      p. {b.from + 3}
                      {b.n > 1 ? `-${b.from + b.n + 2}` : ''}
                    </span>
                    <button type="button" className="wz-mv" disabled={k === 0 || busy} onClick={() => nudge(b, -1)} aria-label="Avant">
                      ‹
                    </button>
                    <button type="button" className="wz-mv" disabled={k === blocks.length - 1 || busy} onClick={() => nudge(b, 1)} aria-label="Après">
                      ›
                    </button>
                  </div>
                  <div className="wz-block__pp">
                    {Array.from({ length: b.n }, (_, j) => b.from + j).map((i) => (
                      <button key={i} type="button" className="wz-th" onClick={() => setZoomPage(i + 2)} onDoubleClick={() => p.openDetail(i)} title="Un clic : en grand · double-clic : ses réglages">
                        {doc && !(b.free && !pages[i].filler) ? <Thumb doc={doc} index={i + 2} width={92} /> : <span className="wz-th__blank">Photo ou illustration · ou −2 pages</span>}
                        <span>{i + 3}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            <div className="wz-block is-locked">
              <div className="wz-block__h">🔒 Marque</div>
              <div className="wz-block__pp">
                {brandThumb(n - 2, cat.pageCount - 1)}
                {brandThumb(n - 1, cat.pageCount)}
              </div>
            </div>
          </div>
          <p className="wz-note">⠿ prendre une catégorie : ses pages suivent ensemble (‹ › sans souris) · un clic sur une page l’ouvre en grand, un double-clic ouvre ses réglages · les pages de la marque ne bougent pas.</p>
          {sansPage.length ? (
            <p className="wz-info">
              {sansPage.map((c) => `« ${catName(c)} »`).join(', ')} {sansPage.length > 1 ? 'n’ont' : 'n’a'} pas de page : {sansPage.length > 1 ? 'leurs' : 'ses'} produits vont en « Notre sélection » s’il y en a une.
            </p>
          ) : null}
          <div className="wz-opts">
            <div className="wz-opt">
              <div className="wz-opt__t">
                Nombre de pages
                <span className="wz-grow" />
                <span className="wz-seg">
                  {PAGE_COUNTS.map((x) => (
                    <button key={x} type="button" className={x === cat.pageCount ? 'is-on' : ''} disabled={x - BRAND_PAGES < used || busy} onClick={() => setCount(x)}>
                      {x}
                    </button>
                  ))}
                </span>
              </div>
              <small>
                Toujours par 2, dont 4 de la marque.{' '}
                {inner - used > 1 ? `À ${cat.pageCount - 2} pages, 2 pages libres partent.` : used === inner ? 'Toutes les pages de produits sont prises.' : '1 page libre : une photo ou l’illustration de la gamme la prend.'}
              </small>
            </div>
            <div className="wz-opt">
              <div className="wz-opt__t">
                Répartition
                <span className="wz-grow" />
                <button type="button" className="btn btn--sm" disabled={busy} onClick={() => change({ pages: [] })} title={`Une catégorie après l’autre, sur les ${inner} pages de produits`}>
                  ↺ Répartir automatiquement
                </button>
              </div>
              <small>Refait toutes les pages : une catégorie après l’autre, dans l’ordre des produits.</small>
            </div>
          </div>
          {notice ? <p className={notice.kind === 'error' ? 'error' : 'wz-info'}>{notice.text}</p> : null}
          <Nav
            back={
              cats.length ? (
                <button type="button" className="btn" onClick={() => setSub(cats.length - 1)}>
                  ‹ {catName(cats[cats.length - 1])}
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => p.setStep(2)}>
                  ‹ Produits
                </button>
              )
            }
            middle={
              <button type="button" className="btn" onClick={() => p.openDetail(null)}>
                Réglages page par page
              </button>
            }
            next={
              <button type="button" className="btn btn--primary" onClick={() => p.setStep(4)}>
                Validation ›
              </button>
            }
          />
        </section>
        <div className="wz-col">{side}</div>
      </div>
    )
  }

  return (
    <>
      <ToGammes {...p} />
      {subBar}
      {cats.length === 0 && !final ? null : final ? finalView() : categoryView(cats[sub])}
      {cats.length === 0 ? (
        <p className="wz-info">Aucune catégorie choisie : cochez des produits à l’étape 2, ou réglez les pages une à une (« Réglages page par page »).</p>
      ) : null}
      {zoomPage !== null && doc ? <Zoom doc={doc} index={zoomPage} onClose={() => setZoomPage(null)} onIndex={setZoomPage} /> : null}
    </>
  )
}

/** Une page en grand, par-dessus l'écran ; ‹ › pour passer à la voisine, Échap pour fermer. */
function Zoom({ doc, index, onClose, onIndex }: { doc: CatalogueDocument; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const n = doc.pages.length
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && index < n - 1) onIndex(index + 1)
      if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [index, n, onClose, onIndex])
  const size = FORMAT_MM[doc.catalogue.format]
  const width = Math.min(560, Math.floor(((window.innerHeight - 140) * size.w) / size.h))
  return (
    <div className="wz-zoom" role="dialog" aria-label={`Page ${index + 1}`} onClick={onClose}>
      <div className="wz-zoom__in" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="wz-fb__nav" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Page précédente">
          ‹
        </button>
        <Thumb doc={doc} index={index} width={width} />
        <button type="button" className="wz-fb__nav" disabled={index === n - 1} onClick={() => onIndex(index + 1)} aria-label="Page suivante">
          ›
        </button>
        <div className="wz-zoom__bar">
          <span>
            Page {index + 1} sur {n}
          </span>
          <button type="button" className="btn btn--sm" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}

// --- 4 · Validation --------------------------------------------------------------------------------

/** Ce que dit chaque avertissement de la composition, et où le régler. */
const WARNING_HELP: Record<string, { title: string; go?: { label: string; step: WizardStep; detail?: boolean } | 'brand' | 'back' }> = {
  PAGES_EMPTY: { title: 'Des pages sans produit', go: { label: 'Mise en page finale', step: 3 } },
  PAGES_OVER_FORMAT: { title: 'Plus de pages que le format', go: { label: 'Mise en page finale', step: 3 } },
  PRODUCTS_OVERFLOW: { title: 'Des produits sans place', go: { label: 'Mise en page finale', step: 3 } },
  CATEGORY_NO_PAGE: { title: 'Une catégorie sans page', go: { label: 'Présentation', step: 3 } },
  PAGE_PRODUCT_MISSING: { title: 'Le produit d’une pleine page manque', go: { label: 'Réglages page par page', step: 3, detail: true } },
  FILLER_MEDIA_MISSING: { title: 'La photo d’une place libre manque', go: { label: 'Réglages page par page', step: 3, detail: true } },
  FILLER_NO_ILLUSTRATION: { title: 'Pas d’illustration pour une place libre', go: { label: 'Réglages page par page', step: 3, detail: true } },
  GAMME_NO_ILLUSTRATION: { title: 'Une gamme sans illustration', go: { label: 'Réglages page par page', step: 3, detail: true } },
  GAMME_UNKNOWN: { title: 'Une gamme inconnue du webshop', go: { label: 'Réglages page par page', step: 3, detail: true } },
  NL_TEXT_MISSING: { title: 'Texte néerlandais à écrire', go: 'brand' },
  OFFER_MEDIA_MISSING: { title: 'L’image d’une promotion manque', go: { label: 'Promotions', step: 2 } },
  PROMOTIONS_UNREADABLE: { title: 'Promotions illisibles', go: { label: 'Promotions', step: 2 } },
  PRICE_DIFFERS: { title: 'Prix différents selon la boutique', go: { label: 'Produits', step: 2 } },
  PRODUCT_NO_PRICE: { title: 'Un produit sans prix', go: { label: 'Produits', step: 2 } },
  PRODUCT_NOT_SOLD: { title: 'Un produit absent d’un webshop', go: { label: 'Produits', step: 2 } },
  PRODUCT_NO_WEIGHT: { title: 'Des produits sans poids (ERP)' },
  WEBSHOP_UNREADABLE: { title: 'Webshop illisible' },
  SHOP_ADDRESS_MISSING: { title: 'Adresse de la boutique inconnue', go: 'back' },
  WEBSHOP_URL_UNKNOWN: { title: 'Adresse du webshop inconnue : pas de QR', go: 'back' },
  BUSINESS_URL_MISSING: { title: 'Lien de commande entreprise non saisi', go: 'back' },
}

function seenKey(id: number) {
  return `catv-vus-${id}`
}

function StepValidation(p: WizardProps) {
  const { cat, doc } = p
  const [seen, setSeen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(seenKey(cat.id)) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const markSeen = (key: string, on: boolean) => {
    setSeen((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      try {
        window.localStorage.setItem(seenKey(cat.id), JSON.stringify([...next]))
      } catch {
        /* stockage plein ou refusé : la marque se perd au rechargement */
      }
      return next
    })
  }
  const [zoomPage, setZoomPage] = useState<number | null>(null)
  // Toutes les versions (FR / NL × générale et chaque boutique), à la demande.
  const [all, setAll] = useState<{ status: 'idle' | 'loading' | 'done'; rows: Array<{ lang: CatalogueLang; shop: number | null; warnings: CatalogueDocument['warnings'] | null; error?: string }> }>({ status: 'idle', rows: [] })
  async function checkAll() {
    const versions = cat.langs.flatMap((lang) => [{ lang, shop: null as number | null }, ...p.versionShops.map((shop) => ({ lang, shop: shop as number | null }))])
    setAll({ status: 'loading', rows: [] })
    const rows = await Promise.all(
      versions.map(async (v) => {
        try {
          const one = await api.getCatalogueDocument(cat.id, v.lang, v.shop)
          return { ...v, warnings: one.warnings }
        } catch (cause) {
          return { ...v, warnings: null, error: cause instanceof Error ? cause.message : String(cause) }
        }
      }),
    )
    setAll({ status: 'done', rows })
  }
  const warnings = doc?.warnings ?? []
  const keyOf = (w: { code: string; message: string }) => `${w.code}|${w.message}`
  const open = warnings.filter((w) => !seen.has(keyOf(w)))
  const versionLabel = (shop: number | null) => (shop === null ? 'Version générale' : p.shopName(shop))
  /** Les pages que nomme un avertissement (« Page 5 : … ») : marquées sur les vignettes. */
  const marked = new Set(warnings.flatMap((w) => [...w.message.matchAll(/[Pp]ages? (\d+)/g)].map((m) => Number(m[1]) - 1)))
  function go(w: { code: string; message: string }) {
    const help = WARNING_HELP[w.code]?.go
    if (!help) return
    if (help === 'brand') p.onBrandPage(/avant-derni/i.test(w.message) ? (doc?.pages.length ?? 2) - 2 : /page 2/i.test(w.message) ? 1 : /dernière/i.test(w.message) ? (doc?.pages.length ?? 1) - 1 : 0)
    else if (help === 'back') p.onBrandPage((doc?.pages.length ?? 1) - 1)
    else if (help.detail) p.openDetail(null)
    else p.setStep(help.step)
  }
  return (
    <div className="wz-body wz-body--side">
      <section className="wz-pan">
        <div className="wz-kick">Étape 4 · Validation</div>
        <div className="wz-valbar">
          <h2 className="wz-title">Je vérifie avant d’imprimer</h2>
          <span className="wz-grow" />
          <VersionPicker {...p} />
        </div>
        <div className="wz-progress">
          <span>
            {warnings.length - open.length} sur {warnings.length} point{warnings.length > 1 ? 's' : ''} vu{warnings.length - open.length > 1 ? 's' : ''}
          </span>
          <span className="wz-progress__bar">
            <i style={{ width: `${warnings.length ? (100 * (warnings.length - open.length)) / warnings.length : 100}%` }} />
          </span>
        </div>
        {!doc ? <p className="muted">Le Marketing compose le catalogue…</p> : null}
        {doc && warnings.length === 0 ? (
          <ul className="wz-checks">
            <li className="wz-check is-ok">
              <span className="wz-check__ic">✓</span>
              <div>
                <b>Rien à signaler pour cette version</b>
                <p>
                  {versionLabel(p.versionShop)}, {p.lang.toUpperCase()} : produits, prix, pages et coordonnées sont en place.
                </p>
              </div>
            </li>
          </ul>
        ) : null}
        <ul className="wz-checks">
          {warnings.map((w) => {
            const key = keyOf(w)
            const isSeen = seen.has(key)
            const help = WARNING_HELP[w.code]
            const where = help?.go
            const goLabel = !where ? null : where === 'brand' ? 'Pages de la marque' : where === 'back' ? 'Dernière page, par boutique' : where.label
            return (
              <li key={key} className={`wz-check${isSeen ? ' is-seen' : ''}`}>
                <span className="wz-check__ic">{isSeen ? '✓' : '!'}</span>
                <div>
                  <b>{help?.title ?? w.code}</b>
                  <p>{w.message}</p>
                </div>
                <div className="wz-check__ge">
                  {goLabel ? (
                    <button type="button" className="btn btn--sm" onClick={() => go(w)}>
                      {goLabel} ›
                    </button>
                  ) : null}
                  <button type="button" className={isSeen ? 'linklike' : 'btn btn--sm'} onClick={() => markSeen(key, !isSeen)}>
                    {isSeen ? 'Rouvrir' : 'Vu'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="wz-allv">
          <div className="wz-opt__t">
            Toutes les versions
            <span className="wz-grow" />
            <button type="button" className="btn btn--sm" disabled={all.status === 'loading'} onClick={() => void checkAll()}>
              {all.status === 'loading' ? 'Composition…' : all.status === 'done' ? 'Revérifier' : `Vérifier les ${cat.langs.length * (1 + p.versionShops.length)} versions`}
            </button>
          </div>
          {all.status === 'done' ? (
            <table className="wz-table wz-table--v">
              <tbody>
                {all.rows.map((r) => {
                  const n = r.warnings?.length ?? 0
                  const openN = r.warnings ? r.warnings.filter((w) => !seen.has(keyOf(w))).length : 0
                  return (
                    <tr key={`${r.lang}-${r.shop}`}>
                      <td>{versionLabel(r.shop)}</td>
                      <td>{r.lang.toUpperCase()}</td>
                      <td>{r.error ? <span className="error">{r.error}</span> : n === 0 ? <span className="wz-ok">✓ rien à signaler</span> : `${openN} à voir · ${n - openN} vu${n - openN > 1 ? 's' : ''}`}</td>
                      <td>
                        <button
                          type="button"
                          className="linklike"
                          onClick={() => {
                            p.setLang(r.lang)
                            p.setVersionShop(r.shop)
                          }}
                        >
                          Ouvrir
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <small>Chaque boutique a sa version (ses prix, ses produits, son adresse) : leurs points se vérifient d’un coup.</small>
          )}
        </div>
        <Nav
          back={
            <button type="button" className="btn" onClick={() => p.setStep(3)}>
              ‹ Présentation
            </button>
          }
          middle={<span className="wz-count">Imprimer reste possible avec des points ouverts.</span>}
          next={
            <button type="button" className="btn btn--primary" onClick={() => p.setStep(5)}>
              Feuilleter, imprimer ›
            </button>
          }
        />
      </section>
      <aside className="wz-pan wz-pages">
        <div className="wz-kick">
          Les {doc?.pages.length ?? ''} pages · les points à voir
        </div>
        {doc ? (
          <div className="wz-pages__grid">
            {doc.pages.map((_, i) => (
              <button key={i} type="button" className="wz-vg" onClick={() => setZoomPage(i)}>
                <Thumb doc={doc} index={i} width={64} />
                {marked.has(i) ? <span className="wz-vg__mk">!</span> : null}
                <span className="wz-vg__no">{i + 1}</span>
              </button>
            ))}
          </div>
        ) : null}
        <small>Un clic ouvre la page en grand. Les pages de la marque sont celles de sa charte{doc?.charter.version ? ` (version ${doc.charter.version})` : ''}.</small>
      </aside>
      {zoomPage !== null && doc ? <Zoom doc={doc} index={zoomPage} onClose={() => setZoomPage(null)} onIndex={setZoomPage} /> : null}
    </div>
  )
}

export function VersionPicker(p: WizardProps) {
  return (
    <span className="wz-versions">
      {p.cat.langs.length > 1 ? <Seg label="Langue" value={p.lang} options={p.cat.langs.map((l) => [l, l.toUpperCase()] as [CatalogueLang, string])} onChange={p.setLang} /> : null}
      {p.cat.owner === 'marque' ? (
        <select className="wz-select" value={p.versionShop ?? ''} onChange={(event) => p.setVersionShop(event.target.value ? Number(event.target.value) : null)} aria-label="Version">
          <option value="">Version générale</option>
          {p.versionShops.map((s) => (
            <option key={s} value={s}>
              {p.shopName(s)}
            </option>
          ))}
        </select>
      ) : null}
    </span>
  )
}

// --- 5 · Feuilleter et imprimer --------------------------------------------------------------------

/**
 * Feuilleter (le « Feuilleter mon catalogue » du franchisé) : le document page par page comme imprimé et plié — la
 * couverture seule à droite, puis les doubles pages, la dernière seule à gauche. La page tourne (3D) ; ‹ ›, les flèches
 * du clavier, un clic sur la page de gauche ou de droite ; « Agrandir » l'ouvre en grand.
 */
function Flipbook({ doc, big, onBig, header }: { doc: CatalogueDocument; big: boolean; onBig: () => void; header: ReactNode }) {
  const n = doc.pages.length
  const all = spreads(n)
  const [at, setAt] = useState(0)
  const [turn, setTurn] = useState<{ dir: 1 | -1; to: number; go: boolean } | null>(null)
  const current = Math.min(at, all.length - 1)
  const size = FORMAT_MM[doc.catalogue.format]
  const ratio = size.h / size.w
  const width = big ? Math.max(260, Math.min(620, Math.floor((window.innerHeight - 200) / ratio), Math.floor((window.innerWidth - 160) / 2))) : 300
  const height = Math.round(width * ratio)
  const bookRef = useRef<HTMLDivElement>(null)
  const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  function flip(dir: 1 | -1) {
    const to = current + dir
    if (to < 0 || to >= all.length || turn) return
    if (calm) {
      setAt(to)
      return
    }
    setTurn({ dir, to, go: false })
    requestAnimationFrame(() => requestAnimationFrame(() => setTurn((t) => (t ? { ...t, go: true } : t))))
    window.setTimeout(() => finish(to), 1100)
  }
  function finish(to: number) {
    setTurn((t) => {
      if (t && t.to === to) {
        setAt(to)
        return null
      }
      return t
    })
  }
  useEffect(() => {
    bookRef.current?.focus({ preventScroll: true })
  }, [big])

  const page = (i: number | null) => (i === null ? null : <Thumb doc={doc} index={i} width={width} className="wz-fb__sheet" />)
  const [left0, right0] = all[current]
  const target = turn ? all[turn.to] : null
  // Pendant que la page tourne : dessous, la page qui sera découverte ; la feuille porte celle qu'on quitte et, au dos, celle qui arrive.
  const left = turn && turn.dir < 0 && target ? target[0] : left0
  const right = turn && turn.dir > 0 && target ? target[1] : right0
  const book = (
    <div className="wz-fb__scene">
      <button type="button" className="wz-fb__nav" disabled={current === 0 || !!turn} onClick={() => flip(-1)} aria-label="Page précédente">
        ‹
      </button>
      <div
        ref={bookRef}
        className={`wz-fb__book${left === null ? ' no-left' : ''}${right === null ? ' no-right' : ''}`}
        tabIndex={0}
        style={{ '--w': `${width}px`, '--h': `${height}px` } as CSSProperties}
        aria-label={`Le catalogue, ${spreadLabel(all[current], n)} — flèches gauche et droite pour tourner les pages`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            flip(1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            flip(-1)
          } else if (event.key === 'Escape' && big) onBig()
        }}
      >
        <div className="wz-fb__left" onClick={() => flip(-1)}>
          {page(left)}
        </div>
        <div className="wz-fb__right" onClick={() => flip(1)}>
          {page(right)}
        </div>
        <i className="wz-fb__fold" aria-hidden="true" />
        {turn && target ? (
          <div className={`wz-fb__leaf ${turn.dir > 0 ? 'to-left' : 'to-right'}${turn.go ? ' is-turning' : ''}`} onTransitionEnd={() => finish(turn.to)}>
            <div className="wz-fb__face is-front">{page(turn.dir > 0 ? right0 : left0)}</div>
            <div className="wz-fb__face is-back">{page(turn.dir > 0 ? target[0] : target[1])}</div>
          </div>
        ) : null}
      </div>
      <button type="button" className="wz-fb__nav" disabled={current === all.length - 1 || !!turn} onClick={() => flip(1)} aria-label="Page suivante">
        ›
      </button>
    </div>
  )
  const foot = (
    <div className="wz-fb__foot">
      <span className="wz-count">
        {spreadLabel(all[current], n)} · {n} pages
      </span>
      <span className="wz-fb__spreads">
        {all.map((s, i) => (
          <button key={i} type="button" className={i === current ? 'is-on' : ''} title={spreadLabel(s, n)} onClick={() => !turn && setAt(i)}>
            {s[0] === null ? '1' : s[1] === null ? String(s[0] + 1) : `${s[0] + 1}-${s[1] + 1}`}
          </button>
        ))}
      </span>
    </div>
  )
  const inner = (
    <section className="wz-pan wz-fb">
      {header}
      {book}
      {foot}
    </section>
  )
  if (big) {
    return (
      <div className="wz-fb__full" role="dialog" aria-label="Feuilleter le catalogue">
        {inner}
      </div>
    )
  }
  return inner
}

function StepFlipbook(p: WizardProps) {
  const { cat, doc, change, busy } = p
  const [big, setBig] = useState(false)
  const [qty, setQty] = useState<string>(cat.printQty ? String(cat.printQty) : '')
  const warnings = doc?.warnings.length ?? 0
  const header = (
    <div className="wz-fb__head">
      <span className="wz-kick">Feuilleter le catalogue</span>
      <small>comme imprimé et plié : la couverture, puis les doubles pages</small>
      <span className="wz-grow" />
      <VersionPicker {...p} />
      <button type="button" className="btn btn--sm" onClick={() => setBig(!big)}>
        {big ? 'Fermer' : 'Agrandir'}
      </button>
    </div>
  )
  return (
    <div className="wz-body wz-body--side">
      <div className="wz-col">
        {doc ? <Flipbook key={`${doc.catalogue.id}-${doc.pages.length}-${p.lang}-${p.versionShop}`} doc={doc} big={big} onBig={() => setBig(false)} header={header} /> : <section className="wz-pan">{header}<p className="muted">Composition du catalogue…</p></section>}
        <Nav
          back={
            <button type="button" className="btn" onClick={() => p.setStep(4)}>
              ‹ Validation
            </button>
          }
        />
      </div>
      <aside className="wz-col">
        <section className="wz-pan">
          <div className="wz-kick">Imprimer</div>
          <dl className="wz-dl">
            <dt>Catalogue</dt>
            <dd>
              {cat.pageCount} pages {cat.format}, dont 4 de la marque
            </dd>
            <dt>Versions</dt>
            <dd>
              {cat.langs.map((l) => l.toUpperCase()).join(' + ')} · {cat.owner === 'marque' ? `générale + ${p.versionShops.length} boutique${p.versionShops.length > 1 ? 's' : ''}` : (cat.shop?.name ?? 'la boutique')}
            </dd>
            <dt>Prix</dt>
            <dd>ceux du webshop, lus maintenant</dd>
          </dl>
          {warnings ? (
            <p className="wz-info">
              {warnings} point{warnings > 1 ? 's' : ''} sur cette version.{' '}
              <button type="button" className="linklike" onClick={() => p.setStep(4)}>
                Revenir à la validation
              </button>
            </p>
          ) : null}
          <button type="button" className="btn btn--primary wz-wide" onClick={() => p.print('printer', cat.owner === 'marque')}>
            PDF pour l’imprimeur{cat.owner === 'marque' ? ' · toutes les versions' : ''}
          </button>
          <button type="button" className="btn wz-wide" onClick={() => p.print('printer', false)}>
            PDF imprimeur · cette version
          </button>
          <button type="button" className="btn wz-wide" onClick={() => p.print('proof', false)}>
            Aperçu imprimable · cette version
          </button>
          <small>Imprimeur : fond perdu 3 mm, traits de coupe. Aperçu : les pages au format fini, pour relire.</small>
        </section>
        <section className="wz-pan">
          <div className="wz-kick">État</div>
          <Seg label="État" value={cat.status} options={(['brouillon', 'pret', 'imprime'] as const).map((s) => [s, STATUS_LABELS[s]])} disabled={busy} onChange={(status) => change({ status })} />
          <label className="wz-qty">
            <span>Exemplaires imprimés</span>
            <input type="number" min={1} value={qty} onChange={(event) => setQty(event.target.value)} onBlur={() => change({ printQty: qty ? Number(qty) : null })} />
          </label>
          <button type="button" className="btn btn--sm" disabled={busy || !qty} onClick={() => change({ status: 'imprime', printQty: Number(qty) })}>
            Marquer imprimé · {qty || '0'} ex.
          </button>
          <small>« Imprimé » fige la version de la charte de ce catalogue : ses pages de la marque ne bougent plus.</small>
        </section>
      </aside>
    </div>
  )
}
