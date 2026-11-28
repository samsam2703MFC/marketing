import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import * as api from '../../lib/api/module'
import type {
  CatalogueDocDesign,
  CatalogueDocument,
  CatalogueGamme,
  CatalogueHeader,
  CatalogueLayout,
  CatalogueLang,
  CataloguePageCount,
  CataloguePageRow,
  CataloguePresElement,
  CataloguePresentation,
  CataloguePresLayout,
  CatalogueTemplate,
  MediaAsset,
} from '../../lib/api/module'
import { useAsync } from '../../lib/useAsync'
import { CatalogueSheet, FORMAT_MM, HEADER_LABELS, LAYOUT_LABELS, TEMPLATE_LABELS, isPresentation } from './CataloguePages'
import { LayoutIcon } from './CatalogueIcons'
import { MediaPicker } from './MediaPicker'
import { useReorder } from './useReorder'
import type { Reorder } from './useReorder'
import './catalogue-gammes.css'
import Erreur from '../../components/Erreur'

/**
 * L'étape 3 de l'assistant, « Gamme par gamme » (27/11/2026, maquettes M1 · M2 · M3 validées par le client) : le
 * catalogue se range en BLOCS — pages 1-2 de la marque, les produits hors gamme, puis chaque gamme (sa page de
 * présentation sur une page de gauche, ses catégories en face), les deux dernières pages de la marque.
 *
 *  - « Le catalogue » (colonne de gauche) : les pages de la marque, le bloc hors gamme, les gammes ajoutées (✓ validée ou
 *    « en cours »), à glisser pour changer leur ordre ; « ＋ Ajouter une gamme » propose les gammes des produits choisis ;
 *  - une gamme ouverte : a) sa page de présentation (photos de la médiathèque, disposition, titre, accroche, texte, fond ;
 *    l'aperçu imprimé au centre, en direct) ; b) la mise en page de ses catégories ; « Valider la gamme » ;
 *  - « Mise en page finale » (M1) : les blocs en couleur, à glisser entiers, les catégories d'un bloc à réordonner, et la
 *    bande des doubles pages.
 *
 * Le rangement (pages libres intercalées, présentation à gauche, 8 à 16 pages) est celui du serveur (`organise`) : l'écran
 * envoie les blocs ou les pages, et relit ce que le serveur a rangé.
 *
 * Glisser (27/11/2026, client : « je dois pouvoir adapter le sens en drag and drop ») : la bande « Le catalogue à ce
 * stade », la mise en page finale, la colonne et la liste des catégories partagent `useReorder` — un bloc de gamme entier,
 * ou une catégorie dans son bloc (hors gamme compris) ; marque et hors gamme ne bougent pas. Un ordre n'est plus refusé
 * pour la parité : le serveur retire la page libre qui manquait, la bande dit quelle présentation tombe à droite et
 * propose ses remèdes ; un vrai refus est dit dans la bande et l'écran revient à l'ordre enregistré.
 */

const MM = 96 / 25.4
const BRAND_PAGES = 4
const PAGE_COUNTS: CataloguePageCount[] = [8, 10, 12, 14, 16]
const HORS = 'hors'
type Section = number | typeof HORS
const CAT_LAYOUTS: CatalogueLayout[] = ['vedette', 'grille', 'liste', 'mosaique']
const CAT_LABELS: Record<string, string> = { vedette: 'Vedette + 4', grille: 'Grille 2×3', liste: 'Liste', mosaique: '2 grandes' }
/** Le nombre d'images (la « pleine » d'avant n'est plus proposée : c'est la place « Pleine page »). */
const PRES_LAYOUTS: Array<[CataloguePresLayout, string]> = [['une', '1 grande'], ['deux', '2 images'], ['mosaique', '3 mosaïque']]
/** La place des images par rapport au texte (28/11/2026, client : « haut et bas, gauche, droite »). */
const PRES_POSITIONS: Array<[api.CataloguePresPosition, string]> = [['haut', 'Haut'], ['bas', 'Bas'], ['gauche', 'Gauche'], ['droite', 'Droite'], ['pleine', 'Pleine page']]
const TEXT_PLACES: Array<[api.CataloguePresTextPlace, string]> = [['haut', 'En haut'], ['centre', 'Au centre'], ['bas', 'En bas']]
const INKS: Array<[api.CataloguePresInk, string]> = [['gamme', 'Couleur de la gamme'], ['encre', 'Encre']]
/** L'adresse d'un dessin livré avec le module (`img/print/…`). */
const assetUrl = (path: string): string => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
const FONTS: Array<[api.CatalogueCoverFont, string]> = [['vank', 'Vank'], ['gotham', 'Gotham'], ['playwrite', 'Manuscrite']]
const WEIGHTS: Array<[api.CataloguePresWeight, string]> = [['light', 'Light'], ['regular', 'Regular'], ['medium', 'Medium'], ['bold', 'Bold']]
const ALIGNS: Array<[api.CataloguePresAlign, string]> = [['left', 'Gauche'], ['center', 'Centre'], ['right', 'Droite']]
const TEXT_COLORS: Array<[api.CataloguePresTextColor, string]> = [['gamme', 'Gamme'], ['rubis', 'Bordeaux'], ['or', 'Or'], ['encre', 'Encre'], ['creme', 'Crème'], ['blanc', 'Blanc']]
const BG_COLORS: Array<[api.CataloguePresBgColor, string]> = [['papier', 'Papier'], ['gamme-pale', 'Gamme pâle'], ['gamme', 'Gamme'], ['creme', 'Crème'], ['abricot', 'Abricot'], ['blanc', 'Blanc']]
const HORS_COLOR = '#7A736A'
/** La largeur imprimée d'une case de photo (mm, A5) : sert à dire la résolution d'une photo. */
const SLOT_MM: Record<CataloguePresLayout, number[]> = { une: [126], deux: [62, 62], mosaique: [74, 51, 51], pleine: [154] }
/** La même, selon la place des images : à gauche ou à droite, une demi-page ; pleine page, toute la largeur. */
const SLOT_MM_SIDE: Record<CataloguePresLayout, number[]> = { une: [63], deux: [63, 63], mosaique: [63, 31, 31], pleine: [154] }
const SLOT_MM_FULL: Record<CataloguePresLayout, number[]> = { une: [154], deux: [77, 77], mosaique: [92, 62, 62], pleine: [154] }

