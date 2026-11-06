import { useEffect, useRef, useState } from 'react'
import * as api from '../../lib/api/module'
import type { MediaAsset } from '../../lib/api/module'
import { useAsync } from '../../lib/useAsync'
import { SourceBrowser, addToLibrary } from './SourceBrowser'
import { SOURCE_LABEL, imageSize } from './sources'
import type { ImageSource, PickedImage, SourceImage } from './sources'
import './media.css'

const PER_PAGE = 48

/** Ce qu'une fiche de la médiathèque donne à qui la choisit (l'original : il sert aussi à l'impression). */
export function pickedFromAsset(asset: MediaAsset): PickedImage {
  return { url: asset.url, name: asset.name, source: 'mediatheque', width: asset.width, height: asset.height, cutout: asset.cutout }
}

/**
 * Choisir une image dans la médiathèque : ses fichiers, les photos du webshop et les illustrations
 * du design system — les mêmes que « Créer un post ». Une image du webshop ou du design system est
 * d'abord versée dans la médiathèque (le même fichier n'y est jamais doublé) : ce qu'on retient est
 * toujours une adresse de la médiathèque. Si le versement échoue, l'image garde son adresse
 * d'origine, et `note` le dit.
 */
export default function MediaPicker({
  title = 'Choisir une image',
  initialSearch = '',
  onPick,
  onClose,
}: {
  title?: string
  /** La recherche posée à l'ouverture, dans chaque source (le nom du produit, par exemple). */
  initialSearch?: string
  onPick: (image: PickedImage, note: string | null) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<ImageSource>('mediatheque')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const library = useAsync(() => api.getMediaLibrary(), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function pickExternal(item: SourceImage) {
    if (source === 'mediatheque' || busy) return
    setBusy(item.key)
    setError(null)
    try {
      const { media } = await addToLibrary(source, item, library.data ?? null)
      onPick(pickedFromAsset(media), null)
    } catch (cause: unknown) {
      const size = await imageSize(item.url)
      const reason = cause instanceof Error ? cause.message : String(cause)
      onPick(
        { url: item.url, name: item.name, source, width: size.width, height: size.height, cutout: item.cutout },
        `Pas versée dans la médiathèque (${reason}) : l’image garde son adresse d’origine.`,
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mpick" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mpick__box card">
        <div className="mpick__head">
          <h3>{title}</h3>
          <div className="seg" role="tablist" aria-label="Source">
            {(Object.keys(SOURCE_LABEL) as ImageSource[]).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={source === s} className={source === s ? 'is-on' : ''} onClick={() => setSource(s)}>
                {SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
          <span className="media__spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {busy ? <p className="muted">Versement dans la médiathèque…</p> : null}
        <div className="mpick__body">
          {source === 'mediatheque' ? (
            <LibraryFiles library={library.data ?? null} initialSearch={initialSearch} onPick={(asset) => onPick(pickedFromAsset(asset), null)} onError={setError} />
          ) : (
            <SourceBrowser source={source} initialSearch={initialSearch} selectedKey={busy} onSelect={(item) => void pickExternal(item)} />
          )}
        </div>
      </div>
    </div>
  )
}

/** Les images de la médiathèque, avec un dépôt direct : l'image déposée est aussitôt choisie. */
function LibraryFiles({
  library,
  initialSearch,
  onPick,
  onError,
}: {
  library: api.MediaLibrary | null
  initialSearch: string
  onPick: (asset: MediaAsset) => void
  onError: (message: string | null) => void
}) {
  const [search, setSearch] = useState(initialSearch)
  const [name, setName] = useState(initialSearch)
  const [category, setCategory] = useState('')
  const [list, setList] = useState<MediaAsset[]>([])
  const [page, setPage] = useState<api.MediaPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setName(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .listMedia({ kind: 'image', sort: '-createdAt', name, category: category || undefined, page: 1, perPage: PER_PAGE })
      .then((r) => {
        if (cancelled) return
        setPage(r)
        setList(r.items)
      })
      .catch((cause: unknown) => !cancelled && onError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [name, category, onError])

  async function more() {
    if (!page) return
    setLoading(true)
    try {
      const next = await api.listMedia({ kind: 'image', sort: '-createdAt', name, category: category || undefined, page: page.page + 1, perPage: PER_PAGE })
      setPage(next)
      setList((l) => l.concat(next.items))
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  async function send(f: File) {
    setUploading(true)
    onError(null)
    try {
      const { media } = await api.uploadMedia(f, { name: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Image' })
      onPick(media)
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <div className="media__bar">
        <input className="media__search" type="search" placeholder="Rechercher un nom, une catégorie, un produit…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          <option value="none">Non classées</option>
          {library?.categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="media__spacer" />
        <button type="button" className={uploading ? 'btn is-busy' : 'btn'} disabled={uploading} onClick={() => file.current?.click()}>
          {uploading ? 'Dépôt…' : 'Déposer une image'}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void send(f)
          }}
        />
      </div>
      <p className="muted media__count">
        {loading && !list.length ? 'Chargement…' : `${page?.total ?? 0} image${(page?.total ?? 0) > 1 ? 's' : ''} dans la médiathèque`}
      </p>
      <div className="media__grid">
        {list.map((item) => (
          <button key={item.id} type="button" className={`media__tile${item.cutout ? ' is-cutout' : ''}`} onClick={() => onPick(item)}>
            <span className="media__thumb">
              <img src={item.thumbnailUrl ?? item.url} alt="" loading="lazy" />
            </span>
            <span className="media__name">{item.name}</span>
            <span className="media__tags">{[item.category?.label ?? 'Non classée', item.subcategory?.label, item.width && item.height ? `${item.width} × ${item.height}` : null].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </div>
      {page && page.page < page.totalPages ? (
        <div className="media__more">
          <button type="button" className="btn" disabled={loading} onClick={() => void more()}>
            {loading ? 'Chargement…' : `Afficher la suite (${page.total - list.length})`}
          </button>
        </div>
      ) : null}
    </>
  )
}
