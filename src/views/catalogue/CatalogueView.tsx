import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as api from '../../lib/api/module'
import type {
  Catalogue,
  CatalogueDocument,
  CatalogueLang,
  CatalogueLayout,
  CataloguePageCount,
  CatalogueSourceKind,
  CatalogueSupport,
  CatalogueTemplate,
  WebshopProducts,
} from '../../lib/api/module'
import { TfBuddyError } from '../../lib/api/http'
import { useAsync } from '../../lib/useAsync'
import { openPrintWindow } from '../../lib/print'
import { CatalogueSheet, FORMAT_MM, HEADER_LABELS, LAYOUT_LABELS, TEMPLATE_LABELS, catalogueCss, formatCents, isPresentation, sheetSize } from './CataloguePages'
import type { CatalogueSheetMode } from './CataloguePages'
import './catalogue.css'
import CharterAssistant from './CharterAssistant'
import type { CharterStep } from './CharterAssistant'
import { MediaPicker } from './MediaPicker'
import { HeaderIcon, LayoutIcon, TemplateIcon } from './CatalogueIcons'
import CatalogueWizard from './CatalogueWizard'
import type { WizardProps, WizardStep } from './CatalogueWizard'
import LeafletWizard from './LeafletWizard'
import { importBrochure } from './brochureImport'
import { OrderFormCell, OrderFormMenu } from './OrderFormMenu'
import { TEMPLATES } from '../../lib/brochure'
import { SUPPORT_LABELS, SUPPORT_NOUNS, isLeaflet, leafletBlocked, leafletChecks, leafletDoc, supportOf } from './leaflet'
import { Sheet as BrochureSheet, fontFaces, pageSize as brochurePageSize } from '../brochure/Pages'
import type { Side } from '../brochure/Pages'
import BROCHURE_CSS from '../brochure/brochure.css?inline'

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

/**
 * `charter` : l'assistant des pages de la marque, ouvert depuis la liste, ou depuis l'éditeur d'un catalogue en
 * cliquant une de ses 4 pages de la marque (`step` : son étape ; `gammes` : celles du catalogue, pour ouvrir sa
 * couverture ; `returnTo` : le catalogue où revenir).
 */
type Screen =
  | { kind: 'list' }
  | { kind: 'editor'; id: number }
  | { kind: 'charter'; step?: CharterStep; gammes?: number[]; returnTo?: number; catalogue?: { id: number; title: string } }

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

/** Un leaflet ou un dépliant de campagne : ouvert dans l'onglet « Ancien générateur » des imprimés (21/11/2026). */
export type BrochureKind = 'leaflet-a5' | 'depliant-a4'

export default function CatalogueView({ onBrochure, initialCatalogue = null }: { onBrochure?: (format: BrochureKind) => void; initialCatalogue?: number | null } = {}) {
  // `?pages-marque` ouvre l'assistant des pages de la marque (lien direct, captures) ; `initialCatalogue`, un imprimé repris
  // d'une brochure depuis l'ancien générateur.
  const [screen, setScreen] = useState<Screen>(() =>
    initialCatalogue !== null ? { kind: 'editor', id: initialCatalogue } : new URLSearchParams(window.location.search).has('pages-marque') ? { kind: 'charter' } : { kind: 'list' },
  )

  if (screen.kind === 'editor') {
    const id = screen.id
    return (
      <Editor
        id={id}
        onBack={() => setScreen({ kind: 'list' })}
        onCharter={(step, cat, scope) =>
          setScreen(scope === 'catalogue'
            ? { kind: 'charter', step, returnTo: id, catalogue: { id: cat.id, title: cat.title } }
            : { kind: 'charter', step, returnTo: id, gammes: catalogueGammes(cat) })}
      />
    )
  }
  if (screen.kind === 'charter') {
    const returnTo = screen.returnTo
    return (
      <CharterAssistant
        step={screen.step}
        gammes={screen.gammes}
        catalogue={screen.catalogue}
        backLabel={returnTo !== undefined ? '‹ Retour au catalogue' : undefined}
        doneLabel={returnTo !== undefined ? 'Enregistrer et revenir au catalogue' : 'Enregistrer et revenir à la liste'}
        onBack={() => setScreen(returnTo !== undefined ? { kind: 'editor', id: returnTo } : { kind: 'list' })}
      />
    )
  }
  return (
    <CatalogueList
      onBrochure={onBrochure}
      onOpen={(id) => setScreen({ kind: 'editor', id })}
      onCharter={() => setScreen({ kind: 'charter' })}
      onBrandPages={(cat) => setScreen({ kind: 'charter', step: 1, catalogue: { id: cat.id, title: cat.title } })}
    />
  )
}

// =================================================================================================
// Liste et création
// =================================================================================================

