import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import * as api from '../../lib/api/module'
import type { MediaAsset, MediaFields, MediaLibrary, MediaQuery } from '../../lib/api/module'
import { useAsync } from '../../lib/useAsync'
import './media.css'

/**
 * La médiathèque commune du marketing.
 *
 * Une seule réserve de photos et de vidéos pour les posts et les publicités
 * (module Social), les visuels de campagne, les brochures, les bâches et les
 * affiches. Les fichiers sont gardés tels qu'ils arrivent : la fiche dit jusqu'à
 * quelle taille une photo s'imprime nettement, ce qui décide si elle peut servir
 * à une affiche A1 ou à une bâche.
 */

const PER_PAGE = 60

const SORTS: Array<{ value: string; label: string }> = [
  { value: '-createdAt', label: 'Plus récentes' },
  { value: 'createdAt', label: 'Plus anciennes' },
  { value: 'name', label: 'Nom (A → Z)' },
  { value: '-bytes', label: 'Plus lourdes' },
]

interface Upload {
  key: string
  name: string
  state: 'waiting' | 'sending' | 'done' | 'duplicate' | 'error'
  message?: string
}

export default function MediaLibraryView() {
  const [libraryKey, setLibraryKey] = useState(0)
  const library = useAsync(() => api.getMediaLibrary(), [libraryKey])
  const shops = useAsync(() => api.listShops(), [])
  const items = useAsync(() => api.listOfferItems(), [])

  const [query, setQuery] = useState<MediaQuery>({ sort: '-createdAt' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState<api.MediaPage | null>(null)
  const [list, setList] = useState<MediaAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  // La recherche part 300 ms après la dernière frappe.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery((q) => (q.name === search ? q : { ...q, name: search })), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listMedia({ ...query, page: 1, perPage: PER_PAGE })
      .then((result) => {
        if (cancelled) return
        setPage(result)
        setList(result.items)
      })
      .catch((cause: unknown) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [query, refreshKey])

  // Les compteurs des catégories suivent les dépôts, les retraits et les reclassements.
  useEffect(() => {
    if (refreshKey > 0) setLibraryKey((k) => k + 1)
  }, [refreshKey])

  async function loadMore() {
    if (!page || page.page >= page.totalPages) return
    setLoading(true)
    try {
      const next = await api.listMedia({ ...query, page: page.page + 1, perPage: PER_PAGE })
      setPage(next)
      setList((current) => current.concat(next.items.filter((item) => !current.some((c) => c.id === item.id))))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  const selected = list.find((item) => item.id === selectedId) ?? null

  const replace = useCallback((asset: MediaAsset) => {
    setList((current) => current.map((item) => (item.id === asset.id ? asset : item)))
  }, [])

  /** Dépose les fichiers un par un : une vidéo lourde ne bloque pas les photos qui suivent. */
  async function send(files: File[]) {
    const accepted = files.filter((file) => /^(image|video)\//.test(file.type))
    if (!accepted.length) return
    const batch: Upload[] = accepted.map((file, i) => ({ key: `${Date.now()}-${i}`, name: file.name, state: 'waiting' }))
    setUploads((current) => batch.concat(current).slice(0, 30))

    const fields: MediaFields = {}
    // Déposé depuis une catégorie ouverte : le fichier y est rangé d'emblée.
    if (query.category && query.category !== 'none') fields.category = query.category
    if (query.subcategory) fields.subcategory = query.subcategory
    if (query.season) fields.season = query.season

    let last: MediaAsset | null = null
    for (const [i, file] of accepted.entries()) {
      const key = batch[i].key
      const mark = (patch: Partial<Upload>) => setUploads((current) => current.map((u) => (u.key === key ? { ...u, ...patch } : u)))
      const limits = library.data?.limits
      const limit = file.type.startsWith('video/') ? limits?.videoMaxBytes : limits?.imageMaxBytes
      if (limit && file.size > limit) {
        mark({ state: 'error', message: `trop lourd (${humanBytes(file.size)}, maximum ${humanBytes(limit)})` })
        continue
      }
      if (limits?.serverMaxBytes && file.size > limits.serverMaxBytes) {
        mark({
          state: 'error',
          message: `le serveur refuse les envois de plus de ${humanBytes(limits.serverMaxBytes)} (réglage post_max_size de PHP) — ce fichier en fait ${humanBytes(file.size)}`,
        })
        continue
      }
      mark({ state: 'sending' })
      try {
        const { media, duplicate } = await api.uploadMedia(file, { ...fields, name: nameFromFile(file.name) })
        let asset = media
        if (media.kind === 'video' && !media.thumbnailUrl) {
          const poster = await videoPoster(file)
          if (poster) asset = await api.setMediaThumbnail(media.id, poster).catch(() => media)
        }
        last = asset
        mark({ state: duplicate ? 'duplicate' : 'done', message: duplicate ? `déjà dans la médiathèque (« ${asset.name} »)` : undefined })
      } catch (cause) {
        mark({ state: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    setRefreshKey((k) => k + 1)
    if (last) setSelectedId(last.id)
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void send(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void send(Array.from(event.dataTransfer.files ?? []))
  }

  const lib = library.data
  const total = page?.total ?? 0

  if (library.error) return <p className="error">{library.error}</p>

  return (
    <div
      className={`media${dragging ? ' is-dragging' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <aside className="media__cats card" aria-label="Catégories">
        <button type="button" className={`media__cat${!query.category ? ' is-on' : ''}`} onClick={() => setQuery((q) => ({ ...q, category: undefined, subcategory: undefined }))}>
          Toutes <span>{lib?.counts.all || ''}</span>
        </button>
        <button type="button" className={`media__cat${query.category === 'none' ? ' is-on' : ''}`} onClick={() => setQuery((q) => ({ ...q, category: 'none', subcategory: undefined }))}>
          Non classées <span>{lib?.counts.uncategorized || ''}</span>
        </button>
        {lib?.categories.map((cat) => (
          <div key={cat.code}>
            <button
              type="button"
              className={`media__cat${query.category === cat.code && !query.subcategory ? ' is-on' : ''}`}
              onClick={() => setQuery((q) => ({ ...q, category: cat.code, subcategory: undefined }))}
            >
              {cat.label} <span>{cat.files || ''}</span>
            </button>
            {query.category === cat.code
              ? cat.subcategories.map((sub) => (
                  <button
                    key={sub.code}
                    type="button"
                    className={`media__cat media__cat--sub${query.subcategory === sub.code ? ' is-on' : ''}`}
                    onClick={() => setQuery((q) => ({ ...q, subcategory: sub.code }))}
                  >
                    {sub.label} <span>{sub.files || ''}</span>
                  </button>
                ))
              : null}
          </div>
        ))}
        <hr />
        <label className="media__check">
          <input type="checkbox" checked={query.archived === true} onChange={(e) => setQuery((q) => ({ ...q, archived: e.target.checked || undefined }))} />
          Fichiers retirés{lib?.counts.archived ? ` (${lib.counts.archived})` : ''}
        </label>
      </aside>

      <section className="media__main">
        <div className="media__bar">
          <input className="media__search" type="search" placeholder="Rechercher un nom, une catégorie, un produit…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="seg" role="group" aria-label="Type de fichier">
            {([undefined, 'image', 'video'] as const).map((kind) => (
              <button key={kind ?? 'all'} type="button" className={query.kind === kind ? 'is-on' : ''} onClick={() => setQuery((q) => ({ ...q, kind }))}>
                {kind === 'image' ? 'Photos' : kind === 'video' ? 'Vidéos' : 'Tout'}
              </button>
            ))}
          </div>
          <select value={query.season ?? ''} onChange={(e) => setQuery((q) => ({ ...q, season: e.target.value || undefined }))} aria-label="Saison">
            <option value="">Toutes saisons</option>
            {lib?.seasons.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={query.sort} onChange={(e) => setQuery((q) => ({ ...q, sort: e.target.value }))} aria-label="Tri">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="media__spacer" />
          <button type="button" className="btn btn--primary" onClick={() => fileInput.current?.click()}>
            Déposer des fichiers
          </button>
          <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={onPick} />
        </div>

        {uploads.length ? (
          <div className="media__uploads card">
            <div className="media__uploads-head">
              <b>Dépôts</b>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setUploads([])}>
                Effacer
              </button>
            </div>
            {uploads.map((u) => (
              <div key={u.key} className={`media__upload is-${u.state}`}>
                <span className="media__upload-name">{u.name}</span>
                <span>{UPLOAD_LABEL[u.state]}{u.message ? ` — ${u.message}` : ''}</span>
              </div>
            ))}
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <p className="muted media__count">
          {loading && !list.length ? 'Chargement…' : `${total} fichier${total > 1 ? 's' : ''}${query.archived ? ' retiré' + (total > 1 ? 's' : '') : ''}`}
          {' · '}glissez des photos ou des vidéos n’importe où sur cet écran pour les déposer.
        </p>

        {!loading && !list.length && !error ? (
          <div className="media__empty card">
            <b>{query.archived ? 'Aucun fichier retiré.' : 'Rien ici pour l’instant.'}</b>
            <p className="muted">
              La médiathèque est commune à tout le marketing : les photos déposées ici servent aux posts et aux publicités de
              Social, aux visuels de campagne, aux brochures, aux bâches et aux affiches.
            </p>
          </div>
        ) : null}

        <div className="media__grid">
          {list.map((item) => (
            <button key={item.id} type="button" className={`media__tile${item.id === selectedId ? ' is-on' : ''}${item.cutout ? ' is-cutout' : ''}`} onClick={() => setSelectedId(item.id)}>
              <span className="media__thumb">
                {item.thumbnailUrl || item.kind === 'image' ? <img src={item.thumbnailUrl ?? item.url} alt="" loading="lazy" /> : <span className="media__nothumb">Vidéo</span>}
                {item.kind === 'video' ? <span className="media__badge">▶ Vidéo</span> : null}
                {item.kind === 'image' && printClass(item) ? <span className={`media__badge media__badge--${printClass(item)}`}>{PRINT_LABEL[printClass(item)!]}</span> : null}
              </span>
              <span className="media__name">{item.name}</span>
              <span className="media__tags">{[item.category?.label ?? 'Non classée', item.subcategory?.label, item.season?.label].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>

        {page && page.page < page.totalPages ? (
          <div className="media__more">
            <button type="button" className="btn" onClick={() => void loadMore()} disabled={loading}>
              {loading ? 'Chargement…' : `Afficher la suite (${total - list.length})`}
            </button>
          </div>
        ) : null}
      </section>

      {selected && lib ? (
        <MediaSheet
          key={selected.id}
          asset={selected}
          library={lib}
          shops={shops.data ?? []}
          items={items.data ?? []}
          onSaved={(asset, reclassed) => {
            replace(asset)
            if (reclassed) setLibraryKey((k) => k + 1)
          }}
          onRemoved={(asset) => {
            replace(asset)
            setRefreshKey((k) => k + 1)
            setSelectedId(null)
          }}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  )
}

const UPLOAD_LABEL: Record<Upload['state'], string> = {
  waiting: 'en attente',
  sending: 'envoi…',
  done: 'déposé',
  duplicate: 'déjà là',
  error: 'refusé',
}

interface SheetProps {
  asset: MediaAsset
  library: MediaLibrary
  shops: api.Shop[]
  items: api.OfferItem[]
  /** `reclassed` : la catégorie a changé, les compteurs sont à relire. */
  onSaved: (asset: MediaAsset, reclassed: boolean) => void
  onRemoved: (asset: MediaAsset) => void
  onClose: () => void
}

/** La fiche d'un fichier : aperçu, classements, tailles d'impression, lien. */
function MediaSheet({ asset, library, shops, items, onSaved, onRemoved, onClose }: SheetProps) {
  const [name, setName] = useState(asset.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [itemSearch, setItemSearch] = useState('')

  const category = library.categories.find((c) => c.code === asset.category?.code) ?? null
  const products = useMemo(() => {
    const words = itemSearch.trim().toLowerCase()
    return items
      .filter((i) => i.category === 'produit' || i.category === 'saison')
      .filter((i) => !words || i.name.toLowerCase().includes(words))
      .slice(0, 50)
  }, [items, itemSearch])

  async function save(fields: MediaFields & { archived?: boolean }) {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateMedia(asset.id, fields)
      if (fields.archived !== undefined) onRemoved(updated)
      else onSaved(updated, 'category' in fields || 'subcategory' in fields)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(asset.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Copie refusée par le navigateur : ouvrez l’original et copiez son adresse.')
    }
  }

  const sizes = asset.kind === 'image' && asset.width && asset.height ? printSizes(asset.width, asset.height) : null

  return (
    <aside className="media__sheet card" aria-label="Fiche du fichier">
      <div className="media__sheet-head">
        <b>Fiche</b>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Fermer la fiche">
          Fermer
        </button>
      </div>
      <div className={`media__preview${asset.cutout ? ' is-cutout' : ''}`}>
        {asset.kind === 'video' ? <video src={asset.url} poster={asset.thumbnailUrl ?? undefined} controls preload="metadata" /> : <img src={asset.webUrl ?? asset.thumbnailUrl ?? asset.url} alt="" />}
      </div>

      <label className="media__field">
        Nom
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== asset.name && void save({ name: name.trim() })} />
      </label>
      <div className="media__row">
        <label className="media__field">
          Catégorie
          <select value={asset.category?.code ?? ''} disabled={busy} onChange={(e) => void save({ category: e.target.value || null, subcategory: null })}>
            <option value="">Non classée</option>
            {library.categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="media__field">
          Sous-catégorie
          <select value={asset.subcategory?.code ?? ''} disabled={busy || !category} onChange={(e) => void save({ category: asset.category?.code ?? null, subcategory: e.target.value || null })}>
            <option value="">—</option>
            {category?.subcategories.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="media__row">
        <label className="media__field">
          Saison
          <select value={asset.season?.code ?? ''} disabled={busy} onChange={(e) => void save({ season: e.target.value || null })}>
            <option value="">—</option>
            {library.seasons.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="media__field">
          Boutique montrée
          <select value={asset.shop?.id ?? ''} disabled={busy} onChange={(e) => void save({ shopId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Tout le réseau</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="media__field">
        Produit du catalogue
        {asset.offerItem ? (
          <span className="media__linked">
            {asset.offerItem.name}
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void save({ offerItemId: null })}>
              Détacher
            </button>
          </span>
        ) : (
          <>
            <input placeholder="Chercher un produit…" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
            {itemSearch.trim() ? (
              <span className="media__picks">
                {products.length ? (
                  products.map((p) => (
                    <button key={p.id} type="button" className="chip" disabled={busy} onClick={() => void save({ offerItemId: p.id })}>
                      {p.name}
                    </button>
                  ))
                ) : (
                  <span className="muted">Aucun produit ne correspond.</span>
                )}
              </span>
            ) : null}
          </>
        )}
      </label>
      {asset.kind === 'image' ? (
        <label className="media__check">
          <input type="checkbox" checked={asset.cutout} disabled={busy} onChange={(e) => void save({ cutout: e.target.checked })} />
          Photo détourée (fond transparent)
        </label>
      ) : null}

      <dl className="media__facts">
        <dt>Fichier</dt>
        <dd>
          {asset.mimeType.replace(/^(image|video)\//, '').toUpperCase()} · {humanBytes(asset.bytes)}
          {asset.width && asset.height ? ` · ${asset.width} × ${asset.height} px` : ''}
        </dd>
        <dt>Déposé</dt>
        <dd>
          {new Date(asset.createdAt).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })} · {asset.source === 'social' ? 'module Social' : 'module Marketing'}
        </dd>
      </dl>

      {sizes ? (
        <div className="media__print">
          <b>Jusqu’où elle s’imprime nettement</b>
          <table>
            <tbody>
              {sizes.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>
                    {row.width} × {row.height} cm
                  </td>
                  <td className="muted">{row.fits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <div className="media__actions">
        <a className="btn btn--sm" href={asset.url} target="_blank" rel="noreferrer">
          Ouvrir l’original
        </a>
        <button type="button" className="btn btn--sm" onClick={() => void copyLink()}>
          {copied ? 'Lien copié' : 'Copier le lien'}
        </button>
        <span className="media__spacer" />
        {asset.archived ? (
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void save({ archived: false })}>
            Remettre dans la médiathèque
          </button>
        ) : (
          <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void save({ archived: true })}>
            Retirer
          </button>
        )}
      </div>
      {!asset.archived ? <p className="muted media__note">Retirer ne casse rien : un post publié ou une brochure qui utilise ce fichier le garde.</p> : null}
    </aside>
  )
}

/**
 * La taille d'impression nette selon la distance de lecture. 300 dpi pour un
 * imprimé tenu en main, 150 pour une affiche lue à un ou deux mètres, 50 pour
 * une bâche lue de la rue.
 */
function printSizes(width: number, height: number) {
  const cm = (px: number, dpi: number) => Math.floor((px / dpi) * 2.54)
  return [
    { label: 'En main (300 dpi)', dpi: 300 },
    { label: 'Affiche (150 dpi)', dpi: 150 },
    { label: 'Bâche (50 dpi)', dpi: 50 },
  ].map(({ label, dpi }) => {
    const w = cm(width, dpi)
    const h = cm(height, dpi)
    const long = Math.max(w, h)
    const short = Math.min(w, h)
    const fits =
      dpi === 300
        ? long >= 29.7 && short >= 21
          ? 'A4 ✓'
          : long >= 21 && short >= 14.8
            ? 'A5 ✓'
            : 'flyer, carte'
        : dpi === 150
          ? long >= 84.1 && short >= 59.4
            ? 'A1 ✓'
            : long >= 59.4 && short >= 42
              ? 'A2 ✓'
              : long >= 42 && short >= 29.7
                ? 'A3 ✓'
                : 'trop petite pour A3'
          : long >= 300
            ? 'bâche 3 m ✓'
            : long >= 200
              ? 'bâche 2 m ✓'
              : 'trop petite pour une bâche'
    return { label, width: w, height: h, fits }
  })
}

/** Le badge de la tuile : le plus grand usage imprimé que la photo tient. */
function printClass(item: MediaAsset): 'banner' | 'poster' | 'print' | null {
  if (!item.width || !item.height) return null
  const long = Math.max(item.width, item.height)
  const short = Math.min(item.width, item.height)
  if (long >= 5906) return 'banner' // 300 cm à 50 dpi
  if (long >= 4967 && short >= 3508) return 'poster' // A1 à 150 dpi
  if (long >= 3508 && short >= 2480) return 'print' // A4 à 300 dpi
  return null
}

const PRINT_LABEL: Record<'banner' | 'poster' | 'print', string> = {
  banner: 'Bâche',
  poster: 'Affiche A1',
  print: 'A4',
}

function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`
}

function nameFromFile(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  return (base || 'Photo').slice(0, 200)
}

/** La couverture d'une vidéo : l'image à la demi-seconde, en JPEG, 1 280 px au plus. */
function videoPoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false
    const done = (blob: Blob | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(blob)
    }
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
      } catch {
        done(null)
      }
    }
    video.onseeked = () => {
      try {
        const k = Math.min(1, 1280 / Math.max(video.videoWidth || 1, video.videoHeight || 1))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round((video.videoWidth || 1280) * k))
        canvas.height = Math.max(1, Math.round((video.videoHeight || 720) * k))
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => done(blob), 'image/jpeg', 0.85)
      } catch {
        done(null)
      }
    }
    video.onerror = () => done(null)
    window.setTimeout(() => done(null), 8000)
    video.src = url
  })
}
