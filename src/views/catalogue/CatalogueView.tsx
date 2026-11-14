import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as api from '../../lib/api/module'
import type {
  Catalogue,
  CatalogueBrandPage,
  CatalogueCharter,
  CatalogueCover,
  CatalogueDocument,
  CatalogueLang,
  CatalogueLayout,
  CataloguePageCount,
  CatalogueSourceKind,
  CatalogueTemplate,
  WebshopProducts,
} from '../../lib/api/module'
import { TfBuddyError } from '../../lib/api/http'
import { useAsync } from '../../lib/useAsync'
import { openPrintWindow } from '../../lib/print'
import { CatalogueSheet, FORMAT_MM, HEADER_LABELS, LAYOUT_LABELS, TEMPLATE_LABELS, catalogueCss, formatCents, isPresentation, sheetSize } from './CataloguePages'
import type { CatalogueSheetMode } from './CataloguePages'
import './catalogue.css'

/**
 * Les catalogues produits de la marque : prix du webshop, gammes (Noël, Saint-Nicolas…).
 *
 * Trois écrans : la liste (et « Nouveau catalogue » : une gamme du webshop, une campagne du
 * Marketing, ou des produits choisis un à un ; 8 à 16 pages, par 2), l'éditeur (produits à cocher,
 * nombre de pages, A5/A4, trois mises en page, version générale ou par boutique, FR/NL), et la
 * Charte des catalogues (logo, couvertures par gamme, page 2, avant-dernière et dernière pages,
 * couleurs) — les quatre pages que les franchisés ne peuvent pas changer quand ils font le leur
 * dans le dashboard magasin.
 *
 * L'API compose chaque version (`…/document`) : produits, prix de la boutique, couverture et
 * dernière page de la charte. L'écran met en page et imprime par le moteur des brochures.
 */

type Screen = { kind: 'list' } | { kind: 'editor'; id: number } | { kind: 'charter' }

const MM = 96 / 25.4

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const STATUS_LABELS: Record<api.CatalogueStatus, string> = { brouillon: 'brouillon', pret: 'PDF prêt', imprime: 'imprimé' }

const SOURCE_LABELS: Record<CatalogueSourceKind, string> = { gamme: 'Gamme', campagne: 'Campagne', choix: 'Au choix' }

/**
 * Le nombre de pages, toujours par 2 (client : « rajouter une page, c'est toujours par 2 ») : de 8 à
 * 16, dont 4 de la marque (1, 2, avant-dernière, dernière). « ＋ 2 pages » ajoute deux pages
 * intérieures vides en fin ; « − 2 pages » retire les deux dernières (refusé si elles portent quelque chose).
 */
function PageCountChoice({ value, onChange, disabled = false }: { value: CataloguePageCount; onChange: (count: CataloguePageCount) => void; disabled?: boolean }) {
  const counts = api.CATALOGUE_PAGE_COUNTS
  const at = counts.indexOf(value)
  const less = at > 0 ? counts[at - 1] : null
  const more = at >= 0 && at < counts.length - 1 ? counts[at + 1] : null
  return (
    <span className="bro-seg catv-pagecount" role="group" aria-label="Nombre de pages">
      <button type="button" disabled={disabled || less === null} title={less === null ? `${counts[0]} pages au moins` : `Retirer les deux dernières pages intérieures (${less} pages)`} onClick={() => less !== null && onChange(less)}>
        − 2 pages
      </button>
      <span className="is-on catv-pagecount__n" title={`${value - api.CATALOGUE_BRAND_PAGES} pages de produits + 4 pages de la marque`}>
        {value} pages
      </span>
      <button type="button" disabled={disabled || more === null} title={more === null ? `${counts[counts.length - 1]} pages au plus` : `Ajouter deux pages intérieures vides en fin (${more} pages)`} onClick={() => more !== null && onChange(more)}>
        ＋ 2 pages
      </button>
    </span>
  )
}

export default function CatalogueView() {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })

  if (screen.kind === 'editor') return <Editor id={screen.id} onBack={() => setScreen({ kind: 'list' })} />
  if (screen.kind === 'charter') return <CharterEditor onBack={() => setScreen({ kind: 'list' })} />
  return <CatalogueList onOpen={(id) => setScreen({ kind: 'editor', id })} onCharter={() => setScreen({ kind: 'charter' })} />
}

// =================================================================================================
// Liste et création
// =================================================================================================

