import { useEffect, useState } from 'react'
import * as api from '../../lib/api/module'
import { useAsync } from '../../lib/useAsync'
import './catalogue.css'

/** La médiathèque, pour choisir une image (charte, place libre, vignette d'offre). */
export function MediaPicker({ onPick, onClose }: { onPick: (asset: api.MediaAsset) => void; onClose: () => void }) {
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
