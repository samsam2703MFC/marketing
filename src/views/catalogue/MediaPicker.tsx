import { useEffect, useState } from 'react'
import * as api from '../../lib/api/module'
import { useAsync } from '../../lib/useAsync'
import './catalogue.css'

/** La médiathèque, pour choisir une image (charte, place libre, vignette d'offre). */
export function MediaPicker({ onPick, onClose }: { onPick: (asset: api.MediaAsset) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const page = useAsync(() => api.listMedia({ kind: 'image', perPage: 48, name: query }), [query])
  /**
   * « Importer une image » (17/11/2026, Sam : « pas de médiathèque » — elle était vide) : le fichier entre dans la
   * médiathèque du réseau (le même fichier déjà présent : sa fiche revient), puis il est choisi.
   */
  function importer(file: File | undefined) {
    if (!file) return
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) {
      setUpload({ busy: false, error: 'Une image : JPG, PNG, WebP, GIF ou AVIF.' })
      return
    }
    setUpload({ busy: true, error: null })
    api.uploadMedia(file, { name: file.name.replace(/\.[a-z0-9]+$/i, '') }).then(
      ({ media }) => {
        setUpload({ busy: false, error: null })
        onPick(media)
      },
      (cause: unknown) => setUpload({ busy: false, error: cause instanceof Error ? cause.message : String(cause) }),
    )
  }
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
          <label className={`btn btn--sm${upload.busy ? ' is-busy' : ''}`}>
            {upload.busy ? 'Import…' : 'Importer une image'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden disabled={upload.busy} onChange={(event) => importer(event.target.files?.[0])} />
          </label>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {page.error ? <p className="error">{page.error}</p> : null}
        {upload.error ? <p className="error">{upload.error}</p> : null}
        {page.loading ? <p className="muted">Lecture…</p> : null}
        <div className="catv-media">
          {(page.data?.items ?? []).map((asset) => (
            <button key={asset.id} type="button" className="catv-media__item" onClick={() => onPick(asset)} title={asset.name}>
              <img src={asset.thumbnailUrl ?? asset.webUrl} alt="" loading="lazy" />
              <span>{asset.name}</span>
            </button>
          ))}
          {page.data && !page.data.items.length ? (
            <p className="muted">{query ? 'Aucune image à ce nom.' : 'La médiathèque est vide : « Importer une image » y ajoute la vôtre (logo, photo), puis la choisit.'}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