/** La couleur pâle d'une gamme : sa couleur mêlée à 18 % au papier (la règle du serveur, `paleOf`). */
export function paleOf(hex: string): string {
  const paper = [0xfc, 0xfa, 0xf6]
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0)
  return `#${rgb.map((v, i) => Math.round(paper[i] + (v - paper[i]) * 0.18).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

const isSpacer = (p: CataloguePageRow): boolean => !isPresentation(p.layout) && p.layout !== 'pleine' && p.category === null && (p.gamme ?? null) === null

/** La section d'une page : sa gamme si c'est un bloc, sinon hors gamme ; null : une page libre. */
function sectionOf(p: CataloguePageRow, blocks: number[]): Section | null {
  if (isSpacer(p)) return null
  const g = p.gamme ?? null
  return g !== null && blocks.includes(g) ? g : HORS
}

/** Les catégories d'une section, dans l'ordre de leurs pages, avec leurs pages (indices intérieurs). */
function categoriesOf(pages: CataloguePageRow[], blocks: number[], sec: Section): Array<{ c: number | null; idx: number[] }> {
  const out: Array<{ c: number | null; idx: number[] }> = []
  pages.forEach((p, i) => {
    if (isPresentation(p.layout) || sectionOf(p, blocks) !== sec) return
    const found = out.find((x) => x.c === p.category)
    if (found) found.idx.push(i)
    else out.push({ c: p.category, idx: [i] })
  })
  return out
}

/**
 * Les pages après un changement d'ordre des catégories d'une section : leurs pages suivent, après la présentation de la
 * gamme (au début pour le bloc hors gamme). Le serveur remet ensuite les pages libres où il faut.
 */
function catsPages(pages: CataloguePageRow[], blocks: number[], sec: Section, from: number, to: number): CataloguePageRow[] {
  const cats = categoriesOf(pages, blocks, sec)
  const order = cats.map((x) => x.c)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  const others = pages.filter((_, i) => !cats.some((x) => x.idx.includes(i)))
  const at = sec === HORS ? -1 : others.findIndex((x) => isPresentation(x.layout) && x.gamme === sec)
  const out = [...others]
  out.splice(at + 1, 0, ...order.flatMap((c) => (cats.find((x) => x.c === c)?.idx ?? []).map((i) => pages[i])))
  return toSend(out)
}

/**
 * Les pages après avoir refait celles d'une catégorie d'une section : sa mise en page, au moins `nPages` pages (assez pour
 * ses `nProducts` produits), gabarit et en-tête. null : la catégorie n'a pas de page.
 */
function relayPages(
  pages: CataloguePageRow[],
  blocks: number[],
  sec: Section,
  c: number | null,
  nProducts: number,
  wanted: { layout?: CatalogueLayout; nPages?: number; template?: CatalogueTemplate; header?: CatalogueHeader },
): CataloguePageRow[] | null {
  const own = categoriesOf(pages, blocks, sec).find((x) => x.c === c)
  if (!own) return null
  const first = pages[own.idx[0]]
  const layout = wanted.layout ?? (first.layout === 'pleine' ? 'grille' : first.layout)
  const need = Math.max(1, Math.ceil(nProducts / LAYOUT_LABELS[layout].capacity), Math.min(wanted.nPages ?? own.idx.length, Math.max(1, nProducts)))
  const base: CataloguePageRow = { ...first }
  delete base.product
  const fresh: CataloguePageRow[] = Array.from({ length: need }, () => ({
    ...base,
    layout,
    category: c,
    gamme: sec === HORS ? null : sec,
    template: wanted.template ?? first.template ?? 'A',
    header: wanted.header ?? first.header ?? 'titre',
  }))
  const out = pages.filter((_, i) => !own.idx.includes(i))
  out.splice(own.idx[0] - own.idx.filter((i) => i < own.idx[0]).length, 0, ...fresh)
  return toSend(out)
}

/** Le nom du groupe de glisser des catégories d'une section. */
const catsGroup = (sec: Section): string => `cats:${sec}`

const range = (idx: number[]): string => (idx.length ? `p. ${Math.min(...idx) + 3}${idx.length > 1 ? `-${Math.max(...idx) + 3}` : ''}` : '')

/** Les pages à envoyer : sans les pages libres vides (le serveur les remet où il faut), avec celles qui ont une photo. */
const toSend = (pages: CataloguePageRow[]): CataloguePageRow[] => pages.filter((p) => !isSpacer(p) || p.filler)

/** Une page du document, réduite. */
function Mini({ doc, index, width, className = '' }: { doc: CatalogueDocument; index: number; width: number; className?: string }) {
  const size = FORMAT_MM[doc.catalogue.format]
  const zoom = width / (size.w * MM)
  if (!doc.pages[index]) return <span className={`gp-mini gp-mini--blank ${className}`} style={{ width, height: size.h * MM * zoom }} />
  return (
    <span className={`gp-mini ${className}`} style={{ width, height: size.h * MM * zoom }}>
      <span style={{ zoom }}>
        <CatalogueSheet doc={doc} index={index} mode="preview" />
      </span>
    </span>
  )
}

function Seg<T extends string | number>({ value, options, onChange, label, disabled = false }: { value: T | null; options: Array<[T, ReactNode]>; onChange: (v: T) => void; label: string; disabled?: boolean }) {
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

/** Ce que le document imprimera pour une présentation en cours d'édition (la règle de `presDoc` du serveur). */
function docDesign(pres: CataloguePresentation, gammeColor: string, lang: CatalogueLang, title: string, text: string, drawing: string | null): CatalogueDocDesign {
  const hex = (name: string): string => (name === 'gamme' ? gammeColor : name === 'gamme-pale' ? paleOf(gammeColor) : (api.CATALOGUE_PRES_HEX[name] ?? '#241C1A'))
  const t = (el: CataloguePresElement, fallback: string) => {
    const e = pres[el]
    const v = lang === 'nl' ? e.nl || e.fr : e.fr
    return { text: v || fallback, font: e.font, size: e.size, weight: e.weight, color: hex(e.color), align: e.align }
  }
  return {
    layout: pres.layout,
    photos: pres.photos.map((p) => ({ url: p.source === 'illustration' ? (drawing ? assetUrl(drawing) : null) : (p.image?.url ?? null), x: p.x, y: p.y, zoom: p.zoom, kind: p.source === 'illustration' ? 'illustration' : 'photo' })),
    title: t('title', title),
    kicker: t('kicker', ''),
    text: t('text', text),
    background: {
      color: hex(pres.background.color),
      imageUrl: pres.background.kind === 'photo' ? (pres.background.image?.url ?? null) : pres.background.kind === 'illustration' && drawing ? assetUrl(drawing) : null,
      veil: pres.background.veil,
      kind: pres.background.kind,
    },
    gammeColor,
    position: pres.position,
    textPlace: pres.textPlace,
    ink: pres.ink === 'encre' ? api.CATALOGUE_PRES_HEX.encre : gammeColor,
    drawing,
    drawingUrl: drawing ? assetUrl(drawing) : null,
  }
}

/** Une modification qui dit elle-même son échec, à côté de l'action (l'étape 3 : un ordre refusé par le serveur). */
export interface ChangeOptions {
  onError?: (message: string) => void
}

export interface GammesProps {
  cat: api.Catalogue
  doc: CatalogueDocument | null
  lang: CatalogueLang
  busy: boolean
  products: api.WebshopProduct[]
  byId: Map<number, api.WebshopProduct>
  categories: Map<number, api.WebshopCategory>
  change: (patch: api.CatalogueUpdate, opts?: ChangeOptions) => void
  setStep: (step: 1 | 2 | 3 | 4 | 5) => void
  openDetail: (innerIndex: number | null) => void
  onZoom: (docIndex: number) => void
}

export default function StepGammes(p: GammesProps) {
  const { cat, lang, change, busy } = p
  const blocks = cat.gammeBlocks ?? []
  const ok = new Set(cat.gammesOk ?? [])
  const pages = cat.pages
  const gammesRead = useAsync(() => api.getCatalogueGammes(), [])
  const [gammes, setGammes] = useState<CatalogueGamme[]>([])
  useEffect(() => {
    if (gammesRead.data) setGammes(gammesRead.data)
  }, [gammesRead.data])
  const gamme = (id: number): CatalogueGamme | undefined => gammes.find((g) => g.id === id)
  const colorOf = (sec: Section): string => (sec === HORS ? HORS_COLOR : (gamme(sec)?.color ?? '#B8B2A8'))
  const nameOf = (sec: Section): string => (sec === HORS ? 'Produits hors gamme' : (gamme(sec)?.title ?? `Gamme ${sec}`))
  const catName = (c: number | null): string => {
    if (c === null) return 'La gamme'
    const found = p.categories.get(c)
    return found ? (lang === 'nl' ? found.nameNl || found.name : found.name) : `Catégorie ${c}`
  }

  // Les produits cochés, par section et catégorie.
  const checked = cat.products.filter((r) => r.on).map((r) => p.byId.get(r.id)).filter((x): x is api.WebshopProduct => !!x)
  const inSection = (x: api.WebshopProduct, sec: Section) => (sec === HORS ? !x.gammes.some((g) => blocks.includes(g)) : x.gammes.includes(sec))
  const count = (sec: Section, c: number | null) => checked.filter((x) => inSection(x, sec) && (c === null || x.categoryId === c)).length
  const horsCount = checked.filter((x) => inSection(x, HORS)).length

  const [open, setOpen] = useState<Section | null>(null)
  const [sub, setSub] = useState<'pres' | 'cats'>('pres')
  const [final, setFinal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  const inner = cat.pageCount - BRAND_PAGES
  const used = pages.filter((x) => !isSpacer(x)).length
  const presIndex = (g: number) => pages.findIndex((x) => isPresentation(x.layout) && x.gamme === g)
  const pagesOf = (sec: Section) => pages.map((_, i) => i).filter((i) => (isPresentation(pages[i].layout) ? pages[i].gamme === sec : sectionOf(pages[i], blocks) === sec))

  // Un déplacement refusé par le serveur : dit dans la bande, court ; l'écran revient à l'ordre enregistré.
  const [moveError, setMoveError] = useState<string | null>(null)
  const layoutChange = (patch: api.CatalogueUpdate) => {
    setMoveError(null)
    change(patch, { onError: setMoveError })
  }
  function setBlocks(next: number[], extra: api.CatalogueUpdate = {}) {
    setNotice(null)
    layoutChange({ gammeBlocks: next, ...extra })
  }
  function moveBlock(g: number, to: number) {
    const next = blocks.filter((x) => x !== g)
    next.splice(to, 0, g)
    setBlocks(next)
  }
  // Le glisser (colonne, bande « à ce stade », mise en page finale, catégories) : une seule implémentation, un seul état.
  const dnd = useReorder(
    (group, from, to) => {
      if (group === 'blocks') {
        if (blocks[from] !== undefined) moveBlock(blocks[from], to)
        return
      }
      if (!group.startsWith('cats:')) return
      const raw = group.slice(5)
      const sec: Section = raw === HORS ? HORS : Number(raw)
      setNotice(null)
      layoutChange({ pages: catsPages(pages, blocks, sec, from, to) })
    },
    { busy },
  )

  // Les gammes que propose « Ajouter une gamme » : celles des produits choisis, avec leurs catégories et produits.
  const candidates = useMemo(() => {
    const ids = new Set(checked.flatMap((x) => x.gammes))
    return gammes
      .filter((g) => ids.has(g.id))
      .map((g) => {
        const list = checked.filter((x) => x.gammes.includes(g.id))
        return { g, products: list.length, categories: new Set(list.map((x) => x.categoryId)).size }
      })
  }, [gammes, checked])

  function addGamme(id: number) {
    setAdding(false)
    setBlocks([...blocks, id])
    setOpen(id)
    setSub('pres')
    setFinal(false)
  }

  // --- la colonne « Le catalogue » ---
  const n = cat.pageCount
  const column = (
    <aside className="wz-pan gp-col" data-sort-scope="">
      <div className="wz-kick">Le catalogue · {n} pages</div>
      <div className="gp-ci is-done">
        <span className="gp-ok">✓</span>
        <span className="gp-ci__t">
          Pages de la marque
          <small>Couverture · page 2 · avant-dernière · dernière</small>
        </span>
        <span className="gp-ci__p">
          1-2 · {n - 1}-{n}
        </span>
      </div>
      {horsCount ? (
        <button type="button" className={`gp-ci${open === HORS ? ' is-on' : ''}`} onClick={() => { setOpen(HORS); setSub('cats'); setFinal(false) }}>
          <i className="gp-dot" style={{ background: HORS_COLOR }} />
          <span className="gp-ci__t">
            Produits hors gamme
            <small>{categoriesOf(pages, blocks, HORS).map((x) => catName(x.c)).join(' · ') || `${horsCount} produits sans page`}</small>
          </span>
          <span className="gp-ci__p">{range(pagesOf(HORS))}</span>
        </button>
      ) : null}
      {dnd.order('blocks', blocks, String).map(({ x: g, k }) => (
        <div
          key={g}
          {...dnd.item('blocks', k, 'y')}
          className={`gp-ci${open === g ? ' is-on' : ''}${ok.has(g) ? ' is-done' : ''}${dnd.isGhost('blocks', k) ? ' is-ghost' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => { setOpen(g); setSub(ok.has(g) ? 'cats' : 'pres'); setFinal(false) }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter') { setOpen(g); setFinal(false) }
          }}
        >
          <button {...dnd.grip('blocks', k, blocks.length, `col-${g}`, nameOf(g))}>⋮⋮</button>
          {ok.has(g) ? <span className="gp-ok">✓</span> : null}
          <i className="gp-dot" style={{ background: colorOf(g) }} />
          <span className="gp-ci__t">
            {nameOf(g)}
            {!ok.has(g) ? <em>en cours{open === g ? ` · ${sub === 'pres' ? 'présentation' : 'mise en page'}` : ''}</em> : null}
            <small>{['Présentation', ...categoriesOf(pages, blocks, g).map((x) => catName(x.c))].join(' · ')}</small>
          </span>
          <span className="gp-ci__p">{range(pagesOf(g))}</span>
        </div>
      ))}
      <div className="gp-add">
        <button type="button" className="gp-add__btn" aria-expanded={adding} onClick={() => setAdding((a) => !a)} disabled={busy}>
          ＋ Ajouter une gamme <span aria-hidden="true">▾</span>
        </button>
        {adding ? (
          <div className="gp-dd" role="listbox" aria-label="Les gammes des produits choisis">
            {candidates.length === 0 ? <p className="wz-note">Aucune gamme parmi les produits choisis : cochez des produits d’une gamme à l’étape 2.</p> : null}
            {candidates.map(({ g, products, categories }) => {
              const placed = blocks.includes(g.id)
              return (
                <button key={g.id} type="button" role="option" aria-selected={false} className={`gp-dd__o${placed ? ' is-off' : ''}`} disabled={placed || blocks.length >= 8} onClick={() => addGamme(g.id)}>
                  <i className="gp-dot" style={{ background: g.color }} />
                  <span>{g.title}</span>
                  <small>{placed ? 'déjà dans le catalogue' : `${categories} catégorie${categories > 1 ? 's' : ''} · ${products} produit${products > 1 ? 's' : ''}`}</small>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      <button type="button" className={`gp-ci gp-ci--final${final ? ' is-on' : ''}`} onClick={() => { setFinal(true); setOpen(null) }}>
        <span className="gp-grip" aria-hidden="true">⠿</span>
        <span className="gp-ci__t">
          Mise en page finale
          <small>les blocs, les doubles pages</small>
        </span>
      </button>
      <div className="gp-gauge">
        <div>
          <b>
            {used + BRAND_PAGES} pages sur {n}
          </b>
          <span>
            {inner - used} libre{inner - used > 1 ? 's' : ''}
          </span>
        </div>
        <div className="gp-gauge__bar">
          <i style={{ width: `${(200 / n).toFixed(2)}%`, background: '#cfc6b9' }} />
          {[HORS as Section, ...blocks].map((sec) => {
            const k = pagesOf(sec).length
            return k ? <i key={String(sec)} style={{ width: `${((100 * k) / n).toFixed(2)}%`, background: colorOf(sec) }} /> : null
          })}
          <i style={{ width: `${(200 / n).toFixed(2)}%`, background: '#cfc6b9', marginLeft: 'auto' }} />
        </div>
      </div>
    </aside>
  )

  const noticeEl = notice ? <p className={notice.kind === 'error' ? 'error' : 'wz-info'}>{notice.text}</p> : null

  // Une présentation tombée sur une page de droite (le serveur a retiré la page libre de parité faute de place, plutôt que
  // de refuser l'ordre) : dit dans la bande, avec des remèdes en un clic — une catégorie ramassée en liste, la gamme retirée.
  const rightPres = pages
    .map((x, i) => ({ x, i }))
    .filter(({ x, i }) => isPresentation(x.layout) && typeof x.gamme === 'number' && blocks.includes(x.gamme) && (i + 3) % 2 === 1)
  const fixes: Array<{ label: string; run: () => void }> = []
  if (rightPres.length) {
    const cap = LAYOUT_LABELS.liste.capacity
    for (const sec of [HORS as Section, ...blocks]) {
      for (const x of categoriesOf(pages, blocks, sec)) {
        const nb = count(sec, x.c)
        if (x.idx.length < 2 || nb > cap * (x.idx.length - 1) || fixes.length >= 2) continue
        const already = x.idx.every((i) => pages[i].layout === 'liste')
        fixes.push({
          label: already ? `Ramasser « ${catName(x.c)} » sur ${x.idx.length - 1} page${x.idx.length > 2 ? 's' : ''} (−1 page)` : `Passer « ${catName(x.c)} » en liste (−1 page)`,
          run: () => {
            const out = relayPages(pages, blocks, sec, x.c, nb, { layout: 'liste', nPages: x.idx.length - 1 })
            if (out) layoutChange({ pages: out })
          },
        })
      }
    }
    const g = rightPres[0].x.gamme as number
    fixes.push({ label: `Retirer la gamme « ${nameOf(g)} »`, run: () => {
      if (!window.confirm(`Retirer la gamme « ${nameOf(g)} » de ce catalogue ? Ses pages partent ; elle se rajoute par « Ajouter une gamme ».`)) return
      setBlocks(blocks.filter((b) => b !== g), { gammesOk: [...ok].filter((b) => b !== g) })
    } })
  }
  const moveErrorShort = moveError ? moveError.split(/(?<=\.)\s/)[0] : ''
  const moveErrorLine = moveErrorShort.replace(/\s*\([^)]*\)/, '').replace(/^\p{Lu}/u, (m) => m.toLowerCase())
  const layoutAlert =
    moveError || rightPres.length ? (
      <div className="gp-alerts" role="status">
        {moveError ? (
          <div className="gp-alert gp-alert--ko">
            <span>
              Déplacement non enregistré : {moveErrorLine} L’ordre enregistré est rétabli.
            </span>
            <button type="button" className="gp-alert__x" onClick={() => setMoveError(null)} aria-label="Fermer">
              ✕
            </button>
            {moveError !== moveErrorShort ? (
              <details className="erreur__detail">
                <summary>Détails</summary>
                <code>{moveError}</code>
              </details>
            ) : null}
          </div>
        ) : null}
        {rightPres.length ? (
          <div className="gp-alert">
            <span>
              {rightPres.map(({ x, i }) => `« ${nameOf(x.gamme as number)} » (p. ${i + 3})`).join(', ')} : présentation sur une page de droite, il manque une
              page pour la mettre à gauche.
            </span>
            <span className="gp-alert__fix">
              {fixes.map((f) => (
                <button key={f.label} type="button" className="btn btn--sm" disabled={busy} onClick={f.run}>
                  {f.label}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </div>
    ) : null

  if (final) return <FinalView {...p} change={layoutChange} alert={layoutAlert} dnd={dnd} gammes={gammes} colorOf={colorOf} nameOf={nameOf} catName={catName} onOpen={(sec) => { setFinal(false); setOpen(sec); setSub(sec === HORS ? 'cats' : 'pres') }} />

  return (
    <div className="gp">
      {column}
      {open === null ? (
        <Overview {...p} alert={layoutAlert} dnd={dnd} catName={catName} colorOf={colorOf} nameOf={nameOf} onFinal={() => setFinal(true)} lastOk={blocks.filter((g) => ok.has(g)).slice(-1)[0] ?? null} />
      ) : open !== HORS && sub === 'pres' ? (
        <PresentationEditor
          key={`pres-${open}`}
          {...p}
          g={open}
          gamme={gamme(open)}
          onModel={(saved) => setGammes((all) => all.map((x) => (x.id === saved.id ? saved : x)))}
          onBack={() => setOpen(null)}
          onNext={() => setSub('cats')}
          onCats={() => setSub('cats')}
          onRemove={() => { setBlocks(blocks.filter((x) => x !== open), { gammesOk: [...ok].filter((x) => x !== open) }); setOpen(null) }}
          presIdx={presIndex(open)}
          notice={noticeEl}
        />
      ) : (
        <CategoriesEditor
          {...p}
          dnd={dnd}
          sec={open}
          color={colorOf(open)}
          name={nameOf(open)}
          catName={catName}
          count={count}
          isOk={open !== HORS && ok.has(open)}
          onPres={() => setSub('pres')}
          onDone={() => {
            if (open !== HORS && !ok.has(open)) change({ gammesOk: [...ok, open] })
            setOpen(null)
          }}
          notice={noticeEl}
        />
      )}
    </div>
  )
}

// --- Le catalogue à ce stade (M2-1, M2-4) --------------------------------------------------------------

/** Les pages groupées comme elles se suivent : marque, hors gamme, chaque gamme (sa page libre d'avant comprise), libres. */
function groups(pages: CataloguePageRow[], blocks: number[]): Array<{ sec: Section | 'libre'; idx: number[] }> {
  const out: Array<{ sec: Section | 'libre'; idx: number[] }> = []
  pages.forEach((page, i) => {
    let sec: Section | 'libre' = isPresentation(page.layout) && page.gamme != null ? page.gamme : (sectionOf(page, blocks) ?? 'libre')
    // Une page libre juste avant une présentation est celle qui la met à gauche : elle va avec la gamme.
    if (sec === 'libre' && i + 1 < pages.length && isPresentation(pages[i + 1].layout) && pages[i + 1].gamme != null) sec = pages[i + 1].gamme as number
    const last = out[out.length - 1]
    if (last && last.sec === sec) last.idx.push(i)
    else out.push({ sec, idx: [i] })
  })
  return out
}

/**
 * Les groupes dans l'ordre affiché : les gammes prennent l'ordre du glisser (ou celui déposé, en attente du serveur),
 * dans les places qu'occupent les gammes ; marque, hors gamme et pages libres ne bougent pas. `k` : l'indice de la gamme
 * dans `gammeBlocks` (-1 hors des gammes), seul le premier groupe d'une gamme la porte.
 */
function orderedGroups(grps: Array<{ sec: Section | 'libre'; idx: number[] }>, blocks: number[], dnd: Reorder): Array<{ sec: Section | 'libre'; idx: number[]; k: number }> {
  const byId = new Map<number, Array<{ sec: Section | 'libre'; idx: number[] }>>()
  grps.forEach((g) => {
    if (typeof g.sec === 'number') byId.set(g.sec, [...(byId.get(g.sec) ?? []), g])
  })
  const queue = dnd
    .order('blocks', blocks, String)
    .filter(({ x }) => byId.has(x))
    .flatMap(({ x, k }) => (byId.get(x) ?? []).map((g, j) => ({ ...g, k: j === 0 ? k : -1 })))
  return grps.map((g) => (typeof g.sec === 'number' ? (queue.shift() ?? { ...g, k: -1 }) : { ...g, k: -1 }))
}

/** Les catégories d'une section dans l'ordre affiché, avec leur indice d'origine. */
function orderedCats(pages: CataloguePageRow[], blocks: number[], sec: Section, dnd: Reorder) {
  return dnd.order(catsGroup(sec), categoriesOf(pages, blocks, sec), (x) => String(x.c))
}

function Overview(
  p: GammesProps & { alert: ReactNode; dnd: Reorder; catName: (c: number | null) => string; colorOf: (s: Section) => string; nameOf: (s: Section) => string; onFinal: () => void; lastOk: number | null },
) {
  const { cat, doc, dnd } = p
  const blocks = cat.gammeBlocks ?? []
  const n = cat.pageCount
  const W = 92
  const thumb = (docIndex: number, label?: string) => (
    <button key={docIndex} type="button" className="gp-th" onClick={() => p.onZoom(docIndex)} title="Ouvrir en grand">
      {doc ? <Mini doc={doc} index={docIndex} width={W} /> : <span className="gp-mini gp-mini--blank" style={{ width: W, height: W * 1.42 }} />}
      <span>{label ?? docIndex + 1}</span>
    </button>
  )
  return (
    <section className="wz-pan gp-main">
      <div className="gp-head">
        <span className="wz-kick">{blocks.length ? 'Le catalogue à ce stade' : 'Pages de la marque'}</span>
        {blocks.length === 0 ? <span className="gp-chip gp-chip--ok">✓ validées</span> : p.lastOk !== null ? <span className="gp-chip gp-chip--ok">✓ {p.nameOf(p.lastOk)} validée</span> : null}
        <span className="wz-grow" />
        <span className="wz-note">
          {cat.pages.filter((x) => !isSpacer(x)).length + BRAND_PAGES} pages sur {n}
        </span>
      </div>
      {p.alert}
      <div className="gp-stage" data-sort-scope="">
        <div className="gp-grp is-locked">
          <div className="gp-grp__h">🔒 Marque</div>
          <div className="gp-grp__pp">
            {thumb(0, '1 · Couverture')}
            {thumb(1, '2')}
          </div>
        </div>
        {blocks.length === 0 && !cat.pages.some((x) => !isSpacer(x)) ? <div className="gp-hole">Vos gammes<br />p. 3 à {n - 2}</div> : null}
        {orderedGroups(groups(cat.pages, blocks), blocks, dnd).map((grp) => {
          if (grp.sec === 'libre') {
            return (
              <div key={`l-${grp.idx[0]}`} className="gp-grp is-free">
                <div className="gp-grp__h">{grp.idx.length > 1 ? 'Pages libres' : 'Page libre'} · {range(grp.idx)}</div>
                <div className="gp-grp__pp">{grp.idx.map((i) => thumb(i + 2, String(i + 3)))}</div>
              </div>
            )
          }
          const sec = grp.sec
          const movable = typeof sec === 'number' && grp.k >= 0
          const fixed = grp.idx.filter((i) => isSpacer(cat.pages[i]) || isPresentation(cat.pages[i].layout))
          const cats = orderedCats(cat.pages, blocks, sec, dnd).filter(({ x }) => x.idx.some((i) => grp.idx.includes(i)))
          const group = catsGroup(sec)
          const nCats = categoriesOf(cat.pages, blocks, sec).length
          return (
            <div
              key={`${sec}-${grp.idx[0]}`}
              {...(movable ? dnd.item('blocks', grp.k) : {})}
              className={`gp-grp${sec === HORS ? ' is-hors' : ''}${movable && dnd.isGhost('blocks', grp.k) ? ' is-ghost' : ''}`}
              style={{ borderTopColor: p.colorOf(sec) }}
            >
              <div className="gp-grp__h">
                {movable ? <button {...dnd.grip('blocks', grp.k, blocks.length, `strip-${sec}`, p.nameOf(sec))}>⋮⋮</button> : null}
                <i className="gp-dot" style={{ background: p.colorOf(sec) }} />
                {p.nameOf(sec)} · {range(grp.idx)}
              </div>
              <div className="gp-grp__pp" data-sort-scope="">
                {fixed.length ? (
                  <div className="gp-grp__cat">
                    <div className="gp-grp__ch">
                      <span>{fixed.some((i) => isPresentation(cat.pages[i].layout)) ? 'Présentation' : fixed.length > 1 ? 'Pages libres' : 'Page libre'}</span>
                    </div>
                    <div className="gp-grp__pp">{fixed.map((i) => thumb(i + 2, String(i + 3)))}</div>
                  </div>
                ) : null}
                {cats.map(({ x, k }) => (
                  <div key={String(x.c)} {...dnd.item(group, k)} className={`gp-grp__cat${dnd.isGhost(group, k) ? ' is-ghost' : ''}`}>
                    <div className="gp-grp__ch">
                      <button {...dnd.grip(group, k, nCats, `strip-${sec}-${x.c}`, p.catName(x.c))}>⋮⋮</button>
                      <span>{p.catName(x.c)}</span>
                    </div>
                    <div className="gp-grp__pp">{x.idx.map((i) => thumb(i + 2, String(i + 3)))}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        <div className="gp-grp is-locked">
          <div className="gp-grp__h">🔒 Marque</div>
          <div className="gp-grp__pp">
            {thumb(n - 2, String(n - 1))}
            {thumb(n - 1, String(n))}
          </div>
        </div>
      </div>
      <div className="wz-foot">
        <button type="button" className="btn" onClick={() => p.setStep(2)}>
          ‹ Produits
        </button>
        <span className="wz-grow" />
        <span className="wz-note">{blocks.length ? 'Ajoutez la gamme suivante, ou passez à la mise en page finale' : 'Choisissez la première gamme'}</span>
        <span className="wz-grow" />
        <button type="button" className="btn" onClick={p.onFinal}>
          Mise en page finale
        </button>
        <button type="button" className="btn" onClick={() => p.setStep(4)} disabled={!blocks.length}>
          Validation ›
        </button>
      </div>
    </section>
  )
}

// --- a) La page de présentation d'une gamme (M2-2, M3) ------------------------------------------------

function PresentationEditor(
  p: GammesProps & {
    g: number
    gamme: CatalogueGamme | undefined
    presIdx: number
    onModel: (g: CatalogueGamme) => void
    onBack: () => void
    onNext: () => void
    onCats: () => void
    onRemove: () => void
    notice: ReactNode
  },
) {
  const { cat, doc, lang, g, gamme, presIdx } = p
  const own = cat.presentations?.[String(g)] ?? null
  const [pres, setPres] = useState<CataloguePresentation>(() => own ?? gamme?.presentation ?? api.presentationDefault())
  const dirty = useRef(false)
  const [sel, setSel] = useState<CataloguePresElement>('title')
  const [photo, setPhoto] = useState(0)
  const [picking, setPicking] = useState<'photo' | 'background' | null>(null)
  const [modelMsg, setModelMsg] = useState<string | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const color = gamme?.color ?? '#8D1D2C'
  const page = presIdx >= 0 ? cat.pages[presIdx] : null
  const docPage = doc && presIdx >= 0 ? doc.pages[presIdx + 2] : undefined
  // L'illustration de la gamme (son dessin de saison, `img/print/…`) : null quand la gamme n'en a pas.
  const drawing = docPage && docPage.kind === 'presentation' ? (docPage.drawing ?? null) : null
  const ink = pres.ink === 'encre' ? api.CATALOGUE_PRES_HEX.encre : color
  // Une présentation d'avant en « pleine » (une photo pleine page, texte sur un bandeau) : montrée comme 1 image en pleine
  // page ; elle garde son rendu tant qu'on ne touche ni au nombre d'images ni à leur place.
  const legacy = pres.layout === 'pleine'
  const shownLayout: CataloguePresLayout = legacy ? 'une' : pres.layout
  const shownPos: api.CataloguePresPosition = legacy ? 'pleine' : pres.position

  // Une gamme sans présentation à elle dans ce catalogue : celle qu'on voit ici (le modèle, sinon celle d'office) est
  // enregistrée dès l'ouverture — le document imprime alors ce que montre l'éditeur.
  useEffect(() => {
    if (!own) {
      dirty.current = true
      setPres(gamme?.presentation ?? api.presentationDefault())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Enregistré tout seul, 0,6 s après la dernière modification.
  useEffect(() => {
    if (!dirty.current) return
    const t = window.setTimeout(() => p.change({ presentations: { [String(g)]: api.presentationInput(pres) } }), 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pres])
  const edit = (fn: (x: CataloguePresentation) => CataloguePresentation) => {
    dirty.current = true
    setPres((x) => fn(x))
  }
  const setText = (el: CataloguePresElement, patch: Partial<api.CataloguePresText>) => edit((x) => ({ ...x, [el]: { ...x[el], ...patch } }))

  // L'aperçu imprimé en direct : le document, la page de présentation recomposée ici avec les réglages en cours.
  const preview: CatalogueDocument | null = useMemo(() => {
    if (!doc || !docPage || docPage.kind !== 'presentation') return null
    const gTitle = gamme?.title ?? docPage.title
    const design = docDesign(pres, color, lang, gTitle, (lang === 'nl' ? page?.textNl || page?.text : page?.text) ?? '', drawing)
    const pagesOut = doc.pages.map((x, i) => (i === presIdx + 2 && x.kind === 'presentation' ? { ...x, design, title: design.title.text, text: design.text.text } : x))
    return { ...doc, pages: pagesOut }
  }, [doc, docPage, pres, color, lang, gamme?.title, page, presIdx, drawing])

  const slots = api.CATALOGUE_PRES_SLOTS[pres.layout]
  const scale = cat.format === 'A4' ? 210 / 148 : 1
  const dpi = (i: number): number | null => {
    const ph = pres.photos[i]
    const w = ph?.image?.width
    // L'illustration de la gamme est un trait (un masque peint) : jamais d'alerte de résolution.
    if (!ph || ph.source === 'illustration' || !w) return null
    const table = legacy || pres.position === 'haut' || pres.position === 'bas' ? SLOT_MM : pres.position === 'pleine' ? SLOT_MM_FULL : SLOT_MM_SIDE
    const mm = (table[pres.layout][i] ?? table[pres.layout][0]) * scale
    return Math.round((w / (mm / 25.4)) * (100 / ph.zoom))
  }
  const lowDpi = pres.photos.slice(0, slots).filter((_, i) => (dpi(i) ?? 999) < 300).length

  function addPhoto(asset: MediaAsset) {
    const image = { url: asset.webUrl, width: asset.width, height: asset.height }
    if (picking === 'background') {
      edit((x) => ({ ...x, background: { ...x.background, kind: 'photo', mediaId: Number(asset.id), image } }))
    } else {
      edit((x) => ({ ...x, photos: [...x.photos, { mediaId: Number(asset.id), x: 50, y: 50, zoom: 100, source: 'media' as const, image }].slice(0, 4) }))
      setPhoto(Math.min(pres.photos.length, 3))
    }
    setPicking(null)
  }
  function addIllustration() {
    edit((x) => ({ ...x, photos: [...x.photos, { mediaId: null, x: 50, y: 50, zoom: 100, source: 'illustration' as const, image: null }].slice(0, 4) }))
    setPhoto(Math.min(pres.photos.length, 3))
  }
  /** Le nombre d'images ou leur place : une présentation d'avant en « pleine » devient 1 image en pleine page. */
  function setArrangement(patch: { layout?: CataloguePresLayout; position?: api.CataloguePresPosition }) {
    edit((x) => ({ ...x, layout: patch.layout ?? (x.layout === 'pleine' ? 'une' : x.layout), position: patch.position ?? (x.layout === 'pleine' ? 'pleine' : x.position) }))
  }
  const usesDrawing = pres.background.kind === 'illustration' || pres.photos.slice(0, slots).some((ph) => ph.source === 'illustration')
  const drawThumb = () =>
    drawing ? (
      <span
        className="gp-draw"
        style={{ backgroundColor: ink, WebkitMaskImage: `url("${assetUrl(drawing)}")`, maskImage: `url("${assetUrl(drawing)}")` } as CSSProperties}
      />
    ) : (
      <span title="Pas d’illustration pour cette gamme">—</span>
    )
  async function upload(files: FileList | null) {
    for (const file of Array.from(files ?? []).slice(0, 4)) {
      try {
        const { media } = await api.uploadMedia(file, { name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Photo' })
        addPhoto(media)
      } catch (cause) {
        setModelMsg(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }
  function movePhoto(from: number, to: number) {
    edit((x) => {
      const list = [...x.photos]
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      return { ...x, photos: list }
    })
    setPhoto(to)
  }
  async function saveModel() {
    setModelMsg(null)
    try {
      const saved = await api.saveCatalogueGamme(g, { presentation: api.presentationInput(pres) })
      p.onModel(saved)
      setModelMsg(`✓ Modèle de « ${gamme?.title ?? g} » enregistré : les prochains catalogues partiront de cette présentation.`)
    } catch (cause) {
      setModelMsg(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const textBlock = (el: CataloguePresElement, label: string, multiline = false) => {
    const e = pres[el]
    const value = lang === 'nl' ? e.nl : e.fr
    const placeholder = el === 'title' ? (gamme?.title ?? '') : el === 'text' ? ((lang === 'nl' ? page?.textNl || page?.text : page?.text) ?? '') : ''
    const swatches = TEXT_COLORS.map(([c, l]) => [c, l, c === 'gamme' ? color : api.CATALOGUE_PRES_HEX[c]] as const)
    return (
      <div className={`gp-field${sel === el ? ' is-sel' : ''}`} onFocus={() => setSel(el)}>
        <div className="gp-lab">
          {label}
          <span className="wz-grow" />
          <small>{lang.toUpperCase()}{lang === 'nl' && !e.nl && e.fr ? ' · vide : le français s’imprime' : ''}</small>
        </div>
        {multiline ? (
          <textarea className="gp-in" rows={3} value={value} placeholder={placeholder} maxLength={400} onChange={(ev) => setText(el, { [lang]: ev.target.value })} />
        ) : (
          <input className="gp-in" value={value} placeholder={placeholder} maxLength={80} onChange={(ev) => setText(el, { [lang]: ev.target.value })} />
        )}
        <div className="gp-row">
          <Seg label={`Police · ${label}`} value={e.font} options={FONTS.map(([f, l]) => [f, <span key={f} style={{ fontFamily: api.CATALOGUE_COVER_FONTS.find((x) => x.id === f)?.css }}>{l}</span>])} onChange={(font) => setText(el, { font })} />
          <select className="gp-sel" aria-label={`Taille · ${label}`} value={e.size} onChange={(ev) => setText(el, { size: Number(ev.target.value) })}>
            {api.CATALOGUE_PRES_SIZES[el].map((s) => (
              <option key={s} value={s}>
                {s} pt
              </option>
            ))}
          </select>
        </div>
        <div className="gp-row">
          <Seg label={`Graisse · ${label}`} value={e.weight} options={WEIGHTS} onChange={(weight) => setText(el, { weight })} />
          <Seg label={`Alignement · ${label}`} value={e.align} options={ALIGNS} onChange={(align) => setText(el, { align })} />
        </div>
        <div className="gp-row gp-sws" role="group" aria-label={`Couleur · ${label}`}>
          {swatches.map(([c, l, hex]) => (
            <button key={c} type="button" className={`gp-sw${e.color === c ? ' is-on' : ''}`} style={{ background: hex }} title={l} aria-label={l} aria-pressed={e.color === c} onClick={() => setText(el, { color: c })} />
          ))}
        </div>
      </div>
    )
  }

  const size = doc ? FORMAT_MM[doc.catalogue.format] : FORMAT_MM.A5
  const W = 330
  return (
    <section className="wz-pan gp-main gp-main--pres">
      <div className="gp-head">
        <i className="gp-dot gp-dot--big" style={{ background: color }} title="La couleur de la gamme se règle dans la Charte des catalogues (Couverture), pour tous les catalogues" />
        <b className="gp-h2">{gamme?.title ?? `Gamme ${g}`}</b>
        <span className="wz-note">
          {presIdx >= 0 ? `p. ${presIdx + 3}` : ''} · {categoriesOf(cat.pages, cat.gammeBlocks ?? [], g).length} catégorie(s)
        </span>
        <span className="wz-grow" />
        <button type="button" className="gp-tab is-on" aria-current="step">
          <i>a</i> Présentation de la gamme
        </button>
        <button type="button" className="gp-tab" onClick={p.onCats}>
          <i>b</i> Mise en page des catégories
        </button>
      </div>
      <div className="gp-pres">
        <div className="gp-stage gp-stage--page">
          {preview ? (
            <span className="gp-mini gp-mini--big" style={{ width: W, height: (W * size.h) / size.w }}>
              <span style={{ zoom: W / (size.w * MM) }}>
                <CatalogueSheet doc={preview} index={presIdx + 2} mode="preview" />
              </span>
            </span>
          ) : (
            <p className="wz-note">Composition de la page…</p>
          )}
          <div className="gp-stage__cap">
            Page {presIdx + 3} · {cat.format} · page de gauche, face à la page {presIdx + 4}
            {page ? (
              <Seg
                label="Liste des produits"
                value={page.layout}
                options={[['presentation', 'Seule'], ['presentation_liste', '+ liste des produits']]}
                disabled={p.busy}
                onChange={(layout) => p.change({ pages: toSend(cat.pages.map((x, i) => (i === presIdx ? { ...x, layout } : x))) })}
              />
            ) : null}
          </div>
        </div>
        <div className="gp-panel">
          <div className="gp-lab gp-lab--src">
            Images · {pres.photos.length}
            <span className="wz-grow" />
            <button
              type="button"
              className="btn btn--sm"
              onClick={addIllustration}
              disabled={pres.photos.length >= 4 || !drawing}
              title={drawing ? 'Le dessin de saison de la gamme, au trait : il se cadre comme une photo, sans souci de résolution' : 'Pas d’illustration (dessin de saison) pour cette gamme'}
            >
              Illustration de la gamme
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setPicking('photo')} disabled={pres.photos.length >= 4}>
              Médiathèque
            </button>
            <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={pres.photos.length >= 4}>
              Importer
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(ev) => { void upload(ev.target.files); ev.target.value = '' }} />
          </div>
          <div className="gp-photos">
            {pres.photos.map((ph, i) => (
              <div
                key={`${ph.source}-${ph.mediaId ?? 'ill'}-${i}`}
                className={`gp-ph${i === photo ? ' is-on' : ''}${i >= slots ? ' is-out' : ''}${ph.source === 'illustration' ? ' gp-ph--draw' : ''}`}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => { if (drag !== null) e.preventDefault() }}
                onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) movePhoto(drag, i); setDrag(null) }}
                onClick={() => setPhoto(i)}
                title={i >= slots ? 'Hors de la disposition choisie : pas imprimée' : `Case ${i + 1} · glisser pour changer de case`}
              >
                {ph.source === 'illustration' ? drawThumb() : ph.image?.url ? <img src={ph.image.url} alt="" /> : <span>?</span>}
                <span className="gp-ph__n">{i + 1}</span>
                {(dpi(i) ?? 999) < 300 && i < slots ? <span className="gp-ph__warn">⚠ {dpi(i)} dpi</span> : null}
                <button type="button" className="gp-ph__x" aria-label="Retirer la photo" onClick={(e) => { e.stopPropagation(); edit((x) => ({ ...x, photos: x.photos.filter((_, k) => k !== i) })); setPhoto(0) }}>
                  ×
                </button>
              </div>
            ))}
            {pres.photos.length < 4 ? (
              <button type="button" className="gp-ph gp-ph--add" onClick={() => setPicking('photo')} aria-label="Ajouter une photo">
                ＋
              </button>
            ) : null}
          </div>
          <div className="gp-lab">Nombre d’images</div>
          <div className="gp-lays gp-lays--3" role="group" aria-label="Nombre d’images">
            {PRES_LAYOUTS.map(([l, label]) => (
              <button key={l} type="button" className={`gp-lay${shownLayout === l ? ' is-on' : ''}`} aria-pressed={shownLayout === l} onClick={() => setArrangement({ layout: l })}>
                <span className={`gp-lay__ic gp-lay__ic--${l}`} aria-hidden="true">
                  {Array.from({ length: api.CATALOGUE_PRES_SLOTS[l] }, (_, k) => <i key={k} />)}
                </span>
                {label}
              </button>
            ))}
          </div>
          <div className="gp-lab">Place des images</div>
          <div className="gp-lays gp-lays--5" role="group" aria-label="Place des images par rapport au texte">
            {PRES_POSITIONS.map(([pos, label]) => (
              <button key={pos} type="button" className={`gp-lay${shownPos === pos ? ' is-on' : ''}`} aria-pressed={shownPos === pos} onClick={() => setArrangement({ position: pos })} title={pos === 'pleine' ? 'Les images couvrent toute la page, le texte par-dessus' : `Images ${pos === 'haut' ? 'en haut' : pos === 'bas' ? 'en bas' : pos === 'gauche' ? 'à gauche' : 'à droite'}, texte ${pos === 'haut' ? 'dessous' : pos === 'bas' ? 'dessus' : pos === 'gauche' ? 'à droite' : 'à gauche'}`}>
                <span className={`gp-pos gp-pos--${pos}`} aria-hidden="true">
                  <i />
                  <b />
                </span>
                {label}
              </button>
            ))}
          </div>
          {shownPos === 'pleine' && !legacy ? (
            <div className="gp-field">
              <div className="gp-row">
                <Seg label="Place du texte" value={pres.textPlace} options={TEXT_PLACES} onChange={(textPlace) => edit((x) => ({ ...x, textPlace }))} />
              </div>
              <label className="gp-range">
                <span>Voile</span>
                <input type="range" min={0} max={80} value={pres.background.veil} onChange={(ev) => { const v = Number(ev.target.value); edit((x) => ({ ...x, background: { ...x.background, veil: v } })) }} />
                <b>{pres.background.veil}%</b>
              </label>
            </div>
          ) : null}
          {usesDrawing ? (
            <div className="gp-row">
              <span className="gp-sub">Trait de l’illustration</span>
              <Seg label="Trait de l’illustration" value={pres.ink} options={INKS} onChange={(inkName) => edit((x) => ({ ...x, ink: inkName }))} />
            </div>
          ) : null}
          {pres.photos[photo] && photo < slots ? (
            <div className="gp-crop">
              <div className="gp-lab">
                Recadrer · case {photo + 1}
                <span className="wz-grow" />
                <button type="button" className="linklike" onClick={() => edit((x) => ({ ...x, photos: x.photos.map((ph, k) => (k === photo ? { ...ph, x: 50, y: 50, zoom: 100 } : ph)) }))}>
                  Recentrer
                </button>
              </div>
              {(['x', 'y', 'zoom'] as const).map((k) => (
                <label key={k} className="gp-range">
                  <span>{k === 'x' ? 'Horizontal' : k === 'y' ? 'Vertical' : 'Zoom'}</span>
                  <input
                    type="range"
                    min={k === 'zoom' ? 100 : 0}
                    max={k === 'zoom' ? 300 : 100}
                    value={pres.photos[photo][k]}
                    onChange={(ev) => {
                      const v = Number(ev.target.value)
                      edit((x) => ({ ...x, photos: x.photos.map((ph, i) => (i === photo ? { ...ph, [k]: v } : ph)) }))
                    }}
                  />
                  <b>{pres.photos[photo][k]}%</b>
                </label>
              ))}
            </div>
          ) : null}
          {lowDpi ? <p className="gp-warn">⚠ {lowDpi} photo{lowDpi > 1 ? 's' : ''} sous 300 dpi à cette taille : un avertissement, pas un blocage.</p> : null}
          {textBlock('title', 'Titre')}
          {textBlock('kicker', 'Accroche')}
          {textBlock('text', 'Texte', true)}
          <div className="gp-field">
            <div className="gp-lab">
              Fond de la page
              <span className="wz-grow" />
              <Seg
                label="Fond"
                value={pres.background.kind}
                options={drawing ? [['color', 'Couleur'], ['photo', 'Photo'], ['illustration', 'Illustration']] : [['color', 'Couleur'], ['photo', 'Photo']]}
                onChange={(kind) => (kind === 'photo' && !pres.background.mediaId ? setPicking('background') : edit((x) => ({ ...x, background: { ...x.background, kind } })))}
              />
            </div>
            <div className="gp-row gp-sws" role="group" aria-label="Couleur du fond">
              {BG_COLORS.map(([c, l]) => {
                const hex = c === 'gamme' ? color : c === 'gamme-pale' ? paleOf(color) : api.CATALOGUE_PRES_HEX[c]
                return (
                  <button key={c} type="button" className={`gp-sw gp-sw--bg${pres.background.color === c ? ' is-on' : ''}`} style={{ background: hex }} title={l} aria-label={l} aria-pressed={pres.background.color === c} onClick={() => edit((x) => ({ ...x, background: { ...x.background, color: c } }))} />
                )
              })}
            </div>
            {pres.background.kind === 'photo' || pres.background.kind === 'illustration' ? (
              <div className="gp-row">
                {pres.background.kind === 'illustration' ? (
                  <span className="gp-bgthumb gp-bgthumb--draw">{drawThumb()}</span>
                ) : pres.background.image?.url ? (
                  <img className="gp-bgthumb" src={pres.background.image.url} alt="" />
                ) : null}
                {pres.background.kind === 'photo' ? (
                  <button type="button" className="btn btn--sm" onClick={() => setPicking('background')}>
                    Changer la photo
                  </button>
                ) : null}
                <label className="gp-range">
                  <span>Voile</span>
                  <input type="range" min={0} max={80} value={pres.background.veil} onChange={(ev) => { const v = Number(ev.target.value); edit((x) => ({ ...x, background: { ...x.background, veil: v } })) }} />
                  <b>{pres.background.veil}%</b>
                </label>
              </div>
            ) : null}
          </div>
          <div className="gp-model">
            <button type="button" className="btn btn--sm" onClick={() => void saveModel()}>
              Enregistrer comme modèle de la gamme
            </button>
            <small>{gamme?.presentation ? 'Ce catalogue garde sa version ; le modèle sert aux prochains catalogues.' : 'Pas encore de modèle pour cette gamme.'}</small>
            {modelMsg ? <p className={modelMsg.startsWith('✓') ? 'wz-info' : 'error'}>{modelMsg}</p> : null}
          </div>
        </div>
      </div>
      {p.notice}
      <div className="wz-foot">
        <button type="button" className="btn" onClick={p.onBack}>
          ‹ Gammes
        </button>
        <button type="button" className="linklike gp-remove" onClick={p.onRemove}>
          Retirer cette gamme du catalogue
        </button>
        <span className="wz-grow" />
        <button type="button" className="btn btn--primary" onClick={p.onNext}>
          Suivant : ses catégories ›
        </button>
      </div>
      {picking ? <MediaPicker title={picking === 'background' ? 'Photo pleine page' : 'Photo de la présentation'} onClose={() => setPicking(null)} onPick={addPhoto} /> : null}
    </section>
  )
}

// --- b) La mise en page des catégories d'une gamme (M2-3) ---------------------------------------------

function CategoriesEditor(
  p: GammesProps & {
    dnd: Reorder
    sec: Section
    color: string
    name: string
    catName: (c: number | null) => string
    count: (sec: Section, c: number | null) => number
    isOk: boolean
    onPres: () => void
    onDone: () => void
    notice: ReactNode
  },
) {
  const { cat, doc, sec, busy, dnd } = p
  const blocks = cat.gammeBlocks ?? []
  const cats = categoriesOf(cat.pages, blocks, sec)
  const group = catsGroup(sec)
  const idxOfSection = cat.pages.map((_, i) => i).filter((i) => (isPresentation(cat.pages[i].layout) ? cat.pages[i].gamme === sec : sectionOf(cat.pages[i], blocks) === sec))

  /** Refait les pages d'une catégorie de la gamme : sa mise en page, au moins `nPages` pages, gabarit et en-tête. */
  function relay(c: number | null, wanted: { layout?: CatalogueLayout; nPages?: number; template?: CatalogueTemplate; header?: CatalogueHeader }) {
    const out = relayPages(cat.pages, blocks, sec, c, p.count(sec, c), wanted)
    if (out) p.change({ pages: out })
  }

  return (
    <section className="wz-pan gp-main">
      <div className="gp-head">
        <i className="gp-dot gp-dot--big" style={{ background: p.color }} />
        <b className="gp-h2">{p.name}</b>
        <span className="wz-note">
          {range(idxOfSection)} · {cats.length} catégorie{cats.length > 1 ? 's' : ''}
        </span>
        <span className="wz-grow" />
        {sec !== HORS ? (
          <>
            <button type="button" className="gp-tab is-done" onClick={p.onPres}>
              <i>✓</i> Présentation de la gamme
            </button>
            <button type="button" className="gp-tab is-on" aria-current="step">
              <i>b</i> Mise en page des catégories
            </button>
          </>
        ) : (
          <span className="wz-note">Sans page de présentation, avant les gammes</span>
        )}
      </div>
      <div className="gp-cats" data-sort-scope="">
        {cats.length === 0 ? <p className="wz-note">Aucune catégorie : cochez des produits de cette gamme à l’étape 2.</p> : null}
        {dnd.order(group, cats, (x) => String(x.c)).map(({ x, k }) => {
          const first = cat.pages[x.idx[0]]
          const layout = first.layout === 'pleine' && x.idx.length > 1 ? cat.pages[x.idx[1]].layout : first.layout
          const nb = p.count(sec, x.c)
          return (
            <div key={String(x.c)} {...dnd.item(group, k, 'y')} className={`gp-crow${dnd.isGhost(group, k) ? ' is-ghost' : ''}`}>
              <button {...dnd.grip(group, k, cats.length, `row-${sec}-${x.c}`, p.catName(x.c))}>⋮⋮</button>
              <span className="gp-crow__nm">
                {p.catName(x.c)}
                <small>
                  {nb} produit{nb > 1 ? 's' : ''} · {range(x.idx)}
                </small>
              </span>
              <Seg label="Pages" value={x.idx.length > 1 ? 2 : 1} options={[[1, '1 page'], [2, '2 pages']]} disabled={busy || nb < 2} onChange={(v) => relay(x.c, { nPages: v })} />
              <div className="gp-clays">
                {CAT_LAYOUTS.map((l) => (
                  <button key={l} type="button" className={`gp-clay${layout === l ? ' is-on' : ''}`} disabled={busy} onClick={() => relay(x.c, { layout: l })} title={LAYOUT_LABELS[l].label}>
                    <LayoutIcon layout={l} />
                    <span>{CAT_LABELS[l]}</span>
                  </button>
                ))}
              </div>
              <span className="gp-crow__opts">
                <select className="gp-sel" aria-label="Gabarit" value={first.template ?? 'A'} disabled={busy} onChange={(e) => relay(x.c, { template: e.target.value as CatalogueTemplate })}>
                  {(['A', 'B', 'C'] as CatalogueTemplate[]).map((t) => (
                    <option key={t} value={t}>
                      {t} · {TEMPLATE_LABELS.products[t].label}
                    </option>
                  ))}
                </select>
                <select className="gp-sel" aria-label="En-tête" value={first.header ?? 'titre'} disabled={busy} onChange={(e) => relay(x.c, { header: e.target.value as CatalogueHeader })}>
                  {api.CATALOGUE_HEADERS.map((h) => (
                    <option key={h} value={h}>
                      {HEADER_LABELS[h].label}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          )
        })}
      </div>
      <div className="gp-strip">
        <div className="gp-lab">
          La gamme dans le catalogue <span className="wz-grow" /> <small>{range(idxOfSection)}</small>
        </div>
        <div className="gp-strip__pp">
          {doc
            ? idxOfSection.map((i) => (
                <button key={i} type="button" className="gp-th" onClick={() => p.onZoom(i + 2)} onDoubleClick={() => p.openDetail(i)} title="Un clic : en grand · double-clic : ses réglages">
                  <Mini doc={doc} index={i + 2} width={112} />
                  <span>{i + 3}</span>
                </button>
              ))
            : null}
        </div>
      </div>
      {p.notice}
      <div className="wz-foot">
        {sec !== HORS ? (
          <button type="button" className="btn" onClick={p.onPres}>
            ‹ Présentation
          </button>
        ) : (
          <button type="button" className="btn" onClick={p.onDone}>
            ‹ Gammes
          </button>
        )}
        <span className="wz-grow" />
        <button type="button" className="btn btn--primary" onClick={p.onDone}>
          {sec === HORS ? 'Terminé' : p.isOk ? 'Gamme validée ✓' : 'Valider la gamme ✓'}
        </button>
      </div>
    </section>
  )
}

// --- La mise en page finale (M1) ------------------------------------------------------------------------

function FinalView(
  p: GammesProps & {
    alert: ReactNode
    dnd: Reorder
    gammes: CatalogueGamme[]
    colorOf: (s: Section) => string
    nameOf: (s: Section) => string
    catName: (c: number | null) => string
    onOpen: (s: Section) => void
  },
) {
  const { cat, doc, busy, dnd } = p
  const blocks = cat.gammeBlocks ?? []
  const [mode, setMode] = useState<'gammes' | 'doubles'>('gammes')
  const [notice, setNotice] = useState<string | null>(null)
  const n = cat.pageCount
  const inner = n - BRAND_PAGES
  const used = cat.pages.filter((x) => !isSpacer(x)).length
  const grps = groups(cat.pages, blocks)

  function setCount(nb: CataloguePageCount) {
    if (nb - BRAND_PAGES < used) {
      setNotice(`À ${nb} pages, les gammes ne tiennent plus : retirez une gamme ou des produits, ou choisissez des mises en page plus denses.`)
      return
    }
    setNotice(null)
    p.change({ pageCount: nb })
  }

  const W = 74
  const pageThumb = (i: number, extra?: ReactNode) => (
    <button key={i} type="button" className="gp-th" onClick={() => p.onZoom(i + 2)} onDoubleClick={() => p.openDetail(i)} title="Un clic : en grand · double-clic : ses réglages">
      {doc ? <Mini doc={doc} index={i + 2} width={W} /> : null}
      <span>
        {i + 3}
        {extra}
      </span>
    </button>
  )
  const brand = (a: number, b: number, label: string) => (
    <div className="gp-blk is-locked">
      <div className="gp-blk__h">🔒 {label}</div>
      <div className="gp-blk__pp">
        {[a, b].map((j) => (
          <span key={j} className="gp-th">
            {doc ? <Mini doc={doc} index={j} width={W} /> : null}
            <span>{j + 1}</span>
          </span>
        ))}
      </div>
    </div>
  )
  const spreadList: Array<[number | null, number | null]> = [[null, 0]]
  for (let i = 1; i < n - 1; i += 2) spreadList.push([i, i + 1])
  spreadList.push([n - 1, null])

  return (
    <div className="gp gp--final">
      <section className="wz-pan gp-main">
        <div className="gp-head">
          <span className="wz-kick">Mise en page finale · par gamme</span>
          <span className="wz-note">
            {n} pages {cat.format}
          </span>
          <span className="wz-grow" />
          <Seg label="Vue" value={mode} options={[['gammes', 'Par gamme'], ['doubles', 'Doubles pages']]} onChange={setMode} />
        </div>
        {p.alert}
        {mode === 'gammes' ? (
          <div className="gp-blks" data-sort-scope="">
            {brand(0, 1, 'Marque')}
            {orderedGroups(grps, blocks, dnd).map((grp) => {
              if (grp.sec === 'libre') {
                return (
                  <div key={`l${grp.idx[0]}`} className="gp-blk is-free">
                    <div className="gp-blk__h">{grp.idx.length > 1 ? 'Pages libres' : 'Page libre'} · {range(grp.idx)}</div>
                    <div className="gp-blk__pp">{grp.idx.map((i) => pageThumb(i))}</div>
                  </div>
                )
              }
              const sec = grp.sec
              const k = grp.k
              const movable = typeof sec === 'number' && k >= 0
              const group = catsGroup(sec)
              const nCats = categoriesOf(cat.pages, blocks, sec).length
              const cats = orderedCats(cat.pages, blocks, sec, dnd).filter(({ x }) => x.idx.some((i) => grp.idx.includes(i)))
              return (
                <div
                  key={`${sec}-${grp.idx[0]}`}
                  {...(movable ? dnd.item('blocks', k) : {})}
                  className={`gp-blk${movable && dnd.isGhost('blocks', k) ? ' is-ghost' : ''}${sec === HORS ? ' is-hors' : ''}`}
                  style={{ borderLeftColor: p.colorOf(sec) }}
                >
                  <div className="gp-blk__h">
                    {movable ? <button {...dnd.grip('blocks', k, blocks.length, `final-${sec}`, p.nameOf(sec))}>⋮⋮</button> : null}
                    <i className="gp-dot" style={{ background: p.colorOf(sec) }} />
                    <button type="button" className="gp-blk__nm" onClick={() => p.onOpen(sec)}>
                      {p.nameOf(sec)}
                    </button>
                    <span className="wz-note">{range(grp.idx)}</span>
                    {movable ? (
                      <>
                        <button type="button" className="wz-mv" disabled={k === 0 || busy} onClick={() => dnd.move('blocks', k, k - 1)} aria-label={`Avancer « ${p.nameOf(sec)} »`}>
                          ‹
                        </button>
                        <button type="button" className="wz-mv" disabled={k === blocks.length - 1 || busy} onClick={() => dnd.move('blocks', k, k + 1)} aria-label={`Reculer « ${p.nameOf(sec)} »`}>
                          ›
                        </button>
                      </>
                    ) : null}
                  </div>
                  <div className="gp-blk__pp" data-sort-scope="">
                    {grp.idx
                      .filter((i) => isSpacer(cat.pages[i]) || isPresentation(cat.pages[i].layout))
                      .map((i) => (
                        <div key={i} className="gp-blk__cat">
                          <small>{isPresentation(cat.pages[i].layout) ? 'Présentation' : 'Page libre'}</small>
                          <div className="gp-blk__cpp">{pageThumb(i)}</div>
                        </div>
                      ))}
                    {cats.map(({ x, k: ck }) => (
                      <div key={String(x.c)} {...dnd.item(group, ck)} className={`gp-blk__cat is-cat${dnd.isGhost(group, ck) ? ' is-ghost' : ''}`}>
                        <span className="gp-blk__ch">
                          <button {...dnd.grip(group, ck, nCats, `final-${sec}-${x.c}`, p.catName(x.c))}>⋮⋮</button>
                          <small>{p.catName(x.c)}</small>
                        </span>
                        <div className="gp-blk__cpp">{x.idx.map((i) => pageThumb(i))}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {brand(n - 2, n - 1, 'Marque')}
          </div>
        ) : null}
        <div className="gp-lab">Le catalogue ouvert · doubles pages</div>
        <div className={`gp-spreads${mode === 'doubles' ? ' is-big' : ''}`}>
          {spreadList.map(([a, b]) => (
            <div key={`${a}-${b}`} className="gp-spread">
              <div className="gp-spread__pp">
                {a === null ? <span className="gp-spread__blank" style={{ width: mode === 'doubles' ? 120 : 64 }} /> : doc ? <Mini doc={doc} index={a} width={mode === 'doubles' ? 120 : 64} /> : null}
                {b === null ? <span className="gp-spread__blank" style={{ width: mode === 'doubles' ? 120 : 64 }} /> : doc ? <Mini doc={doc} index={b} width={mode === 'doubles' ? 120 : 64} /> : null}
              </div>
              <span>{a === null ? 1 : b === null ? a + 1 : `${a + 1}-${b + 1}`}</span>
            </div>
          ))}
        </div>
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
            <small>Toujours par 2, dont 4 de la marque · {inner - used} page{inner - used > 1 ? 's' : ''} libre{inner - used > 1 ? 's' : ''}.</small>
          </div>
          <div className="wz-opt">
            <div className="wz-opt__t">
              Répartition
              <span className="wz-grow" />
              <button type="button" className="btn btn--sm" disabled={busy} onClick={() => p.change({ pages: [] })}>
                ↺ Répartir automatiquement
              </button>
            </div>
            <small>Refait les pages de chaque gamme dans l’ordre des blocs ; les présentations restent.</small>
          </div>
        </div>
        {notice ? <Erreur>{notice}</Erreur> : null}
        <div className="wz-foot">
          <button type="button" className="btn" onClick={() => p.onOpen(blocks[blocks.length - 1] ?? HORS)} disabled={!blocks.length}>
            ‹ Gammes
          </button>
          <span className="wz-grow" />
          <button type="button" className="btn" onClick={() => p.openDetail(null)}>
            Réglages page par page
          </button>
          <button type="button" className="btn btn--primary" onClick={() => p.setStep(4)}>
            Validation ›
          </button>
        </div>
      </section>
      <aside className="wz-pan gp-col">
        <div className="wz-kick">Le catalogue · {n} pages</div>
        <div className="gp-sum">
          <div className="gp-sum__h">
            🔒 Marque <span>p. 1-2</span>
          </div>
          {grps
            .filter((grp) => grp.sec !== 'libre')
            .map((grp) => {
              const sec = grp.sec as Section
              return (
                <div key={`${sec}-${grp.idx[0]}`} className="gp-sum__b">
                  <div className="gp-sum__h">
                    <i className="gp-dot" style={{ background: p.colorOf(sec) }} />
                    {p.nameOf(sec)}
                    <span>{range(grp.idx.filter((i) => !isSpacer(cat.pages[i])))}</span>
                  </div>
                  {sec !== HORS && grp.idx.some((i) => isPresentation(cat.pages[i].layout)) ? (
                    <div className="gp-sum__l">
                      Présentation <span>{grp.idx.filter((i) => isPresentation(cat.pages[i].layout)).map((i) => i + 3).join(', ')}</span>
                    </div>
                  ) : null}
                  {categoriesOf(cat.pages, blocks, sec).map((x) => (
                    <div key={String(x.c)} className="gp-sum__l">
                      {p.catName(x.c)} <span>{range(x.idx).replace('p. ', '')}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          {inner - used ? (
            <div className="gp-sum__h gp-sum__free">
              Pages libres <span>{inner - used}</span>
            </div>
          ) : null}
          <div className="gp-sum__h">
            🔒 Marque <span>p. {n - 1}-{n}</span>
          </div>
        </div>
      </aside>
    </div>
  )
}

/** Ce qui décide d'un catalogue d'avant les gammes : ses gammes de départ (présentations, sinon source), à proposer. */
export function initialBlocks(cat: api.Catalogue): number[] {
  const fromPages = cat.pages.filter((x) => isPresentation(x.layout) && x.gamme != null).map((x) => x.gamme as number)
  const fromSource = cat.source.kind === 'gamme' ? (cat.source.refs ?? []).map(Number).filter((x) => x > 0) : []
  return [...new Set([...fromPages, ...fromSource])].slice(0, 8)
}

export const sectionStyle = (color: string): CSSProperties => ({ ['--gc' as string]: color }) as CSSProperties