function CatalogueList({ onOpen, onCharter, onBrandPages, onBrochure }: { onOpen: (id: number) => void; onCharter: () => void; onBrandPages: (cat: Catalogue) => void; onBrochure?: (format: BrochureKind) => void }) {
  const [owner, setOwner] = useState<'' | api.CatalogueOwner>('')
  const [revision, setRevision] = useState(0)
  const list = useAsync(() => api.listCatalogues(owner ? { owner } : {}), [owner, revision])
  const shops = useAsync(() => api.listShops(), [])
  // Les conditions du bon de commande que les boutiques ont réglées (lecture seule, 25/11/2026).
  const orderConditions = useAsync(() => api.listOrderConditions(), [])
  // Ce qu'on crée (21/11/2026, fusion des imprimés) : un catalogue, un leaflet A5 ou un dépliant A4 ; null : rien.
  const [creating, setCreating] = useState<CatalogueSupport | null>(null)
  const [kindFilter, setKindFilter] = useState<'' | CatalogueSupport>('')
  const [deleting, setDeleting] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const createRef = useRef<HTMLDivElement>(null)

  const shopNames = useMemo(() => new Map((shops.data ?? []).map((shop) => [shop.id, shop.name])), [shops.data])
  const shown = (list.data?.items ?? []).filter((cat) => kindFilter === '' || supportOf(cat) === kindFilter)

  /**
   * Effacer un catalogue depuis la liste (21/11/2026, Sam : « je dois pouvoir effacer les catalogues »),
   * quel que soit son état ou son auteur : le siège efface aussi ceux des franchisés. La suppression
   * est définitive ; la réception par les boutiques et les liens en ligne partent avec le catalogue.
   */
  function remove(cat: Catalogue) {
    const consequences = [
      cat.owner === 'boutique' ? `Il disparaît aussi du dashboard de ${cat.shop?.name ?? 'la boutique'}.` : null,
      cat.owner === 'marque' && cat.shopIds.length ? 'Les boutiques qui l’ont reçu ne le verront plus.' : null,
      cat.status !== 'brouillon' ? `Il est à l’état « ${STATUS_LABELS[cat.status]} ».` : null,
      'Ses liens en ligne cesseront de marcher. C’est définitif.',
    ].filter((line): line is string => line !== null)
    if (!window.confirm(`Supprimer le ${SUPPORT_NOUNS[supportOf(cat)]} « ${cat.title} » ?\n\n${consequences.join('\n')}`)) return
    setDeleting(cat.id)
    setDeleteError(null)
    api
      .deleteCatalogue(cat.id)
      .then(() => setRevision((n) => n + 1))
      .catch((cause: unknown) => setDeleteError(`« ${cat.title} » n’a pas été supprimé : ${message(cause)}`))
      .finally(() => setDeleting(null))
  }

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
        <span className="bro-seg" role="group" aria-label="Imprimés">
          {([['', 'Tout'], ['catalogue', 'Catalogues'], ['leaflet', 'Leaflets'], ['depliant', 'Dépliants']] as const).map(([value, label]) => (
            <button key={value} type="button" className={kindFilter === value ? 'is-on' : ''} onClick={() => setKindFilter(value)}>
              {label}
            </button>
          ))}
        </span>
        <span className="catv-grow" />
        <button type="button" className="btn" onClick={onCharter} title="Couverture, page 2, avant-dernière et dernière page : les 4 pages que reçoit chaque catalogue">
          ✎ Modifier les pages de la marque
        </button>
        {/* Les trois formats d'un imprimé (21/11/2026, fusion, étape 2) : le leaflet et le dépliant se font comme un catalogue. */}
        {([
          ['catalogue', '＋ Nouveau catalogue', 'Un catalogue de 8 à 16 pages', 'btn btn--primary'],
          ['leaflet', '＋ Leaflet A5', 'Un leaflet A5 recto-verso : les produits d’une gamme, d’une campagne ou au choix', 'btn'],
          ['depliant', '＋ Dépliant A4', 'Un dépliant A4 trois volets : les produits d’une gamme, d’une campagne ou au choix', 'btn'],
        ] as const).map(([support, label, title, className]) => (
          <button
            key={support}
            type="button"
            className={className}
            title={title}
            onClick={() => {
              setCreating(support)
              window.setTimeout(() => createRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div ref={createRef}>
        <NewCatalogue open={creating !== null} support={creating ?? 'catalogue'} onSupport={setCreating} onOpen={() => setCreating((current) => current ?? 'catalogue')} onCreated={onOpen} onBrochure={onBrochure} />
      </div>

      <BrochuresToImport onOpen={onOpen} revision={revision} onImported={() => setRevision((n) => n + 1)} />

      <section className="card catv-recent">
        <h2>Imprimés récents</h2>
        {list.error ? <p className="error">{list.error}</p> : null}
        {deleteError ? <p className="error">{deleteError}</p> : null}
        {list.loading && !list.data ? <p className="muted">Lecture des catalogues…</p> : null}
        {list.data && list.data.items.length === 0 ? <p className="muted">Aucun imprimé pour l’instant.</p> : null}
        {list.data && list.data.items.length > 0 && shown.length === 0 ? <p className="muted">Aucun {kindFilter === 'leaflet' ? 'leaflet' : kindFilter === 'depliant' ? 'dépliant' : 'catalogue'} pour l’instant.</p> : null}
        {list.data && shown.length > 0 ? (
          <div className="table-scroll">
            <table className="catv-table">
              <thead>
                <tr>
                  <th>Imprimé</th>
                  <th>Par</th>
                  <th>Source</th>
                  <th>Format</th>
                  <th>Boutiques</th>
                  <th>État</th>
                  <th>Bon de commande</th>
                  <th aria-label="Supprimer ou modifier" />
                </tr>
              </thead>
              <tbody>
                {shown.map((cat) => (
                  <tr key={cat.id}>
                    <td>{cat.title}</td>
                    <td>{cat.owner === 'marque' ? 'Marque' : `${cat.shop?.name ?? 'Boutique'} (franchisé)`}</td>
                    <td>
                      <span className="bro-tag">
                        {cat.source.kind === 'choix' ? `Au choix · ${cat.productCount} produits` : `${cat.source.label ?? SOURCE_LABELS[cat.source.kind]}`}
                      </span>
                    </td>
                    <td>{isLeaflet(cat) ? <span className="bro-tag">{SUPPORT_LABELS[supportOf(cat)]}</span> : `${cat.pageCount} pages ${cat.format}`}</td>
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
                    <td>
                      <OrderFormCell cat={cat} conditions={orderConditions.error ? [] : orderConditions.data} />
                    </td>
                    <td className="catv-right catv-row-actions">
                      <OrderFormMenu cat={cat} shopNames={shopNames} conditions={orderConditions.data} />
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={deleting !== null}
                        aria-label={`Supprimer le catalogue « ${cat.title} »`}
                        onClick={() => remove(cat)}
                      >
                        {deleting === cat.id ? 'Suppression…' : 'Supprimer'}
                      </button>
                      {/* Deux boutons (21/11/2026, Sam) : les 4 pages de la marque de CE catalogue, puis son contenu. Un
                          catalogue de franchisé garde les pages communes : il n'a que son contenu. */}
                      {cat.owner === 'marque' ? (
                        <button
                          type="button"
                          className="btn btn--sm catv-edit"
                          disabled={deleting === cat.id}
                          aria-label={`Modifier les pages de la marque du catalogue « ${cat.title} »`}
                          title="Couverture, page 2, avant-dernière et dernière page de ce catalogue seulement"
                          onClick={() => onBrandPages(cat)}
                        >
                          ✎ Pages de la marque
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--sm catv-edit"
                        disabled={deleting === cat.id}
                        aria-label={`Modifier le contenu du catalogue « ${cat.title} »`}
                        title="Les produits et les pages intérieures du catalogue"
                        onClick={() => onOpen(cat.id)}
                      >
                        ✎ Contenu
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

/**
 * Les brochures du générateur d'avant (21/11/2026, fusion des imprimés, étape 3) : les leaflets et dépliants réglés dans
 * une campagne, à reprendre ici. « Reprendre » en fait un leaflet ou un dépliant des Imprimés (modèle, textes, produits,
 * boutiques) et dit ce qui ne passe pas ; une brochure reprise s'ouvre. L'ancien réglage reste lisible dans l'onglet
 * « Ancien générateur ».
 */
function BrochuresToImport({ onOpen, revision, onImported }: { onOpen: (id: number) => void; revision: number; onImported: () => void }) {
  const list = useAsync(() => api.listCatalogueBrochures(), [revision])
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: number; title: string; existing: boolean; notes: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = list.data ?? []
  if (!rows.length && !done) return null
  const waiting = rows.filter((row) => row.catalogueId === null).length

  async function reprendre(row: api.CatalogueBrochure) {
    const key = `${row.campaignId}|${row.format}`
    setBusy(key)
    setError(null)
    try {
      const result = await importBrochure(row.campaignId, row.format)
      setDone({ id: result.catalogue.id, title: result.catalogue.title, existing: result.existing, notes: result.notes })
      onImported()
    } catch (cause) {
      setError(`« ${row.campaignName} » n’a pas été repris : ${message(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card catv-import">
      <h2>Leaflets et dépliants des campagnes · {waiting ? `${waiting} à reprendre` : 'tous repris'}</h2>
      <p className="catv-newnote">
        Réglés avec l’ancien générateur, dans une campagne. « Reprendre » en fait un leaflet ou un dépliant d’ici : son modèle, ses textes, ses produits et
        ses boutiques ; les prix viennent du webshop de chaque boutique. L’ancien réglage ne change pas.
      </p>
      {done ? (
        <div className="catv-imported">
          <b>
            {done.existing ? 'Déjà repris' : 'Repris'} : « {done.title} »
          </b>
          {done.notes.length ? (
            <ul>
              {done.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : (
            <span> Tout est passé.</span>
          )}
          <button type="button" className="btn btn--primary btn--sm" onClick={() => onOpen(done.id)}>
            Ouvrir ›
          </button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {list.error ? <p className="error">{list.error}</p> : null}
      <div className="table-scroll">
        <table className="catv-table">
          <thead>
            <tr>
              <th>Campagne</th>
              <th>Format</th>
              <th>Modèle</th>
              <th>Produits</th>
              <th>Réglé le</th>
              <th aria-label="Reprendre ou ouvrir" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.campaignId}|${row.format}`
              return (
                <tr key={key}>
                  <td>{row.campaignName}</td>
                  <td>
                    <span className="bro-tag">{row.support ? SUPPORT_LABELS[row.support] : row.format}</span>
                  </td>
                  <td>{TEMPLATES.find((t) => t.id === row.template)?.name ?? row.template ?? '—'}</td>
                  <td>{row.productCount}</td>
                  <td>{new Date(row.updatedAt).toLocaleDateString('fr-BE')}</td>
                  <td className="catv-right">
                    {row.catalogueId !== null ? (
                      <button type="button" className="btn btn--sm catv-edit" onClick={() => onOpen(row.catalogueId as number)}>
                        Ouvrir le repris
                      </button>
                    ) : (
                      <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => void reprendre(row)}>
                        {busy === key ? 'Reprise…' : 'Reprendre'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function NewCatalogue({
  open,
  support,
  onSupport,
  onOpen,
  onCreated,
  onBrochure,
}: {
  open: boolean
  /** Ce qu'on crée : un catalogue, un leaflet A5, un dépliant A4 (21/11/2026). */
  support: CatalogueSupport
  onSupport: (support: CatalogueSupport) => void
  onOpen: () => void
  onCreated: (id: number) => void
  /** L'ancien générateur de brochures, depuis le dossier d'impression d'une campagne. */
  onBrochure?: (format: BrochureKind) => void
}) {
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

  const leaflet = support !== 'catalogue'
  const what = SUPPORT_NOUNS[support]
  const suggestion =
    kind === 'gamme' ? `${nomsChoisis.join(' + ') || 'Gamme'} ${new Date().getFullYear()} — ${leaflet ? what : 'catalogue du réseau'}`
    : kind === 'campagne' ? `${sorted.find((c) => c.id === campaign)?.name ?? 'Campagne'} — ${what}`
    : `${leaflet ? SUPPORT_LABELS[support] : 'Catalogue'} — produits choisis`

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const created = await api.createCatalogue({
        title: title.trim() || suggestion,
        ...(leaflet ? { support } : { pageCount }),
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
      <div className="catv-newhead">
        <h2>Nouveau {what} · d’où partent les produits</h2>
        <span className="bro-seg" role="group" aria-label="Imprimé">
          {(['catalogue', 'leaflet', 'depliant'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={open && support === value ? 'is-on' : ''}
              onClick={() => {
                onSupport(value)
                onOpen()
              }}
            >
              {value === 'catalogue' ? 'Catalogue · 8 à 16 pages' : SUPPORT_LABELS[value]}
            </button>
          ))}
        </span>
      </div>
      {open && leaflet ? (
        <p className="catv-newnote">
          {support === 'leaflet' ? 'Recto-verso, 148 × 210 mm, 6 produits au plus.' : 'Trois volets roulés, 297 × 210 mm, 9 produits au plus.'} Les produits, leurs prix par boutique, le titre et le visuel de la
          couverture et le QR de la dernière page viennent du catalogue ; il s’imprime dans un des modèles des brochures.
          {onBrochure ? (
            <>
              {' '}
              <button type="button" className="linklike" onClick={() => onBrochure(support === 'leaflet' ? 'leaflet-a5' : 'depliant-a4')}>
                Ou depuis le dossier d’impression d’une campagne ›
              </button>
            </>
          ) : null}
        </p>
      ) : null}
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
          {leaflet ? null : (
            <div className="catv-field">
              <span>Nombre de pages · dont 4 de la marque</span>
              <PageCountChoice value={pageCount} onChange={setPageCount} />
            </div>
          )}
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
            {busy ? 'Création…' : `Créer le ${what}`}
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

/**
 * Ouvrir l'assistant des pages de la marque à une étape : `catalogue`, les pages de CE catalogue de la marque (une page
 * modifiée devient la sienne) ; `common`, celles de tous les catalogues (la charte), sur la couverture du catalogue.
 */
type OpenCharter = (step: CharterStep, cat: Catalogue, scope: 'catalogue' | 'common') => void

const SLOT_OF_STEP: Record<CharterStep, api.CatalogueBrandSlot | null> = { 1: 'cover', 2: 'page2', 3: 'penultimate', 4: 'back', 5: null }

/** L'étape de l'assistant qui règle une page de la marque. */
function charterStepOf(page: CatalogueDocument['pages'][number]): CharterStep | null {
  if (page.kind === 'cover') return 1
  if (page.kind === 'brand') return page.slot === 'page2' ? 2 : 3
  if (page.kind === 'back') return 4
  return null
}

/** Les gammes d'un catalogue « Gamme », dans l'ordre où l'API cherche leur couverture. */
function catalogueGammes(cat: Catalogue): number[] {
  if (cat.source.kind !== 'gamme') return []
  const refs = cat.source.refs ?? (cat.source.ref ? cat.source.ref.split(',') : [])
  return refs.map(Number).filter((id) => Number.isInteger(id) && id > 0)
}

function Editor({ id, onBack, onCharter }: { id: number; onBack: () => void; onCharter: OpenCharter }) {
  const loaded = useAsync(() => api.getCatalogue(id), [id])
  const shops = useAsync(() => api.listShops(), [])

  if (loaded.error) {
    return (
      <div className="catv">
        <button type="button" className="linklike" onClick={onBack}>
          ‹ Imprimés
        </button>
        <p className="error">{loaded.error}</p>
      </div>
    )
  }
  if (!loaded.data || shops.loading) return <p className="muted">Ouverture du catalogue…</p>
  return <EditorBody key={loaded.data.id} initial={loaded.data} shops={shops.data ?? []} onBack={onBack} onCharter={onCharter} />
}

function EditorBody({ initial, shops, onBack, onCharter }: { initial: Catalogue; shops: api.Shop[]; onBack: () => void; onCharter: OpenCharter }) {
  const [cat, setCat] = useState<Catalogue>(initial)
  // Un leaflet A5 ou un dépliant A4 (21/11/2026) : le même catalogue, son assistant à lui, imprimé au format de la brochure.
  const leaflet = isLeaflet(initial)
  // Un catalogue de la marque a ses pages de la marque à lui (21/11/2026) ; un catalogue de boutique garde celles de la charte.
  const brandOwned = initial.owner === 'marque'
  const ownSlots = new Set(initial.brandPagesOwn ?? [])
  const isOwn = (page: CatalogueDocument['pages'][number]): boolean => {
    const step = charterStepOf(page)
    const slot = step !== null ? SLOT_OF_STEP[step] : null
    return slot !== null && ownSlots.has(slot)
  }
  const ownTag = (slot: api.CatalogueBrandSlot) => (ownSlots.has(slot) ? <span className="bro-tag catv-owntag">à lui</span> : null)
  const [lang, setLang] = useState<CatalogueLang>(initial.langs[0] ?? 'fr')
  const [versionShop, setVersionShop] = useState<number | null>(initial.owner === 'boutique' ? null : null)
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [save, setSave] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ status: 'idle' })
  const [printError, setPrintError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  // L'assistant (21/11/2026) : son étape, et « Réglages page par page » (l'éditeur détaillé) ; gardés le temps de la
  // session, pour revenir au même endroit après les pages de la marque.
  const memo = `catv-wizard-${initial.id}`
  const [wizStep, setWizStepState] = useState<WizardStep>(() => {
    const saved = Number(window.sessionStorage.getItem(memo)?.split(':')[0])
    return saved >= 1 && saved <= 5 ? (saved as WizardStep) : 1
  })
  const [detail, setDetailState] = useState<boolean>(() => window.sessionStorage.getItem(memo)?.split(':')[1] === 'd')
  useEffect(() => {
    window.sessionStorage.setItem(memo, `${wizStep}:${detail ? 'd' : ''}`)
  }, [memo, wizStep, detail])
  const setWizStep = (next: WizardStep) => {
    setDetailState(false)
    setWizStepState(next)
    window.scrollTo({ top: 0 })
  }

  /** « ↻ Relire le webshop » : 0 = lecture gardée (30 min), puis chaque clic relit l'ERP. */
  const [reread, setReread] = useState(0)
  const webshop = useAsync(
    () => api.getWebshopProducts(cat.owner === 'boutique' && cat.shop ? [cat.shop.id] : cat.shopIds, reread > 0),
    [cat.shopIds.join(','), cat.owner, reread],
  )
  // Le webshop relu : l'aperçu se recompose avec les produits, prix et promotions à jour.
  useEffect(() => {
    if (reread > 0 && !webshop.loading) setRevision((n) => n + 1)
  }, [reread, webshop.loading])
  const doc = useAsync(() => api.getCatalogueDocument(cat.id, lang, versionShop), [cat.id, lang, versionShop, revision])

  // --- enregistrement : chaque modification part tout de suite, la composition suit ---
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  /** La dernière erreur d'enregistrement (null : tout est passé) et le dernier titre enregistré. */
  const failed = useRef<string | null>(null)
  const savedTitle = useRef(initial.title)
  function change(patch: api.CatalogueUpdate) {
    setCat((current) => ({ ...current, ...patch }))
    setSave({ status: 'saving' })
    queue.current = queue.current
      .then(() => api.updateCatalogue(cat.id, patch))
      .then((saved) => {
        failed.current = null
        savedTitle.current = saved.title
        setCat(saved)
        setSave({ status: 'saved' })
        setRevision((value) => value + 1)
      })
      .catch((cause: unknown) => {
        failed.current = message(cause)
        setSave({ status: 'error', text: message(cause) })
      })
  }

  /**
   * « Enregistrer » (21/11/2026, Sam : « quand je modifie je ne sais pas enregistrer ») : chaque modification part déjà
   * toute seule ; le bouton envoie le titre en cours de frappe, attend la fin des envois et le dit, avec l'heure.
   */
  const [saving, setSaving] = useState(false)
  async function saveAll() {
    setSaving(true)
    const typed = cat.title.trim()
    if (typed !== '' && typed !== savedTitle.current) change({ title: typed })
    await queue.current
    setSaving(false)
    if (failed.current !== null) setSave({ status: 'error', text: `Non enregistré : ${failed.current}` })
    else setSave({ status: 'saved', text: `✓ Enregistré à ${new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}` })
  }

  const products = webshop.data?.products ?? []
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const categories = useMemo(() => new Map((webshop.data?.categories ?? []).map((c) => [c.id, c])), [webshop.data])
  const shopName = (shopId: number) => shops.find((shop) => shop.id === shopId)?.name ?? `#${shopId}`
  const versionShops = cat.owner === 'boutique' ? [] : cat.shopIds
  const orderConditions = useAsync(() => api.listOrderConditions(), [])
  const shopNameMap = useMemo(() => new Map(shops.map((shop) => [shop.id, shop.name])), [shops])
  const inCatalogue = new Set(cat.products.map((row) => row.id))

  // Les produits proposés (26/11/2026, client : « je ne vois pas toutes les catégories ») : les catégories du catalogue
  // d'abord (ses produits dans son ordre, puis les autres produits du webshop de la même catégorie, décochés) ; ensuite
  // chaque autre catégorie du webshop des boutiques du catalogue, repliée, à ajouter d'un clic.
  const needle = search.trim().toLowerCase()
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle)
  type Entry = { row: api.CatalogueProductRow; product: api.WebshopProduct | null }
  const groupOf = (product: api.WebshopProduct | null) =>
    product?.categoryId != null ? (categories.get(product.categoryId)?.name ?? 'Autres') : product ? 'Autres' : 'Absents du webshop'
  const groups = new Map<string, Entry[]>()
  for (const row of cat.products) {
    const product = byId.get(row.id) ?? null
    if (!matches(product?.name ?? String(row.id))) continue
    const key = groupOf(product)
    groups.set(key, [...(groups.get(key) ?? []), { row, product }])
  }
  const catalogueGroups = new Set(cat.products.map((row) => groupOf(byId.get(row.id) ?? null)))
  const others = new Map<string, { categoryId: number | null; entries: Entry[] }>()
  for (const product of products) {
    if (inCatalogue.has(product.id)) continue
    const key = groupOf(product)
    const entry = { row: { id: product.id, on: false }, product }
    if (catalogueGroups.has(key)) {
      if (matches(product.name)) groups.set(key, [...(groups.get(key) ?? []), entry])
      continue
    }
    const other = others.get(key) ?? { categoryId: product.categoryId ?? null, entries: [] }
    other.entries.push(entry)
    others.set(key, other)
  }
  const otherList = [...others.entries()]
    .map(([name, other]) => ({ name, ...other, shown: other.entries.filter(({ product }) => matches(product?.name ?? '')) }))
    .filter(({ name, shown }) => shown.length > 0 || matches(name))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  // Les familles du catalogue du Marketing dont aucun produit n'est sur le webshop : nommées, pas ajoutables.
  const offWebshop = (webshop.data?.offWebshopCategories ?? []).filter((c) => !others.has(c.name) && !groups.has(c.name) && matches(c.name))
  const checked = cat.products.filter((row) => row.on).length

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
    change({ pages: innerPages.map((page) => (isPresentation(page.layout) ? page : { ...page, layout, product: layout === 'pleine' ? page.product : undefined })) })
  }
  /** L'en-tête de toutes les pages de produits (les présentations ont le leur). */
  function setAllHeaders(header: api.CatalogueHeader) {
    change({ pages: innerPages.map((page) => (isPresentation(page.layout) ? page : { ...page, header })) })
  }
  /** La catégorie en lettres manuscrites, sur toutes les pages de produits. */
  function setAllScript(script: boolean) {
    change({ pages: innerPages.map((page) => (isPresentation(page.layout) ? page : { ...page, script })) })
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
      // Le produit choisi n'a de sens que pour une pleine page (le serveur le refuse ailleurs).
      setPage(index, { layout, text: undefined, textNl: undefined, product: layout === 'pleine' ? page.product : undefined })
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
    if (leaflet) return printLeaflet(mode, all)
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

  /**
   * Un leaflet ou un dépliant (21/11/2026) : chaque version composée par l'API, mise au format de la brochure, recto puis
   * verso. Le PDF de l'imprimeur ne prend que les versions sans point bloquant ; l'épreuve les prend toutes, marquées.
   */
  async function printLeaflet(mode: CatalogueSheetMode, all: boolean) {
    setPrintError(null)
    const win = window.open('', '_blank')
    if (!win) {
      setPrintError('Le navigateur a bloqué la fenêtre d’impression : autorisez les fenêtres pour ce site, puis recommencez.')
      return
    }
    win.document.write('<p style="font-family:system-ui;padding:24px">Composition de l’imprimé…</p>')
    try {
      const versions: Array<{ lang: CatalogueLang; shop: number | null }> = all
        ? cat.langs.flatMap((l) => [{ lang: l, shop: null as number | null }, ...versionShops.map((s) => ({ lang: l, shop: s as number | null }))])
        : [{ lang, shop: versionShop }]
      const docs = await Promise.all(versions.map((v) => api.getCatalogueDocument(cat.id, v.lang, v.shop)))
      const rows = docs.map((one) => ({ one, blocked: leafletBlocked(leafletChecks(cat, one)) }))
      const printer = mode === 'printer'
      const kept = printer ? rows.filter((row) => !row.blocked) : rows
      if (!kept.length) {
        win.close()
        setPrintError(all ? 'Aucune version n’est prête : chacune a un point bloquant (voir la validation).' : 'Cette version a un point bloquant : voir la validation. L’épreuve reste possible.')
        return
      }
      const sheetMode = printer ? 'printer' : 'proof'
      const pages = kept.map(({ one, blocked }) => ({ doc: leafletDoc({ cat, doc: one, proof: !printer }), blocked }))
      const container = document.createElement('div')
      const root = createRoot(container)
      flushSync(() =>
        root.render(
          <>
            {pages.flatMap(({ doc: one, blocked }, d) =>
              ([0, 1] as Side[]).map((side) => <BrochureSheet key={`${d}-${side}`} doc={one} side={side} mode={sheetMode} marks watermark={!printer && blocked} />),
            )}
          </>,
        ),
      )
      const markup = container.innerHTML
      root.unmount()
      const label = all ? `${kept.length} versions` : versionShop !== null ? shopName(versionShop) : 'générale'
      const failure = openPrintWindow({
        title: [cat.title, SUPPORT_LABELS[supportOf(cat)], label, all ? null : lang.toUpperCase(), printer ? 'imprimeur' : 'épreuve'].filter(Boolean).join(' – '),
        markup,
        css: `${fontFaces()}\n${BROCHURE_CSS}`,
        size: brochurePageSize(pages[0].doc, sheetMode, true),
        pageClass: 'bro-page',
        target: win,
      })
      if (failure) setPrintError(failure)
      else if (kept.length < rows.length) setPrintError(`${rows.length - kept.length} version(s) écartée(s) du PDF : point bloquant (voir la validation).`)
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
  const currentScript: boolean | null = selectedPage ? !!selectedPage.script
    : productPages.length && productPages.every((p) => !!p.script === !!productPages[0].script) ? !!productPages[0].script : null
  const currentTemplate: CatalogueTemplate | null = selectedPage ? (selectedPage.template ?? 'A')
    : innerPages.length && innerPages.every((p) => (p.template ?? 'A') === (innerPages[0].template ?? 'A')) ? (innerPages[0].template ?? 'A') : null

  /** Une ligne de produit : sa photo, son nom, ses alertes, son prix et sa bascule. */
  function productRow({ row, product }: { row: api.CatalogueProductRow; product: api.WebshopProduct | null }) {
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
  }

  // Les produits et les promotions : dans l'étape 2 de l'assistant, et dans l'éditeur détaillé.
  const readAtLabel = (() => {
    const times = (webshop.data?.shops ?? []).map((s) => s.readAt).filter((t): t is string => !!t).sort()
    return times.length ? new Date(times[0]).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null
  })()
  const productsPanel = (
    <section className="card catv-col">
      <h2>
        Produits · {sourceLabel} ({cat.products.length})
      </h2>
      <div className="catv-search">
        <input placeholder="Chercher…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <span className="bro-tag">{checked} cochés</span>
        <button
          type="button"
          className="btn btn--sm catv-reread"
          disabled={webshop.loading}
          onClick={() => setReread((n) => n + 1)}
          title={`Relit tout de suite le webshop (produits, catégories, prix, photos, gammes et promotions) au lieu de la lecture gardée 30 minutes.${readAtLabel ? ` Dernière lecture : ${readAtLabel}.` : ''}`}
        >
          {webshop.loading ? 'Lecture…' : '↻ Relire le webshop'}
        </button>
      </div>
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
            {open ? entries.map(productRow) : null}
          </div>
          )
        })}
        {otherList.length || offWebshop.length ? (
          <p className="catv-sep" title="Les catégories du webshop des boutiques du catalogue qui n'ont encore aucun produit dans ce catalogue. « ＋ Ajouter » coche tous leurs produits et leur donne une page.">
            Autres catégories du webshop · {otherList.length + offWebshop.length}
          </p>
        ) : null}
        {otherList.map(({ name, categoryId, entries, shown }) => {
          const key = `autre:${name}`
          const open = needle !== '' ? shown.length > 0 : (opened?.has(key) ?? false)
          const ids = entries.map(({ row }) => row.id)
          return (
            <div key={key} className={`catv-acc catv-acc--other${open ? ' is-open' : ''}`}>
              <div className="catv-acc__head">
                <button type="button" className="catv-acc__title" aria-expanded={open} onClick={() => flip(key)}>
                  <span className="catv-acc__chev" aria-hidden="true">›</span>
                  <span className="catv-acc__name">{name}</span>
                  <span className="catv-acc__count">
                    {entries.length} produit{entries.length > 1 ? 's' : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn--sm catv-acc__add"
                  title={`Ajouter les ${entries.length} produit${entries.length > 1 ? 's' : ''} de « ${name} », cochés, avec leur page`}
                  onClick={() => {
                    if (categoryId !== null) addCategory(categoryId, name, ids)
                    else toggleProducts(ids, true)
                    setOpened((prev) => new Set([...(prev ?? []), name]))
                  }}
                >
                  ＋ Ajouter
                </button>
              </div>
              {open ? (needle !== '' ? shown : entries).map(productRow) : null}
            </div>
          )
        })}
        {offWebshop.map((c) => (
          <div
            key={`hors:${c.name}`}
            className="catv-acc catv-acc--off"
            title={`Catégorie du catalogue du Marketing (repris de l'ERP) : aucun de ses produits n'est actif sur le webshop ${cat.owner === 'boutique' ? 'de la boutique' : 'des boutiques du catalogue'}. Sans prix ni photo du webshop, elle ne peut pas aller au catalogue : l'activer d'abord sur le webshop.`}
          >
            <div className="catv-acc__head">
              <span className="catv-acc__title catv-acc__title--static">
                <span className="catv-acc__chev" aria-hidden="true" />
                <span className="catv-acc__name">{lang === 'nl' ? c.nameNl : c.name}</span>
                <span className="catv-acc__count">
                  {c.products} produit{c.products > 1 ? 's' : ''}
                </span>
              </span>
              <span className="catv-acc__badge">pas sur le webshop</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
  const offersPanel = (
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
  )
  /** Une page de la marque de l'aperçu : ouvre son étape dans l'assistant des pages de la marque. */
  function openBrandPage(docIndex: number) {
    const page = docPages[docIndex]
    const step = page ? charterStepOf(page) : null
    if (step !== null) onCharter(step, cat, brandOwned ? 'catalogue' : 'common')
  }
  function deleteCatalogue() {
    if (window.confirm(`Supprimer « ${cat.title} » ?`)) void api.deleteCatalogue(cat.id).then(onBack, (cause: unknown) => setSave({ status: 'error', text: message(cause) }))
  }
  const wizardProps: WizardProps = {
    step: wizStep,
    setStep: setWizStep,
    cat,
    doc: doc.data ?? null,
    docError: doc.error ?? null,
    lang,
    setLang: (l) => {
      if (!cat.langs.includes(l)) change({ langs: [...cat.langs, l] })
      setLang(l)
    },
    versionShop,
    setVersionShop,
    versionShops,
    shops,
    shopName,
    products,
    byId,
    categories,
    webshopLoading: webshop.loading,
    busy: save.status === 'saving',
    change,
    onBrandPage: openBrandPage,
    onCommonBrandPages: () => onCharter(1, cat, 'common'),
    print: (mode, all) => void print(mode, all),
    openDetail: (index) => {
      setSelected(index)
      setDetailState(true)
      window.scrollTo({ top: 0 })
    },
    productsPanel,
    offersPanel,
    onDelete: deleteCatalogue,
  }

  return (
    <div className="catv catv-editor">
      <div className="catv-head">
        <div>
          <button type="button" className="linklike catv-back" onClick={onBack}>
            ‹ Imprimés
          </button>
          <p className="catv-kicker">
            {leaflet ? SUPPORT_LABELS[supportOf(cat)] : 'Catalogues'} · {sourceLabel} · webshop{cat.owner === 'boutique' ? ` · ${cat.shop?.name ?? ''} (franchisé)` : ''}
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
        <button type="button" className="btn" onClick={() => void print('printer', cat.owner === 'marque')}>
          PDF pour l’imprimeur
        </button>
        {/* Le bon de commande (25/11/2026) : le même menu que dans la liste, sur la langue et la version affichées. */}
        <OrderFormMenu key={`${lang}-${versionShop ?? 'g'}`} cat={cat} shopNames={shopNameMap} conditions={orderConditions.data} initialLang={lang} initialShop={versionShop} />
        <span className="catv-savebox">
          {/* Jamais désactivé par un envoi automatique : quitter le titre en cliquant ici en lance un, le clic doit passer. */}
          <button type="button" className="btn btn--primary" aria-busy={saving} onClick={() => void saveAll()}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {save.status === 'saved' && save.text ? <span className="catv-savebox__ok">{save.text}</span> : null}
          {save.status === 'error' ? <span className="error catv-savebox__ko">{save.text}</span> : null}
        </span>
      </div>
      {printError ? <p className="error">{printError}</p> : null}

      {detail && !leaflet ? (
        <>
      <div className="catv-detailbar">
        <button type="button" className="btn btn--sm" onClick={() => setDetailState(false)}>
          ‹ L’assistant
        </button>
        <span className="catv-detailbar__t">Réglages page par page</span>
        <span className="catv-grow" />
        <span className="muted">Tout ce que l’assistant règle, page par page ; glisser une page pour la déplacer.</span>
      </div>
      <div className="catv-body">
        {productsPanel}

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
                  onClick={() => {
                    const step = charterStepOf(page)
                    // Un catalogue de la marque : SES pages ; un catalogue de boutique : celles de tous (la charte).
                    if (step !== null) onCharter(step, cat, brandOwned ? 'catalogue' : 'common')
                    else setSelected(inner)
                  }}
                  title={page.locked
                    ? brandOwned
                      ? 'Page de la marque : cliquer pour la modifier pour ce catalogue seulement'
                      : 'Page de la marque : cliquer pour la modifier (pour tous les catalogues)'
                    : undefined}
                >
                  <span style={{ zoom }}>
                    <CatalogueSheet doc={doc.data as CatalogueDocument} index={index} mode="preview" />
                  </span>
                  {page.locked ? (
                    <span className={`catv-lock${isOwn(page) ? ' is-own' : ''}`}>
                      <LockIcon /> {isOwn(page) ? 'Ce catalogue' : 'Marque'} · ✎ modifier
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
                <div className="catv-field catv-script">
                  <span title="Le nom de la catégorie, sous celui de la gamme, en lettres manuscrites (Playwrite, la police manuscrite de la marque)">
                    Catégorie en lettres manuscrites{selectedPage ? '' : ' · toutes les pages'}
                  </span>
                  <span className="bro-seg">
                    {([[false, 'Non'], [true, 'Oui']] as const).map(([value, label]) => (
                      <button
                        key={label}
                        type="button"
                        disabled={!productPages.length}
                        className={currentScript === value ? 'is-on' : ''}
                        onClick={() => (selected !== null ? setPage(selected, { script: value }) : setAllScript(value))}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
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
            {selectedPage && selectedPage.layout === 'pleine' ? (
              <label className="catv-field">
                <span title="Le produit seul sur la page, avec sa promotion quand il en a une">Produit de la pleine page</span>
                <select value={selectedPage.product ?? ''} onChange={(event) => setPage(selected as number, { product: event.target.value ? Number(event.target.value) : null })}>
                  <option value="">Le premier de la catégorie</option>
                  {cat.products
                    .filter((row) => row.on)
                    .map((row) => byId.get(row.id))
                    .filter((product): product is api.WebshopProduct => !!product && (selectedPage.category === null || product.categoryId === selectedPage.category))
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {lang === 'nl' ? product.nameNl : product.name}
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

          {offersPanel}

          <section className="card">
            <h2>{brandOwned ? 'Pages de la marque' : 'Fixé par la marque'}</h2>
            <dl className="catv-dl">
              <dt>Logo</dt>
              <dd>{doc.data?.charter.logoUrl ? 'logo de la charte' : 'logo officiel'}</dd>
              <dt>Page 1</dt>
              <dd>Couverture « {docPages[0]?.kind === 'cover' ? docPages[0].title : '…'} »{ownTag('cover')}</dd>
              <dt>Page 2</dt>
              <dd>« {docPages[1]?.kind === 'brand' ? docPages[1].title : '…'} »{ownTag('page2')}</dd>
              <dt>Page {cat.pageCount - 1}</dt>
              <dd>« {docPages[docPages.length - 2]?.kind === 'brand' ? (docPages[docPages.length - 2] as { title: string }).title : '…'} »{ownTag('penultimate')}</dd>
              <dt>Page {cat.pageCount}</dt>
              <dd>Commande en ligne + boutique{ownTag('back')}</dd>
              <dt>Couleurs, polices</dt>
              <dd>charte</dd>
            </dl>
            <p className="catv-note">
              <LockIcon />{' '}
              {brandOwned
                ? 'Les pages communes à tous les catalogues, sauf celles que ce catalogue a à lui. Les franchisés ne peuvent pas les modifier.'
                : 'Réglés dans les pages de la marque, pour tous les catalogues : les franchisés ne peuvent pas les modifier.'}
            </p>
            {brandOwned ? (
              <>
                <button type="button" className="btn btn--sm catv-brand-edit" onClick={() => onCharter(1, cat, 'catalogue')}>
                  ✎ Modifier les pages de ce catalogue
                </button>
                <button type="button" className="linklike catv-brand-common" onClick={() => onCharter(1, cat, 'common')}>
                  Pages communes à tous les catalogues
                </button>
              </>
            ) : (
              <button type="button" className="btn btn--sm catv-brand-edit" onClick={() => onCharter(1, cat, 'common')}>
                ✎ Modifier les pages de la marque
              </button>
            )}
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
        </>
      ) : (
        leaflet ? <LeafletWizard {...wizardProps} /> : <CatalogueWizard {...wizardProps} />
      )}
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