function CatalogueList({ onOpen, onCharter }: { onOpen: (id: number) => void; onCharter: () => void }) {
  const [owner, setOwner] = useState<'' | api.CatalogueOwner>('')
  const list = useAsync(() => api.listCatalogues(owner ? { owner } : {}), [owner])
  const shops = useAsync(() => api.listShops(), [])
  const [creating, setCreating] = useState(false)
  const createRef = useRef<HTMLDivElement>(null)

  const shopNames = useMemo(() => new Map((shops.data ?? []).map((shop) => [shop.id, shop.name])), [shops.data])

  return (
    <div className="catv">
      <div className="catv-toolbar">
        <span className="bro-seg" role="group" aria-label="Catalogues">
          {([['', 'Tous'], ['marque', 'De la marque'], ['boutique', 'Des franchisés']] as const).map(([value, label]) => (
            <button key={value} type="button" className={owner === value ? 'is-on' : ''} onClick={() => setOwner(value)}>
              {label}
            </button>
          ))}
        </span>
        <span className="catv-grow" />
        <button type="button" className="btn" onClick={onCharter}>
          Charte des catalogues (couverture, dernière page)
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setCreating(true)
            window.setTimeout(() => createRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
          }}
        >
          ＋ Nouveau catalogue
        </button>
      </div>

      <div ref={createRef}>
        <NewCatalogue open={creating} onOpen={() => setCreating(true)} onCreated={onOpen} />
      </div>

      <section className="card catv-recent">
        <h2>Catalogues récents</h2>
        {list.error ? <p className="error">{list.error}</p> : null}
        {list.loading && !list.data ? <p className="muted">Lecture des catalogues…</p> : null}
        {list.data && list.data.items.length === 0 ? <p className="muted">Aucun catalogue pour l’instant.</p> : null}
        {list.data && list.data.items.length > 0 ? (
          <div className="table-scroll">
            <table className="catv-table">
              <thead>
                <tr>
                  <th>Catalogue</th>
                  <th>Par</th>
                  <th>Source</th>
                  <th>Pages</th>
                  <th>Boutiques</th>
                  <th>État</th>
                  <th aria-label="Ouvrir" />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((cat) => (
                  <tr key={cat.id}>
                    <td>{cat.title}</td>
                    <td>{cat.owner === 'marque' ? 'Marque' : `${cat.shop?.name ?? 'Boutique'} (franchisé)`}</td>
                    <td>
                      <span className="bro-tag">
                        {cat.source.kind === 'choix' ? `Au choix · ${cat.productCount} produits` : `${cat.source.label ?? SOURCE_LABELS[cat.source.kind]}`}
                      </span>
                    </td>
                    <td>{cat.pageCount}</td>
                    <td>
                      {cat.owner === 'boutique'
                        ? cat.shop?.name
                        : cat.shopIds.length
                          ? `${cat.shopIds.length} · ${cat.langs.map((lang) => lang.toUpperCase()).join(' + ')}`
                          : `Générale · ${cat.langs.map((lang) => lang.toUpperCase()).join(' + ')}`}
                      {cat.owner === 'marque' && cat.shopIds.length ? (
                        <small className="catv-subt">{cat.shopIds.map((id) => shopNames.get(id) ?? `#${id}`).join(', ')}</small>
                      ) : null}
                    </td>
                    <td>
                      <span className={`catv-state catv-state--${cat.status}`}>
                        {STATUS_LABELS[cat.status]}
                        {cat.status === 'imprime' && cat.printQty ? ` · ${cat.printQty} ex.` : ''}
                      </span>
                    </td>
                    <td className="catv-right">
                      <button type="button" className="btn btn--sm" onClick={() => onOpen(cat.id)}>
                        Ouvrir ›
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function NewCatalogue({ open, onOpen, onCreated }: { open: boolean; onOpen: () => void; onCreated: (id: number) => void }) {
  const webshop = useAsync<WebshopProducts | null>(() => (open ? api.getWebshopProducts([]) : Promise.resolve(null)), [open])
  const campaigns = useAsync(() => (open ? api.listCampaigns() : Promise.resolve([])), [open])
  const [kind, setKind] = useState<CatalogueSourceKind>('gamme')
  // Une ou plusieurs gammes : leurs produits se cumulent.
  const [choisies, setChoisies] = useState<number[]>([])
  const [campaign, setCampaign] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [pageCount, setPageCount] = useState<CataloguePageCount>(8)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const gammes = webshop.data?.gammes ?? []
  const countIn = (id: number) => (webshop.data?.products ?? []).filter((product) => product.gammes.includes(id)).length
  const sorted = [...(campaigns.data ?? [])].sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? ''))

  useEffect(() => {
    if (!choisies.length && gammes.length) setChoisies([gammes[0].id])
  }, [choisies.length, gammes])
  const basculer = (id: number) => setChoisies((l) => (l.includes(id) ? l.filter((x) => x !== id) : l.length >= 8 ? l : [...l, id]))
  const nomsChoisis = choisies.map((id) => gammes.find((g) => g.id === id)?.name ?? '').filter(Boolean)
  const produitsChoisis = (webshop.data?.products ?? []).filter((product) => product.gammes.some((id) => choisies.includes(id))).length

  const suggestion =
    kind === 'gamme' ? `${nomsChoisis.join(' + ') || 'Gamme'} ${new Date().getFullYear()} — catalogue du réseau`
    : kind === 'campagne' ? `${sorted.find((c) => c.id === campaign)?.name ?? 'Campagne'} — catalogue`
    : 'Catalogue — produits choisis'

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const created = await api.createCatalogue({
        title: title.trim() || suggestion,
        pageCount,
        source: kind === 'choix' ? { kind } : kind === 'gamme' ? { kind, ref: choisies.length === 1 ? choisies[0] : choisies } : { kind, ref: campaign ?? 0 },
      })
      onCreated(created.id)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const options: Array<{ kind: CatalogueSourceKind; head: string; title: string; text: string; tag: string | null; drawing: string }> = [
    {
      kind: 'gamme',
      head: kind === 'gamme' && choisies.length ? (choisies.length > 1 ? `${choisies.length} gammes` : nomsChoisis[0] ?? 'Gamme') : 'Gamme',
      title: 'Une ou plusieurs gammes du webshop',
      text: `Gammes lues au webshop${gammes.length ? ` : ${gammes.map((g) => g.name).join(' · ')}` : ''}. Les produits et leurs prix web arrivent d’office.`,
      tag: choisies.length && webshop.data ? `${produitsChoisis} produits` : null,
      drawing: 'img/cake-slice.png',
    },
    {
      kind: 'campagne',
      head: 'Campagne',
      title: 'Une campagne du Marketing',
      text: 'Les produits de l’offre de la campagne (comme les brochures), ses boutiques en versions.',
      tag: campaign !== null ? `« ${sorted.find((c) => c.id === campaign)?.name ?? ''} »` : null,
      drawing: 'img/croissant.png',
    },
    {
      kind: 'choix',
      head: 'Au choix',
      title: 'Produits choisis un à un',
      text: 'Tout le catalogue du webshop : on coche les produits. C’est le mode des franchisés dans leur dashboard.',
      tag: webshop.data ? `${webshop.data.products.length} produits` : null,
      drawing: 'img/cookies.png',
    },
  ]

  return (
    <section className="card catv-new">
      <h2>Nouveau catalogue · d’où partent les produits</h2>
      <div className="catv-sources">
        {options.map((option) => (
          <button
            key={option.kind}
            type="button"
            className={`catv-source${open && kind === option.kind ? ' is-on' : ''}`}
            onClick={() => {
              onOpen()
              setKind(option.kind)
            }}
          >
            <span className="catv-source__head">
              <span>{option.head}</span>
              <img src={`${import.meta.env.BASE_URL}${option.drawing}`} alt="" />
            </span>
            <span className="catv-source__body">
              <span className="catv-source__title">
                {option.title}
                {open && kind === option.kind ? <span className="bro-tag bro-tag--stop">choisi</span> : null}
              </span>
              <span className="catv-source__text">{option.text}</span>
              {option.tag ? <span className="bro-tag">{option.tag}</span> : null}
            </span>
          </button>
        ))}
      </div>

      {open ? (
        <div className="catv-create">
          {kind === 'gamme' ? (
            <div className="catv-field catv-field--grow">
              <span>Gammes · une ou plusieurs ({choisies.length} choisie{choisies.length > 1 ? 's' : ''}, {produitsChoisis} produits)</span>
              {webshop.loading ? <span className="muted">Lecture du webshop…</span> : null}
              {webshop.error ? <span className="error">{webshop.error}</span> : null}
              {webshop.data && !gammes.length ? (
                <span className="muted">Le webshop ne donne aucune gamme active : partez d’une campagne ou de produits choisis.</span>
              ) : null}
              {gammes.length ? (
                <span className="catv-gammes">
                  {gammes.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`catv-gamme${choisies.includes(g.id) ? ' is-on' : ''}`}
                      aria-pressed={choisies.includes(g.id)}
                      onClick={() => basculer(g.id)}
                    >
                      <span className="catv-gamme__box" aria-hidden="true">{choisies.includes(g.id) ? '✓' : ''}</span>
                      <span>{g.name}</span>
                      <span className="catv-gamme__n">{countIn(g.id)} produits{g.from && g.to ? ` · ${g.from}–${g.to}` : ''}</span>
                    </button>
                  ))}
                </span>
              ) : null}
            </div>
          ) : null}
          {kind === 'campagne' ? (
            <label className="catv-field">
              <span>Campagne</span>
              <select value={campaign ?? ''} onChange={(event) => setCampaign(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Choisir une campagne…</option>
                {sorted.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.starts_on ? ` · ${c.starts_on.slice(8, 10)}/${c.starts_on.slice(5, 7)}/${c.starts_on.slice(0, 4)}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="catv-field">
            <span>Nombre de pages · dont 4 de la marque</span>
            <PageCountChoice value={pageCount} onChange={setPageCount} />
          </div>
          <label className="catv-field catv-field--grow">
            <span>Titre (interne)</span>
            <input value={title} placeholder={suggestion} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || (kind === 'gamme' && !choisies.length) || (kind === 'campagne' && campaign === null)}
            onClick={() => void create()}
          >
            {busy ? 'Création…' : 'Créer le catalogue'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </div>
      ) : null}
    </section>
  )
}

// =================================================================================================
// Éditeur
// =================================================================================================

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z" />
    </svg>
  )
}

function Editor({ id, onBack }: { id: number; onBack: () => void }) {
  const loaded = useAsync(() => api.getCatalogue(id), [id])
  const shops = useAsync(() => api.listShops(), [])

  if (loaded.error) {
    return (
      <div className="catv">
        <button type="button" className="linklike" onClick={onBack}>
          ‹ Catalogues
        </button>
        <p className="error">{loaded.error}</p>
      </div>
    )
  }
  if (!loaded.data || shops.loading) return <p className="muted">Ouverture du catalogue…</p>
  return <EditorBody key={loaded.data.id} initial={loaded.data} shops={shops.data ?? []} onBack={onBack} />
}

function EditorBody({ initial, shops, onBack }: { initial: Catalogue; shops: api.Shop[]; onBack: () => void }) {
  const [cat, setCat] = useState<Catalogue>(initial)
  const [lang, setLang] = useState<CatalogueLang>(initial.langs[0] ?? 'fr')
  const [versionShop, setVersionShop] = useState<number | null>(initial.owner === 'boutique' ? null : null)
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [allWebshop, setAllWebshop] = useState(initial.source.kind === 'choix')
  const [save, setSave] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ status: 'idle' })
  const [printError, setPrintError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const webshop = useAsync(() => api.getWebshopProducts(cat.owner === 'boutique' && cat.shop ? [cat.shop.id] : cat.shopIds), [cat.shopIds.join(','), cat.owner])
  const doc = useAsync(() => api.getCatalogueDocument(cat.id, lang, versionShop), [cat.id, lang, versionShop, revision])

  // --- enregistrement : chaque modification part tout de suite, la composition suit ---
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  function change(patch: api.CatalogueUpdate) {
    setCat((current) => ({ ...current, ...patch }))
    setSave({ status: 'saving' })
    queue.current = queue.current
      .then(() => api.updateCatalogue(cat.id, patch))
      .then((saved) => {
        setCat(saved)
        setSave({ status: 'saved' })
        setRevision((value) => value + 1)
      })
      .catch((cause: unknown) => setSave({ status: 'error', text: message(cause) }))
  }

  const products = webshop.data?.products ?? []
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const categories = useMemo(() => new Map((webshop.data?.categories ?? []).map((c) => [c.id, c])), [webshop.data])
  const shopName = (shopId: number) => shops.find((shop) => shop.id === shopId)?.name ?? `#${shopId}`
  const versionShops = cat.owner === 'boutique' ? [] : cat.shopIds
  const inCatalogue = new Set(cat.products.map((row) => row.id))

  // Les produits proposés : ceux du catalogue (dans son ordre), puis — au choix — le reste du webshop.
  const rows = [
    ...cat.products.map((row) => ({ row, product: byId.get(row.id) ?? null })),
    ...(allWebshop ? products.filter((product) => !inCatalogue.has(product.id)).map((product) => ({ row: { id: product.id, on: false }, product })) : []),
  ]
  const needle = search.trim().toLowerCase()
  const visible = rows.filter(({ product, row }) => !needle || (product?.name ?? String(row.id)).toLowerCase().includes(needle))
  const groups = new Map<string, typeof visible>()
  for (const entry of visible) {
    const key = entry.product?.categoryId != null ? (categories.get(entry.product.categoryId)?.name ?? 'Autres') : entry.product ? 'Autres' : 'Absents du webshop'
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  const checked = cat.products.filter((row) => row.on).length
  // Les catégories du webshop qui ont des produits hors du catalogue : on peut les ajouter d'un coup.
  const addable = [...categories.values()]
    .map((c) => ({ c, ids: products.filter((product) => product.categoryId === c.id && !inCatalogue.has(product.id)).map((product) => product.id) }))
    .filter(({ ids }) => ids.length > 0)
    .sort((a, b) => a.c.name.localeCompare(b.c.name, 'fr'))

  function toggleProduct(productId: number, on: boolean) {
    toggleProducts([productId], on)
  }
  /** Coche ou décoche plusieurs produits d'un coup (« toute la catégorie »). */
  function toggleProducts(ids: number[], on: boolean) {
    const wanted = new Set(ids)
    const next = cat.products.map((row) => (wanted.has(row.id) ? { ...row, on } : row))
    for (const id of ids) if (!cat.products.some((row) => row.id === id)) next.push({ id, on })
    change({ products: next })
  }

  /**
   * Ajoute une catégorie du webshop : ses produits cochés. Le serveur lui donne SA page (une page vide,
   * sinon +2 pages, 16 au plus) ; on dit ce qui s'est passé.
   */
  function addCategory(categoryId: number, name: string, ids: number[]) {
    const before = cat.pageCount
    const next = [...cat.products, ...ids.filter((id) => !cat.products.some((row) => row.id === id)).map((id) => ({ id, on: true }))]
    setSave({ status: 'saving' })
    queue.current = queue.current
      .then(() => api.updateCatalogue(cat.id, { products: next }))
      .then((saved) => {
        setCat(saved)
        const own = saved.pages.some((page) => !isPresentation(page.layout) && page.category === categoryId)
        setSave({
          status: 'saved',
          text: !own ? `« ${name} » : plus de place (${saved.pageCount} pages) — ses produits vont en « Notre sélection ».`
            : saved.pageCount > before ? `« ${name} » a sa page : 2 pages ajoutées (${saved.pageCount} pages).`
            : `« ${name} » a sa page.`,
        })
        setRevision((value) => value + 1)
      })
      .catch((cause: unknown) => setSave({ status: 'error', text: message(cause) }))
  }

  // Les catégories en accordéons : dépliées à l'ouverture celles qui ont un produit coché ; la
  // recherche déplie celles qui ont un résultat. Un clic sur l'en-tête déplie / replie.
  const [opened, setOpened] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (opened !== null || !webshop.data) return
    const start = new Set<string>()
    for (const [group, entries] of groups) if (entries.some(({ row }) => row.on)) start.add(group)
    setOpened(start)
  }, [opened, webshop.data, groups])
  const isOpen = (group: string) => (needle !== '' ? true : (opened?.has(group) ?? false))
  function flip(group: string) {
    setOpened((current) => {
      const next = new Set(current ?? [])
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  // --- pages ---
  const innerPages = cat.pages
  const docPages = doc.data?.pages ?? []
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  function movePage(from: number, to: number) {
    if (from === to) return
    const pages = [...innerPages]
    const [moved] = pages.splice(from, 1)
    pages.splice(to, 0, moved)
    change({ pages })
    setSelected(to)
  }
  function setAllLayouts(layout: CatalogueLayout) {
    change({ pages: innerPages.map((page) => (isPresentation(page.layout) ? page : { ...page, layout })) })
  }
  /** L'en-tête de toutes les pages de produits (les présentations ont le leur). */
  function setAllHeaders(header: api.CatalogueHeader) {
    change({ pages: innerPages.map((page) => (isPresentation(page.layout) ? page : { ...page, header })) })
  }
  /** Le gabarit de toutes les pages intérieures (chacune garde sa mise en page). */
  function setAllTemplates(template: CatalogueTemplate) {
    change({ pages: innerPages.map((page) => ({ ...page, template })) })
  }
  function setPage(index: number, patch: Partial<api.CataloguePageRow>) {
    change({ pages: innerPages.map((page, i) => (i === index ? { ...page, ...patch } : page)) })
  }
  // Les gammes proposées : celles du catalogue d'abord, puis les autres gammes du webshop.
  const allGammes = webshop.data?.gammes ?? []
  const refs = (cat.source.kind === 'gamme' ? (cat.source.refs?.length ? cat.source.refs : cat.source.ref ? [cat.source.ref] : []) : []).map(Number)
  const gammeOptions = [...refs.map((id) => allGammes.find((g) => g.id === id)).filter((g): g is api.WebshopGamme => !!g), ...allGammes.filter((g) => !refs.includes(g.id))]
  /** Changer la mise en page d'une page : une présentation prend une gamme (la sienne, sinon la première du catalogue). */
  function setLayout(index: number, layout: CatalogueLayout) {
    const page = innerPages[index]
    if (isPresentation(layout)) {
      const gamme = page.gamme ?? refs[0] ?? gammeOptions[0]?.id ?? null
      if (gamme === null) return
      setPage(index, { layout, gamme, category: null, filler: null, fillerMediaId: null })
    } else {
      setPage(index, { layout, text: undefined, textNl: undefined })
    }
  }
  const [fillerPicking, setFillerPicking] = useState(false)
  // Le nombre de pages : changer de format ajoute des pages vides ou retire celles de la fin — le
  // serveur refuse (CATALOGUE_PAGES_NOT_EMPTY) d'en retirer une qui porte des produits.
  function setPageCount(pageCount: CataloguePageCount) {
    if (pageCount === cat.pageCount) return
    setSelected(null)
    setSave({ status: 'saving' })
    queue.current = queue.current
      .then(() => api.updateCatalogue(cat.id, { pageCount }))
      .then((saved) => {
        setCat(saved)
        setSave({ status: 'saved' })
        setRevision((value) => value + 1)
      })
      .catch((cause: unknown) => {
        const text = message(cause)
        // 422 : une page à retirer porte des produits — on propose de répartir sur le nouveau format.
        const redistribute = cause instanceof TfBuddyError && cause.status === 422 && window.confirm(
          `${text}\n\nRépartir automatiquement les produits sur ${pageCount} pages (${pageCount - api.CATALOGUE_BRAND_PAGES} pages de produits) ?`,
        )
        if (redistribute) change({ pageCount, pages: [] })
        else setSave({ status: 'error', text })
      })
  }

  // --- aperçu ---
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(600)
  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const size = FORMAT_MM[cat.format]
  const zoom = Math.max(0.2, Math.min(0.75, (stageWidth - 40) / 2 / (size.w * MM)))

  // --- impression ---
  async function print(mode: CatalogueSheetMode, all: boolean) {
    setPrintError(null)
    const win = window.open('', '_blank')
    if (!win) {
      setPrintError('Le navigateur a bloqué la fenêtre d’impression : autorisez les fenêtres pour ce site, puis recommencez.')
      return
    }
    win.document.write('<p style="font-family:system-ui;padding:24px">Composition du catalogue…</p>')
    try {
      const versions: Array<{ lang: CatalogueLang; shop: number | null }> = all
        ? cat.langs.flatMap((l) => [{ lang: l, shop: null as number | null }, ...versionShops.map((s) => ({ lang: l, shop: s as number | null }))])
        : [{ lang, shop: versionShop }]
      const docs = await Promise.all(versions.map((v) => api.getCatalogueDocument(cat.id, v.lang, v.shop)))
      const container = document.createElement('div')
      const root = createRoot(container)
      flushSync(() =>
        root.render(
          <>
            {docs.flatMap((one, d) => one.pages.map((_, index) => <CatalogueSheet key={`${d}-${index}`} doc={one} index={index} mode={mode} />))}
          </>,
        ),
      )
      const markup = container.innerHTML
      root.unmount()
      const label = all ? `${docs.length} versions` : versionShop !== null ? shopName(versionShop) : 'générale'
      const failure = openPrintWindow({
        title: [cat.title, cat.format, label, all ? null : lang.toUpperCase(), mode === 'printer' ? 'imprimeur' : 'aperçu'].filter(Boolean).join(' – '),
        markup,
        css: catalogueCss(),
        size: sheetSize(cat.format, mode),
        pageClass: 'cat-sheet',
        target: win,
      })
      if (failure) setPrintError(failure)
    } catch (cause) {
      win.close()
      setPrintError(message(cause))
    }
  }

  const selectedPage = selected !== null ? innerPages[selected] : null
  const warnings = doc.data?.warnings ?? []
  const sourceLabel =
    cat.source.kind === 'choix' ? 'Au choix'
    : cat.source.label && cat.source.label.toLowerCase().startsWith(SOURCE_LABELS[cat.source.kind].toLowerCase()) ? cat.source.label
    : `${SOURCE_LABELS[cat.source.kind]} ${cat.source.label ?? ''}`.trim()
  const productsShown = docPages.reduce((sum, page) => sum + (page.kind === 'products' || page.kind === 'presentation' ? page.products.filter((item) => item.kind !== 'offer').length : 0), 0)
  const selectedDoc = selected !== null ? docPages[selected + 2] : undefined
  const family: 'products' | 'presentation' = selectedPage && isPresentation(selectedPage.layout) ? 'presentation' : 'products'
  const productPages = innerPages.filter((p) => !isPresentation(p.layout))
  const currentHeader: api.CatalogueHeader | null = selectedPage ? (isPresentation(selectedPage.layout) ? null : (selectedPage.header ?? 'titre'))
    : productPages.length && productPages.every((p) => (p.header ?? 'titre') === (productPages[0].header ?? 'titre')) ? (productPages[0].header ?? 'titre') : null
  const currentTemplate: CatalogueTemplate | null = selectedPage ? (selectedPage.template ?? 'A')
    : innerPages.length && innerPages.every((p) => (p.template ?? 'A') === (innerPages[0].template ?? 'A')) ? (innerPages[0].template ?? 'A') : null

  return (
    <div className="catv catv-editor">
      <div className="catv-head">
        <div>
          <button type="button" className="linklike catv-back" onClick={onBack}>
            ‹ Catalogues
          </button>
          <p className="catv-kicker">
            Catalogues · {sourceLabel} · webshop{cat.owner === 'boutique' ? ` · ${cat.shop?.name ?? ''} (franchisé)` : ''}
          </p>
          <input className="catv-title" value={cat.title} maxLength={160} onChange={(event) => setCat({ ...cat, title: event.target.value })} onBlur={(event) => event.target.value.trim() && change({ title: event.target.value.trim() })} aria-label="Titre du catalogue" />
        </div>
        <span className="catv-grow" />
        <span className="bro-seg" role="group" aria-label="Langue">
          {(['fr', 'nl'] as CatalogueLang[]).map((l) => (
            <button
              key={l}
              type="button"
              className={lang === l ? 'is-on' : ''}
              title={cat.langs.includes(l) ? undefined : 'Ajouter cette langue au catalogue'}
              onClick={() => {
                if (!cat.langs.includes(l)) change({ langs: [...cat.langs, l] })
                setLang(l)
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </span>
        {cat.owner === 'marque' ? (
          <span className="bro-seg" role="group" aria-label="Version">
            <button type="button" className={versionShop === null ? 'is-on' : ''} onClick={() => setVersionShop(null)}>
              Version générale
            </button>
            <button type="button" className={versionShop !== null ? 'is-on' : ''} disabled={!versionShops.length} onClick={() => setVersionShop(versionShops[0] ?? null)}>
              Par boutique ({versionShops.length})
            </button>
          </span>
        ) : null}
        <button type="button" className="btn" onClick={() => void print('proof', false)}>
          Aperçu imprimable
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void print('printer', cat.owner === 'marque')}>
          PDF pour l’imprimeur
        </button>
      </div>
      {printError ? <p className="error">{printError}</p> : null}

      <div className="catv-body">
        {/* ---------- produits ---------- */}
        <section className="card catv-col">
          <h2>
            Produits · {sourceLabel} ({cat.products.length})
          </h2>
          <div className="catv-search">
            <input placeholder="Chercher…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <span className="bro-tag">{checked} cochés</span>
          </div>
          <label className="bro-check">
            <input type="checkbox" checked={allWebshop} onChange={(event) => setAllWebshop(event.target.checked)} />
            Montrer tout le webshop {cat.owner === 'boutique' ? 'de la boutique' : ''}
          </label>
          {addable.length ? (
            <label className="catv-field catv-addcat">
              <span>Ajouter une catégorie du webshop</span>
              <select
                value=""
                onChange={(event) => {
                  const pick = addable.find(({ c }) => String(c.id) === event.target.value)
                  if (!pick) return
                  addCategory(pick.c.id, pick.c.name, pick.ids)
                  setOpened((prev) => new Set([...(prev ?? []), pick.c.name]))
                }}
              >
                <option value="">＋ Choisir une catégorie…</option>
                {addable.map(({ c, ids }) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({ids.length} produit{ids.length > 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {webshop.loading ? <p className="muted">Lecture du webshop…</p> : null}
          {webshop.error ? <p className="error">{webshop.error}</p> : null}
          {(webshop.data?.shops ?? []).filter((s) => s.error).map((s) => (
            <p key={s.id} className="catv-warn">
              Webshop de {s.name} illisible : {s.error}
            </p>
          ))}
          <div className="catv-products">
            {[...groups.entries()].map(([group, entries]) => {
              const sellable = entries.filter(({ product }) => product !== null)
              const on = sellable.filter(({ row }) => row.on).length
              const all = sellable.length > 0 && on === sellable.length
              const open = isOpen(group)
              return (
              <div key={group} className={`catv-acc${open ? ' is-open' : ''}`}>
                <div className="catv-acc__head">
                  <button type="button" className="catv-acc__title" aria-expanded={open} onClick={() => flip(group)}>
                    <span className="catv-acc__chev" aria-hidden="true">›</span>
                    <span className="catv-acc__name">{group}</span>
                    <span className="catv-acc__count">
                      {on} / {sellable.length} produit{sellable.length > 1 ? 's' : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`catv-sw${all ? ' is-on' : ''}`}
                    role="switch"
                    aria-checked={all}
                    disabled={!sellable.length}
                    title={all ? 'Retirer toute la catégorie' : 'Toute la catégorie'}
                    onClick={() => toggleProducts(sellable.map(({ row }) => row.id), !all)}
                  >
                    <span className="catv-sw__label">toute la catégorie</span>
                    <span className="catv-sw__track" aria-hidden="true" />
                  </button>
                </div>
                {open ? entries.map(({ row, product }) => {
                  const missing = product ? versionShops.filter((s) => !product.prices.some((p) => p.shopId === s)) : []
                  const differs = product?.priceDiffers ?? []
                  const mine = versionShop !== null ? product?.prices.find((p) => p.shopId === versionShop) : null
                  const price = versionShop !== null ? (mine ? (mine.webPriceCents ?? mine.shopPriceCents) : null) : (product?.priceCents ?? null)
                  return (
                    <div key={row.id} className={`catv-product${!row.on ? ' is-off' : ''}`}>
                      <span className="catv-thumb">{product?.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : null}</span>
                      <span className="catv-product__name">
                        {product ? (lang === 'nl' ? product.nameNl : product.name) : `Produit ${row.id}`}
                        {!product ? <small className="catv-flag">absent du webshop</small> : null}
                        {missing.length ? <small className="catv-flag">pas sur le webshop de {missing.map(shopName).join(', ')}</small> : null}
                        {differs.length && versionShop === null ? <small className="catv-flag">prix différent à {differs.map(shopName).join(', ')}</small> : null}
                      </span>
                      <span className="catv-product__price">{formatCents(price, lang)}</span>
                      <button
                        type="button"
                        className={`catv-sw${row.on ? ' is-on' : ''}`}
                        role="switch"
                        aria-checked={row.on}
                        aria-label={product ? product.name : `Produit ${row.id}`}
                        disabled={!product}
                        onClick={() => toggleProduct(row.id, !row.on)}
                      >
                        <span className="catv-sw__track" aria-hidden="true" />
                      </button>
                    </div>
                  )
                }) : null}
              </div>
              )
            })}
          </div>
        </section>

        {/* ---------- pages ---------- */}
        <section className="catv-stage" ref={stageRef}>
          <div className="catv-stagebar">
            <h2>
              {cat.pageCount} pages · {cat.format} · dont 4 de la marque · glisser une page de produits pour la déplacer
            </h2>
            {cat.owner === 'marque' && versionShop !== null ? (
              <select value={versionShop} onChange={(event) => setVersionShop(Number(event.target.value))}>
                {versionShops.map((s) => (
                  <option key={s} value={s}>
                    {shopName(s)}
                  </option>
                ))}
              </select>
            ) : null}
            <span className="catv-save">
              {save.status === 'saving' ? 'Enregistrement…' : save.status === 'saved' ? (save.text ?? 'Enregistré') : save.status === 'error' ? <span className="error">{save.text}</span> : null}
            </span>
          </div>
          {doc.error ? <p className="error">{doc.error}</p> : null}
          <style>{catalogueCss()}</style>
          <div className="catv-pages">
            {docPages.map((page, index) => {
              // Les pages intérieures commencent à la page 3 (après la couverture et la page 2).
              const inner = page.kind === 'products' || page.kind === 'presentation' ? index - 2 : null
              return (
                <div
                  key={`${index}-${page.kind}`}
                  className={`catv-page${inner !== null && inner === selected ? ' is-selected' : ''}${page.locked ? ' is-locked' : ''}`}
                  style={{ width: size.w * MM * zoom, height: size.h * MM * zoom }}
                  draggable={inner !== null}
                  onDragStart={(event: ReactDragEvent) => {
                    if (inner === null) return
                    setDragFrom(inner)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(event) => {
                    if (inner !== null && dragFrom !== null) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (inner !== null && dragFrom !== null) movePage(dragFrom, inner)
                    setDragFrom(null)
                  }}
                  onClick={() => setSelected(inner)}
                >
                  <span style={{ zoom }}>
                    <CatalogueSheet doc={doc.data as CatalogueDocument} index={index} mode="preview" />
                  </span>
                  {page.locked ? (
                    <span className="catv-lock" title="Fixée par la Charte des catalogues">
                      <LockIcon /> Marque
                    </span>
                  ) : null}
                  <span className="catv-page__no">{index + 1}</span>
                </div>
              )
            })}
          </div>
          <div className="catv-stagefoot">
            {docPages.length ? (
              <span className="bro-tag">
                pages 3 à {docPages.length - 2} · {productsShown} produits
              </span>
            ) : null}
            <PageCountChoice value={cat.pageCount} onChange={setPageCount} disabled={save.status === 'saving'} />
            <button type="button" className="btn btn--sm" onClick={() => change({ pages: [] })} title={`Une catégorie après l’autre, sur les ${cat.innerPageCount} pages de produits`}>
              Répartir automatiquement
            </button>
          </div>
        </section>

        {/* ---------- réglages ---------- */}
        <div className="catv-side">
          <section className="card">
            <h2>Mise en page des pages intérieures</h2>
            <div className="bro-seg catv-scope">
              <button type="button" className={selected === null ? 'is-on' : ''} onClick={() => setSelected(null)}>
                Toutes les pages
              </button>
              <select
                className={selected !== null ? 'is-on' : ''}
                value={selected ?? ''}
                onChange={(event) => setSelected(event.target.value === '' ? null : Number(event.target.value))}
              >
                <option value="">Une page…</option>
                {innerPages.map((_, i) => (
                  <option key={i} value={i}>
                    Page {i + 3}
                  </option>
                ))}
              </select>
            </div>
            <div className="catv-subt">Type de page</div>
            <div className="catv-layouts catv-layouts--5">
              {(Object.keys(LAYOUT_LABELS) as CatalogueLayout[]).map((layout) => {
                const forAll = selected === null && isPresentation(layout)
                return (
                  <button
                    key={layout}
                    type="button"
                    className={`catv-layout${(selectedPage ? selectedPage.layout === layout : innerPages.length > 0 && innerPages.every((p) => p.layout === layout)) ? ' is-on' : ''}`}
                    disabled={!innerPages.length || forAll || (isPresentation(layout) && !gammeOptions.length)}
                    title={
                      forAll ? 'Une page de présentation présente UNE gamme : choisissez la page (« Une page… »)'
                      : selectedPage ? `Page ${(selected as number) + 3} en « ${LAYOUT_LABELS[layout].label} »`
                      : `Toutes les pages de produits en « ${LAYOUT_LABELS[layout].label} » (les présentations restent)`
                    }
                    onClick={() => (selected !== null ? setLayout(selected, layout) : setAllLayouts(layout))}
                  >
                    <LayoutIcon layout={layout} />
                    <span>{LAYOUT_LABELS[layout].label}</span>
                  </button>
                )
              })}
            </div>
            {selectedPage && isPresentation(selectedPage.layout) ? null : (
              <>
                <div className="catv-subt">Titre et illustration de la catégorie{selectedPage ? '' : ' · toutes les pages'}</div>
                <div className="catv-layouts">
                  {api.CATALOGUE_HEADERS.map((header) => (
                    <button
                      key={header}
                      type="button"
                      className={`catv-layout catv-tpl${currentHeader === header ? ' is-on' : ''}`}
                      disabled={!productPages.length}
                      title={`${HEADER_LABELS[header].label} — ${HEADER_LABELS[header].hint} (le dessin de la famille de la catégorie, sinon celui de la gamme)`}
                      onClick={() => (selected !== null ? setPage(selected, { header }) : setAllHeaders(header))}
                    >
                      <HeaderIcon header={header} />
                      <span>{HEADER_LABELS[header].label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="catv-subt">Gabarit{selectedPage ? '' : ' de toutes les pages'}</div>
            <div className="catv-layouts">
              {(['A', 'B', 'C'] as CatalogueTemplate[]).map((template) => (
                <button
                  key={template}
                  type="button"
                  className={`catv-layout catv-tpl${currentTemplate === template ? ' is-on' : ''}`}
                  disabled={!innerPages.length}
                  title={`${template} · ${TEMPLATE_LABELS[family][template].label} — ${TEMPLATE_LABELS[family][template].hint}`}
                  onClick={() => (selected !== null ? setPage(selected, { template }) : setAllTemplates(template))}
                >
                  <TemplateIcon family={family} template={template} />
                  <span>
                    {template} · {TEMPLATE_LABELS[family][template].label}
                  </span>
                </button>
              ))}
            </div>
            {selectedPage ? (
              <label className="catv-field">
                <span>Gamme de la page {(selected as number) + 3}</span>
                <select
                  value={selectedPage.gamme ?? ''}
                  onChange={(event) => setPage(selected as number, { gamme: event.target.value ? Number(event.target.value) : null })}
                >
                  {isPresentation(selectedPage.layout) ? null : <option value="">Toutes les gammes</option>}
                  {gammeOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {refs.includes(g.id) ? ' · du catalogue' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedPage && !isPresentation(selectedPage.layout) ? (
              <label className="catv-field">
                <span>Catégorie de la page {(selected as number) + 3}</span>
                <select value={selectedPage.category ?? ''} onChange={(event) => setPage(selected as number, { category: event.target.value ? Number(event.target.value) : null })}>
                  <option value="">Notre sélection (toutes catégories)</option>
                  {(webshop.data?.categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {lang === 'nl' ? c.nameNl : c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedPage && isPresentation(selectedPage.layout) ? (
              <PresentationTexts key={`${selected}-${selectedPage.gamme}`} page={selectedPage} langs={cat.langs} onSave={(patch) => setPage(selected as number, patch)} />
            ) : null}
            {selectedPage && !isPresentation(selectedPage.layout) && selectedDoc?.kind === 'products' && (selectedDoc.fillable || selectedPage.filler) ? (
              <div className="catv-field">
                <span title="Quand la page n’est pas pleine, une photo de la médiathèque ou l’illustration de la gamme prend la place libre">Place libre</span>
                <span className="bro-seg">
                  {([['', 'Rien'], ['photo', 'Photo'], ['illustration', 'Illustration']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={(selectedPage.filler ?? '') === value ? 'is-on' : ''}
                      onClick={() => {
                        if (value === 'photo') setFillerPicking(true)
                        else setPage(selected as number, { filler: value === '' ? null : value, fillerMediaId: null })
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </span>
                {selectedPage.filler === 'photo' ? (
                  <span className="catv-filler">
                    {selectedDoc.filler?.imageUrl ? <img src={selectedDoc.filler.imageUrl} alt="" /> : null}
                    <button type="button" className="btn btn--sm" onClick={() => setFillerPicking(true)}>
                      Changer de photo…
                    </button>
                  </span>
                ) : null}
                {!selectedDoc.fillable && selectedPage.filler ? <span className="muted">La page est pleine : rien n’est imprimé à la place libre.</span> : null}
              </div>
            ) : null}
            <div className="catv-field">
              <span>Format</span>
              <span className="bro-seg">
                {(['A5', 'A4'] as const).map((f) => (
                  <button key={f} type="button" className={cat.format === f ? 'is-on' : ''} onClick={() => change({ format: f })}>
                    {f}
                  </button>
                ))}
              </span>
            </div>
          </section>

          <OffersCard
            offers={webshop.data?.offers ?? []}
            error={webshop.data?.offersError ?? null}
            loading={webshop.loading}
            choices={cat.offers ?? []}
            checkedIds={new Set(cat.products.filter((row) => row.on).map((row) => row.id))}
            checkedCategories={new Set(cat.products.filter((row) => row.on).map((row) => byId.get(row.id)?.categoryId ?? null).filter((c): c is number => c !== null))}
            categoryName={(id) => (id !== null ? (categories.get(id)?.name ?? null) : null)}
            showAvailability={cat.showAvailability ?? true}
            offerImages={Object.fromEntries(
              docPages.flatMap((page) => (page.kind === 'products' ? page.products : [])).filter(api.isDocOffer).filter((o) => !!o.imageUrl).map((o) => [o.id, o.imageUrl as string]),
            )}
            onOffers={(offers) => change({ offers })}
            onAvailability={(showAvailability) => change({ showAvailability })}
          />

          <section className="card">
            <h2>Fixé par la marque</h2>
            <dl className="catv-dl">
              <dt>Logo</dt>
              <dd>{doc.data?.charter.logoUrl ? 'logo de la charte' : 'logo officiel'}</dd>
              <dt>Page 1</dt>
              <dd>Couverture « {docPages[0]?.kind === 'cover' ? docPages[0].title : '…'} »</dd>
              <dt>Page 2</dt>
              <dd>« {docPages[1]?.kind === 'brand' ? docPages[1].title : '…'} »</dd>
              <dt>Page {cat.pageCount - 1}</dt>
              <dd>« {docPages[docPages.length - 2]?.kind === 'brand' ? (docPages[docPages.length - 2] as { title: string }).title : '…'} »</dd>
              <dt>Page {cat.pageCount}</dt>
              <dd>Commande en ligne + boutique</dd>
              <dt>Couleurs, polices</dt>
              <dd>charte</dd>
            </dl>
            <p className="catv-note">
              <LockIcon /> Réglés dans « Charte des catalogues » : les franchisés ne peuvent pas les modifier.
            </p>
          </section>

          <section className="card">
            <h2>Prix</h2>
            <dl className="catv-dl">
              <dt>Source</dt>
              <dd>webshop</dd>
              <dt>{versionShop !== null || cat.owner === 'boutique' ? 'Version boutique' : 'Version générale'}</dt>
              <dd>{versionShop !== null || cat.owner === 'boutique' ? 'prix de SA boutique' : 'prix le plus répandu'}</dd>
            </dl>
            {warnings.map((warning, index) => (
              <p key={index} className="catv-warn">
                {warning.message}
              </p>
            ))}
          </section>

          {cat.owner === 'marque' ? (
            <section className="card">
              <h2>Boutiques (une version chacune)</h2>
              <div className="catv-shops">
                {shops.map((shop) => (
                  <label key={shop.id} className="bro-check">
                    <input
                      type="checkbox"
                      checked={cat.shopIds.includes(shop.id)}
                      onChange={(event) => {
                        const next = event.target.checked ? [...cat.shopIds, shop.id] : cat.shopIds.filter((s) => s !== shop.id)
                        if (!event.target.checked && versionShop === shop.id) setVersionShop(null)
                        change({ shopIds: next })
                      }}
                    />
                    {shop.name}
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          <section className="card">
            <h2>État</h2>
            <div className="catv-field">
              <span className="bro-seg">
                {(['brouillon', 'pret', 'imprime'] as const).map((status) => (
                  <button key={status} type="button" className={cat.status === status ? 'is-on' : ''} onClick={() => change({ status })}>
                    {STATUS_LABELS[status]}
                  </button>
                ))}
              </span>
            </div>
            {cat.status === 'imprime' ? (
              <label className="catv-field">
                <span>Exemplaires imprimés</span>
                <input
                  type="number"
                  min={1}
                  defaultValue={cat.printQty ?? ''}
                  onBlur={(event) => change({ printQty: event.target.value ? Number(event.target.value) : null })}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => {
                if (window.confirm(`Supprimer « ${cat.title} » ?`)) void api.deleteCatalogue(cat.id).then(onBack, (cause: unknown) => setSave({ status: 'error', text: message(cause) }))
              }}
            >
              Supprimer le catalogue
            </button>
          </section>
        </div>
      </div>
      {fillerPicking && selected !== null ? (
        <MediaPicker
          onClose={() => setFillerPicking(false)}
          onPick={(asset) => {
            setFillerPicking(false)
            setPage(selected, { filler: 'photo', fillerMediaId: Number(asset.id) })
          }}
        />
      ) : null}
    </div>
  )
}

/** Le texte d'une page de présentation (FR, et NL si le catalogue l'est), enregistré en quittant le champ. */
/** Une offre est-elle cochée ? Le choix enregistré, sinon : touche-t-elle un produit coché ? (la règle de l'API) */
function offerIsOn(offer: api.WebshopOffer, choices: api.CatalogueOfferRow[], checkedIds: Set<number>, checkedCategories: Set<number>): boolean {
  const choice = choices.find((c) => c.type === offer.type && c.id === offer.erpId)
  if (choice) return choice.on
  return offer.productIds.some((id) => checkedIds.has(id)) || offer.categoryIds.some((id) => checkedCategories.has(id))
}

/**
 * « Promotions et bundles » : les offres de TFBuddy qui valent pour ce catalogue (réseau ou ses boutiques), un
 * interrupteur chacune — cochées d'office quand elles touchent un produit coché. Une vignette occupe une case de la
 * page de sa catégorie ; une remise programmée barre le prix des produits qu'elle vise. Et l'interrupteur de la
 * disponibilité (période, délai de commande) imprimée en pied de page, une ligne par page de catégorie.
 */
function OffersCard({
  offers,
  error,
  loading,
  choices,
  checkedIds,
  checkedCategories,
  categoryName,
  showAvailability,
  offerImages,
  onOffers,
  onAvailability,
}: {
  offers: api.WebshopOffer[]
  error: string | null
  loading: boolean
  choices: api.CatalogueOfferRow[]
  checkedIds: Set<number>
  checkedCategories: Set<number>
  categoryName: (id: number | null) => string | null
  showAvailability: boolean
  /** L'image de chaque vignette telle que le document l'imprime (id de l'offre → adresse). */
  offerImages: Record<string, string>
  onOffers: (offers: api.CatalogueOfferRow[]) => void
  onAvailability: (on: boolean) => void
}) {
  // L'image d'une vignette (client, 14/11/2026 : « insert picture from médiathèque ») : choisie dans la médiathèque.
  const [picking, setPicking] = useState<api.WebshopOffer | null>(null)
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const choiceOf = (offer: api.WebshopOffer) => choices.find((c) => c.type === offer.type && c.id === offer.erpId)
  function save(offer: api.WebshopOffer, patch: Partial<api.CatalogueOfferRow>) {
    const current = choiceOf(offer)
    const next = choices.filter((c) => !(c.type === offer.type && c.id === offer.erpId))
    const on = patch.on ?? current?.on ?? offerIsOn(offer, choices, checkedIds, checkedCategories)
    const mediaId = patch.mediaId !== undefined ? patch.mediaId : (current?.mediaId ?? null)
    onOffers([...next, { type: offer.type, id: offer.erpId, on, mediaId }])
  }
  function toggle(offer: api.WebshopOffer, on: boolean) {
    save(offer, { on })
  }
  return (
    <section className="card">
      <h2>Promotions et bundles</h2>
      {loading && !offers.length ? <p className="catv-note">Lecture des promotions de TFBuddy…</p> : null}
      {error ? <p className="catv-warn">Promotions de TFBuddy illisibles : {error}. Rien n’est inventé : le catalogue n’en montre aucune.</p> : null}
      {!loading && !error && !offers.length ? <p className="catv-note">Aucune promotion active dans TFBuddy pour ces produits et ces boutiques.</p> : null}
      <div className="catv-offers">
        {offers.map((offer) => {
          const on = offerIsOn(offer, choices, checkedIds, checkedCategories)
          const where = offer.type === 'scheduledDiscount' ? 'prix barré' : (categoryName(offer.categoryId) ?? 'Notre sélection')
          return (
            <div key={offer.id} className={`catv-offer${on ? '' : ' is-off'}`}>
              <span className="catv-offer__badge">{offer.badge}</span>
              <span className="catv-offer__body">
                <span className="catv-offer__name">{offer.name}</span>
                <small className="catv-sub">
                  {[offer.products.map((p) => p.name).join(' + ') + (offer.moreProducts ? ` + ${offer.moreProducts}` : ''), offer.period, offer.shopScope === 'selected' ? 'certaines boutiques' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
                <small className="catv-sub">→ {where}</small>
                {offer.type !== 'scheduledDiscount' ? (
                  <span className="catv-offer__img">
                    {choiceOf(offer)?.mediaId ? (
                      <>
                        {(thumbs[choiceOf(offer)?.mediaId as number] ?? offerImages[offer.id]) ? <img src={thumbs[choiceOf(offer)?.mediaId as number] ?? offerImages[offer.id]} alt="" /> : <span className="catv-sub">image n° {choiceOf(offer)?.mediaId}</span>}
                        <button type="button" className="linklike" onClick={() => setPicking(offer)}>
                          Changer
                        </button>
                        <button type="button" className="linklike" onClick={() => save(offer, { mediaId: null })} title="Revenir aux photos des produits">
                          Retirer
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn--sm" onClick={() => setPicking(offer)} title="Une image de la médiathèque à la place des photos des produits, dans la vignette">
                        Image
                      </button>
                    )}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className={`catv-sw${on ? ' is-on' : ''}`}
                role="switch"
                aria-checked={on}
                aria-label={offer.name}
                onClick={() => toggle(offer, !on)}
              >
                <span className="catv-sw__track" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
      <div className="catv-offer catv-offer--avail">
        <span className="catv-offer__body">
          <span className="catv-offer__name">Afficher la disponibilité</span>
          <small className="catv-sub">période et délai de commande lus dans TFBuddy, en pied de chaque page</small>
        </span>
        <button type="button" className={`catv-sw${showAvailability ? ' is-on' : ''}`} role="switch" aria-checked={showAvailability} aria-label="Afficher la disponibilité" onClick={() => onAvailability(!showAvailability)}>
          <span className="catv-sw__track" aria-hidden="true" />
        </button>
      </div>
      {picking ? (
        <MediaPicker
          onClose={() => setPicking(null)}
          onPick={(asset) => {
            const offer = picking
            setPicking(null)
            setThumbs((t) => ({ ...t, [Number(asset.id)]: asset.thumbnailUrl ?? asset.webUrl }))
            save(offer, { mediaId: Number(asset.id) })
          }}
        />
      ) : null}
    </section>
  )
}

function PresentationTexts({ page, langs, onSave }: { page: api.CataloguePageRow; langs: CatalogueLang[]; onSave: (patch: Partial<api.CataloguePageRow>) => void }) {
  const [fr, setFr] = useState(page.text ?? '')
  const [nl, setNl] = useState(page.textNl ?? '')
  return (
    <>
      <label className="catv-field">
        <span>Texte de la présentation · {fr.length}/400 · vide = rien</span>
        <textarea rows={3} maxLength={400} value={fr} onChange={(event) => setFr(event.target.value)} onBlur={() => fr !== (page.text ?? '') && onSave({ text: fr })} />
      </label>
      {langs.includes('nl') ? (
        <label className="catv-field">
          <span>Texte néerlandais · {nl.length}/400</span>
          <textarea rows={3} maxLength={400} value={nl} onChange={(event) => setNl(event.target.value)} onBlur={() => nl !== (page.textNl ?? '') && onSave({ textNl: nl })} />
        </label>
      ) : null}
    </>
  )
}

/** Vignette d'une variante de gabarit. */
function TemplateIcon({ family, template }: { family: 'products' | 'presentation'; template: CatalogueTemplate }) {
  const ink = 'currentColor'
  if (family === 'presentation') {
    return (
      <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
        <rect x="0.6" y="0.6" width="38.8" height="50.8" rx="2" fill={template === 'B' ? ink : 'none'} fillOpacity={template === 'B' ? 0.85 : 0} stroke={ink} strokeWidth="1.2" />
        {template === 'C' ? <rect x="0.6" y="0.6" width="38.8" height="28" rx="2" fill={ink} fillOpacity="0.25" /> : <circle cx="20" cy="17" r="9" fill="none" stroke={template === 'B' ? '#fff' : ink} strokeWidth="1.2" />}
        <rect x={template === 'C' ? 5 : 9} y="34" width="22" height="4" rx="1" fill={template === 'B' ? '#fff' : ink} />
        <rect x={template === 'C' ? 5 : 12} y="41" width="16" height="2" rx="1" fill={template === 'B' ? '#fff' : ink} opacity="0.6" />
      </svg>
    )
  }
  return (
    <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
      <rect x="0.6" y="0.6" width="38.8" height="50.8" rx="2" fill="none" stroke={ink} strokeWidth="1.2" />
      {template === 'B' ? <rect x="0.6" y="0.6" width="38.8" height="10" fill={ink} fillOpacity="0.85" /> : null}
      <rect x={template === 'A' ? 11 : 4} y={template === 'B' ? 4 : 4} width="18" height="3" rx="1" fill={template === 'B' ? '#fff' : ink} />
      {template === 'C' ? <rect x="4" y="9.5" width="32" height="0.8" fill={ink} /> : null}
      {[14, 26, 38].map((y) => (
        <g key={y}>
          <rect x="4" y={y} width="15" height="10" rx="1.5" fill={template === 'C' ? ink : 'none'} fillOpacity={template === 'C' ? 0.18 : 0} stroke={template === 'C' ? 'none' : ink} strokeWidth="1" />
          <rect x="21" y={y} width="15" height="10" rx="1.5" fill={template === 'C' ? ink : 'none'} fillOpacity={template === 'C' ? 0.18 : 0} stroke={template === 'C' ? 'none' : ink} strokeWidth="1" />
        </g>
      ))}
    </svg>
  )
}

/** Vignette d'un en-tête de page : titre seul · bandeau · grande illustration. */
function HeaderIcon({ header }: { header: api.CatalogueHeader }) {
  const ink = 'currentColor'
  const drawing = (cx: number, cy: number, r: number, color: string) => (
    <g fill="none" stroke={color} strokeWidth="1.1">
      <path d={`M${cx - r} ${cy + r * 0.5} Q${cx} ${cy - r * 1.1} ${cx + r} ${cy + r * 0.5} Z`} />
      <path d={`M${cx - r * 0.4} ${cy - r * 0.1} L${cx - r * 0.1} ${cy + r * 0.4} M${cx + r * 0.2} ${cy - r * 0.2} L${cx + r * 0.5} ${cy + r * 0.3}`} />
    </g>
  )
  return (
    <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
      <rect x="0.6" y="0.6" width="38.8" height="50.8" rx="2" fill="none" stroke={ink} strokeWidth="1.2" />
      {header === 'bandeau' ? <rect x="0.6" y="0.6" width="38.8" height="13" fill={ink} fillOpacity="0.85" /> : null}
      {header === 'titre' ? (
        <>
          {drawing(10, 6.5, 3, ink)}
          <rect x="15" y="5" width="16" height="3" rx="1" fill={ink} />
        </>
      ) : header === 'bandeau' ? (
        <>
          {drawing(8.5, 7, 4.5, '#fff')}
          <rect x="16" y="5.5" width="18" height="3" rx="1" fill="#fff" />
        </>
      ) : (
        <>
          {drawing(20, 10, 7, ink)}
          <rect x="11" y="18" width="18" height="3" rx="1" fill={ink} />
        </>
      )}
      {(header === 'grande' ? [25, 37] : [17, 29, 41]).map((y) => (
        <g key={y}>
          <rect x="4" y={y} width="15" height={header === 'grande' ? 10 : 9} rx="1.5" fill="none" stroke={ink} strokeWidth="1" />
          <rect x="21" y={y} width="15" height={header === 'grande' ? 10 : 9} rx="1.5" fill="none" stroke={ink} strokeWidth="1" />
        </g>
      ))}
    </svg>
  )
}

function LayoutIcon({ layout }: { layout: CatalogueLayout }) {
  if (isPresentation(layout)) {
    const list = layout === 'presentation_liste'
    return (
      <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
        <circle cx="20" cy={list ? 11 : 17} r={list ? 7 : 11} fill="none" stroke="currentColor" strokeWidth="1.2" />
        <rect x="9" y={list ? 21 : 33} width="22" height="3.5" rx="1" fill="currentColor" />
        {list ? [28, 34, 40, 46].map((y) => <rect key={y} x="3" y={y} width="34" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />) : <rect x="12" y="40" width="16" height="2" rx="1" fill="currentColor" opacity="0.6" />}
      </svg>
    )
  }
  const cells =
    layout === 'vedette'
      ? [[2, 2, 36, 18], [2, 22, 17, 13], [21, 22, 17, 13], [2, 37, 17, 13], [21, 37, 17, 13]]
      : layout === 'grille'
        ? [[2, 2, 17, 15], [21, 2, 17, 15], [2, 19, 17, 15], [21, 19, 17, 15], [2, 36, 17, 14], [21, 36, 17, 14]]
        : layout === 'mosaique'
          ? [[2, 2, 17, 23], [21, 2, 17, 23], [2, 27, 17, 23], [21, 27, 17, 23]]
        : [[2, 3, 36, 7], [2, 13, 36, 7], [2, 23, 36, 7], [2, 33, 36, 7], [2, 43, 36, 6]]
  return (
    <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">
      {cells.map(([x, y, w, h], index) => (
        <rect key={index} x={x} y={y} width={w} height={h} rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      ))}
    </svg>
  )
}

// =================================================================================================
// Charte des catalogues
// =================================================================================================

function CharterEditor({ onBack }: { onBack: () => void }) {
  const loaded = useAsync(() => api.getCatalogueCharter(), [])
  const webshop = useAsync(() => api.getWebshopProducts([]), [])
  const [charter, setCharter] = useState<CatalogueCharter | null>(null)
  const [picking, setPicking] = useState<null | 'logo' | 'page2' | 'penultimate' | number>(null)
  const [state, setState] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ status: 'idle' })
  const [lang, setLang] = useState<CatalogueLang>('fr')

  useEffect(() => {
    if (loaded.data && !charter) setCharter(loaded.data)
  }, [loaded.data, charter])

  if (loaded.error) return <p className="error">{loaded.error}</p>
  if (!charter) return <p className="muted">Lecture de la charte…</p>

  const gammes = webshop.data?.gammes ?? []
  const used = new Set(charter.covers.map((cover) => cover.gamme))

  function setBrand(slot: 'page2' | 'penultimate', patch: Partial<CatalogueBrandPage>) {
    setCharter((current) => (current ? { ...current, [slot]: { ...current[slot], ...patch } } : current))
  }
  const brandDoc = (slot: 'page2' | 'penultimate') => {
    const content = charter[slot]
    return {
      kind: 'brand' as const,
      locked: true as const,
      slot,
      title: lang === 'nl' ? content.titleNl || content.titleFr : content.titleFr,
      text: lang === 'nl' ? content.textNl || content.textFr : content.textFr,
      imageUrl: content.imageUrl ?? null,
    }
  }

  function setCover(index: number, patch: Partial<CatalogueCover>) {
    setCharter((current) => (current ? { ...current, covers: current.covers.map((cover, i) => (i === index ? { ...cover, ...patch } : cover)) } : current))
  }

  async function saveAll() {
    if (!charter) return
    setState({ status: 'saving' })
    try {
      setCharter(await api.saveCatalogueCharter(charter))
      setState({ status: 'saved' })
    } catch (cause) {
      setState({ status: 'error', text: message(cause) })
    }
  }

  // L'aperçu : la couverture générique et la dernière page, telles que la charte les fixe (sans produit).
  const preview = (cover: CatalogueCover): CatalogueDocument => ({
    catalogue: { id: 0, title: '', format: 'A5', owner: 'marque' },
    version: { shop: null, lang },
    charter: { logoUrl: charter.logoUrl, colors: charter.colors },
    pages: [
      { kind: 'cover', locked: true, title: (lang === 'nl' ? cover.titleNl || cover.titleFr : cover.titleFr) || '—', subtitle: lang === 'nl' ? cover.subtitleNl || cover.subtitleFr : cover.subtitleFr, eyebrow: null, imageUrl: cover.imageUrl ?? null },
      brandDoc('page2'),
      brandDoc('penultimate'),
      { kind: 'back', locked: true, title: lang === 'nl' ? charter.back.titleNl || charter.back.titleFr : charter.back.titleFr, text: lang === 'nl' ? charter.back.textNl || charter.back.textFr : charter.back.textFr, qrUrl: null, host: null, shop: null },
    ],
    warnings: [],
  })

  return (
    <div className="catv">
      <div className="catv-head">
        <div>
          <button type="button" className="linklike catv-back" onClick={onBack}>
            ‹ Catalogues
          </button>
          <p className="catv-kicker">Catalogues · réglage de la marque</p>
          <h2 className="catv-h1">Charte des catalogues</h2>
        </div>
        <span className="catv-grow" />
        <span className="bro-seg" role="group" aria-label="Langue de l’aperçu">
          {(['fr', 'nl'] as CatalogueLang[]).map((l) => (
            <button key={l} type="button" className={lang === l ? 'is-on' : ''} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </span>
        <span className="catv-save">{state.status === 'saved' ? 'Enregistré' : state.status === 'error' ? <span className="error">{state.text}</span> : null}</span>
        <button type="button" className="btn btn--primary" disabled={state.status === 'saving'} onClick={() => void saveAll()}>
          {state.status === 'saving' ? 'Enregistrement…' : 'Enregistrer la charte'}
        </button>
      </div>
      <p className="catv-note">
        <LockIcon /> Le logo, les couleurs et les quatre pages de la marque de tous les catalogues — couverture (page 1), page 2, avant-dernière et dernière page —,
        ceux de la marque et ceux que les franchisés font dans leur dashboard, viennent d’ici.
      </p>

      <style>{catalogueCss()}</style>
      <div className="catv-charter">
        <div className="catv-charter__form">
          <section className="card">
            <h2>Logo et couleurs</h2>
            <div className="catv-field">
              <span>Logo</span>
              <span className="catv-inline">
                {charter.logoUrl ? <img className="catv-logo" src={charter.logoUrl} alt="" /> : <span className="muted">Logo officiel de la marque</span>}
                <button type="button" className="btn btn--sm" onClick={() => setPicking('logo')}>
                  Choisir dans la médiathèque
                </button>
                {charter.logoMediaId !== null ? (
                  <button type="button" className="linklike" onClick={() => setCharter({ ...charter, logoMediaId: null, logoUrl: null })}>
                    logo officiel
                  </button>
                ) : null}
              </span>
            </div>
            <div className="catv-colors">
              {(['primary', 'secondary', 'accent', 'ink'] as const).map((key) => (
                <label key={key} className="catv-field">
                  <span>{{ primary: 'Principale', secondary: 'Papier', accent: 'Accent', ink: 'Encre' }[key]}</span>
                  <input type="color" value={charter.colors[key]} onChange={(event) => setCharter({ ...charter, colors: { ...charter.colors, [key]: event.target.value.toUpperCase() } })} />
                </label>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Couvertures (page 1)</h2>
            {charter.covers.map((cover, index) => (
              <div key={`${cover.gamme ?? 'g'}-${index}`} className="catv-cover">
                <div className="catv-cover__head">
                  <span className="bro-tag">{cover.gamme === null ? 'Générique (par défaut)' : (gammes.find((g) => g.id === cover.gamme)?.name ?? `Gamme ${cover.gamme}`)}</span>
                  {cover.gamme !== null ? (
                    <button type="button" className="linklike" onClick={() => setCharter({ ...charter, covers: charter.covers.filter((_, i) => i !== index) })}>
                      retirer
                    </button>
                  ) : null}
                </div>
                <div className="catv-grid2">
                  <label className="catv-field">
                    <span>Titre FR</span>
                    <input value={cover.titleFr} maxLength={240} onChange={(event) => setCover(index, { titleFr: event.target.value })} />
                  </label>
                  <label className="catv-field">
                    <span>Titre NL</span>
                    <input value={cover.titleNl} maxLength={240} onChange={(event) => setCover(index, { titleNl: event.target.value })} />
                  </label>
                  <label className="catv-field">
                    <span>Sous-titre FR</span>
                    <input value={cover.subtitleFr} maxLength={240} onChange={(event) => setCover(index, { subtitleFr: event.target.value })} />
                  </label>
                  <label className="catv-field">
                    <span>Sous-titre NL</span>
                    <input value={cover.subtitleNl} maxLength={240} onChange={(event) => setCover(index, { subtitleNl: event.target.value })} />
                  </label>
                </div>
                <div className="catv-inline">
                  {cover.imageUrl ? <img className="catv-visual" src={cover.imageUrl} alt="" /> : <span className="muted">Sans visuel</span>}
                  <button type="button" className="btn btn--sm" onClick={() => setPicking(index)}>
                    Visuel de la médiathèque
                  </button>
                  {cover.mediaId !== null ? (
                    <button type="button" className="linklike" onClick={() => setCover(index, { mediaId: null, imageUrl: null })}>
                      retirer le visuel
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {gammes.filter((g) => !used.has(g.id)).length ? (
              <label className="catv-field">
                <span>Ajouter la couverture d’une gamme</span>
                <select
                  value=""
                  onChange={(event) => {
                    const gamme = Number(event.target.value)
                    const name = gammes.find((g) => g.id === gamme)?.name ?? ''
                    setCharter({ ...charter, covers: [...charter.covers, { gamme, titleFr: name, titleNl: '', subtitleFr: '', subtitleNl: '', mediaId: null, imageUrl: null }] })
                  }}
                >
                  <option value="">Choisir une gamme du webshop…</option>
                  {gammes
                    .filter((g) => !used.has(g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {webshop.error ? <p className="catv-warn">Gammes du webshop illisibles : {webshop.error}</p> : null}
          </section>

          {(['page2', 'penultimate'] as const).map((slot) => (
            <section key={slot} className="card">
              <h2>{slot === 'page2' ? 'Page 2' : 'Avant-dernière page'}</h2>
              <div className="catv-grid2">
                {(['titleFr', 'titleNl'] as const).map((key) => (
                  <label key={key} className="catv-field">
                    <span>{key === 'titleFr' ? 'Titre FR' : 'Titre NL'}</span>
                    <input value={charter[slot][key]} maxLength={240} onChange={(event) => setBrand(slot, { [key]: event.target.value })} />
                  </label>
                ))}
                {(['textFr', 'textNl'] as const).map((key) => (
                  <label key={key} className="catv-field">
                    <span>{key === 'textFr' ? 'Texte FR' : 'Texte NL'}</span>
                    <textarea rows={6} value={charter[slot][key]} maxLength={1200} onChange={(event) => setBrand(slot, { [key]: event.target.value })} />
                  </label>
                ))}
              </div>
              <div className="catv-inline">
                {charter[slot].imageUrl ? <img className="catv-visual" src={charter[slot].imageUrl ?? ''} alt="" /> : <span className="muted">Sans image : le logo</span>}
                <button type="button" className="btn btn--sm" onClick={() => setPicking(slot)}>
                  Image de la médiathèque
                </button>
                {charter[slot].mediaId !== null ? (
                  <button type="button" className="linklike" onClick={() => setBrand(slot, { mediaId: null, imageUrl: null })}>
                    retirer l’image
                  </button>
                ) : null}
              </div>
              <p className="catv-note" title="Une ligne vide sépare deux paragraphes ; un paragraphe de plusieurs lignes s’imprime en liste.">
                Textes à adapter : {slot === 'page2' ? 'le mot de la boulangerie, ce qui est fait maison.' : 'les services de vos boutiques (commande en ligne, retrait, livraison, gâteaux sur commande).'}
              </p>
            </section>
          ))}

          <section className="card">
            <h2>Dernière page (commande en ligne)</h2>
            <div className="catv-grid2">
              {(['titleFr', 'titleNl', 'textFr', 'textNl'] as const).map((key) => (
                <label key={key} className="catv-field">
                  <span>{{ titleFr: 'Titre FR', titleNl: 'Titre NL', textFr: 'Texte FR', textNl: 'Texte NL' }[key]}</span>
                  <input value={charter.back[key]} maxLength={240} onChange={(event) => setCharter({ ...charter, back: { ...charter.back, [key]: event.target.value } })} />
                </label>
              ))}
            </div>
            <p className="catv-note">Le QR code (webshop de la boutique), l’adresse, les horaires et le téléphone de la boutique s’ajoutent seuls à chaque version.</p>
          </section>
        </div>

        <div className="catv-charter__preview">
          {[charter.covers[0], ...charter.covers.slice(1)].slice(0, 1).map((cover) => {
            const d = preview(cover)
            return [0, 1, 2, 3].map((index) => (
              <div key={index} className="catv-page is-locked" style={{ width: 148 * MM * 0.42, height: 210 * MM * 0.42 }}>
                <span style={{ zoom: 0.42 }}>
                  <CatalogueSheet doc={d} index={index} mode="preview" />
                </span>
              </div>
            ))
          })}
        </div>
      </div>

      {picking !== null ? (
        <MediaPicker
          onClose={() => setPicking(null)}
          onPick={(asset) => {
            const mediaId = Number(asset.id)
            if (picking === 'logo') setCharter({ ...charter, logoMediaId: mediaId, logoUrl: asset.url })
            else if (picking === 'page2' || picking === 'penultimate') setBrand(picking, { mediaId, imageUrl: asset.url })
            else setCover(picking, { mediaId, imageUrl: asset.url })
            setPicking(null)
          }}
        />
      ) : null}
    </div>
  )
}

function MediaPicker({ onPick, onClose }: { onPick: (asset: api.MediaAsset) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const page = useAsync(() => api.listMedia({ kind: 'image', perPage: 48, name: query }), [query])
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(name), 300)
    return () => window.clearTimeout(timer)
  }, [name])
  return (
    <div className="catv-modal" role="dialog" aria-label="Médiathèque" onClick={onClose}>
      <div className="catv-modal__box" onClick={(event) => event.stopPropagation()}>
        <div className="catv-modal__head">
          <h2>Médiathèque</h2>
          <input placeholder="Chercher…" value={name} onChange={(event) => setName(event.target.value)} />
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {page.error ? <p className="error">{page.error}</p> : null}
        {page.loading ? <p className="muted">Lecture…</p> : null}
        <div className="catv-media">
          {(page.data?.items ?? []).map((asset) => (
            <button key={asset.id} type="button" className="catv-media__item" onClick={() => onPick(asset)} title={asset.name}>
              <img src={asset.thumbnailUrl ?? asset.webUrl} alt="" loading="lazy" />
              <span>{asset.name}</span>
            </button>
          ))}
          {page.data && !page.data.items.length ? <p className="muted">Aucune image.</p> : null}
        </div>
      </div>
    </div>
  )
}
