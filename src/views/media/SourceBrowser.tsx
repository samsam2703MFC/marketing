import { useEffect, useMemo, useState } from 'react'
import * as api from '../../lib/api/module'
import type { MediaAsset, MediaLibrary } from '../../lib/api/module'
import { designImages, fetchSourceImage, webshopImages } from './sources'
import type { SourceImage } from './sources'

const STEP = 60

/**
 * Une source d'images hors des fichiers de la médiathèque — le webshop ou le design system — en
 * grille, avec sa recherche et ses groupes. Lecture seule : l'image reste où elle est.
 */
export function SourceBrowser({
  source,
  selectedKey,
  onSelect,
}: {
  source: 'webshop' | 'design'
  selectedKey: string | null
  onSelect: (item: SourceImage) => void
}) {
  const [items, setItems] = useState<SourceImage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('')
  const [shown, setShown] = useState(STEP)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    setGroup('')
    setShown(STEP)
    ;(source === 'webshop' ? webshopImages() : designImages())
      .then((list) => !cancelled && setItems(list))
      .catch((cause: unknown) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [source])

  const groups = useMemo(() => [...new Set((items ?? []).map((i) => i.group).filter(Boolean))], [items])
  const filtered = useMemo(() => {
    const words = fold(search).split(/\s+/).filter(Boolean)
    return (items ?? []).filter(
      (i) => (group === '' || i.group === group) && words.every((w) => fold(`${i.name} ${i.group} ${i.detail}`).includes(w)),
    )
  }, [items, search, group])

  if (error) {
    return (
      <p className="error">
        {source === 'webshop' ? 'Photos du webshop illisibles' : 'Illustrations illisibles'} : {error}
      </p>
    )
  }

  return (
    <>
      <div className="media__bar">
        <input
          className="media__search"
          type="search"
          placeholder={source === 'webshop' ? 'Rechercher un produit, un rayon, une gamme…' : 'Rechercher une illustration…'}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setShown(STEP)
          }}
        />
        <div className="seg" role="group" aria-label="Groupe">
          {['', ...groups].map((g) => (
            <button
              key={g || 'all'}
              type="button"
              className={group === g ? 'is-on' : ''}
              onClick={() => {
                setGroup(g)
                setShown(STEP)
              }}
            >
              {g || 'Tout'}
            </button>
          ))}
        </div>
      </div>

      <p className="muted media__count">
        {items === null
          ? 'Chargement…'
          : `${filtered.length} image${filtered.length > 1 ? 's' : ''} · ${
              source === 'webshop'
                ? 'lues dans le catalogue du webshop (TFBuddy), comme dans « Créer un post »'
                : 'le design system de la marque : illustrations et photos de produits détourées'
            }`}
      </p>

      <div className="media__grid">
        {filtered.slice(0, shown).map((item) => (
          <button
            key={item.key}
            type="button"
            className={`media__tile${item.key === selectedKey ? ' is-on' : ''}${item.cutout ? ' is-cutout' : ''}`}
            onClick={() => onSelect(item)}
          >
            <span className="media__thumb">
              <img src={item.url} alt="" loading="lazy" />
            </span>
            <span className="media__name">{item.name}</span>
            <span className="media__tags">{[item.group, item.detail].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </div>

      {filtered.length > shown ? (
        <div className="media__more">
          <button type="button" className="btn" onClick={() => setShown((n) => n + STEP)}>
            Afficher la suite ({filtered.length - shown})
          </button>
        </div>
      ) : null}
    </>
  )
}

/**
 * Verse une image du webshop ou du design system dans la médiathèque. Le même fichier déjà
 * présent n'est pas doublé : sa fiche revient (`duplicate`). Le classement suit le libellé
 * quand la médiathèque a la même catégorie (« Viennoiseries › Croissants »).
 */
export async function addToLibrary(
  source: 'webshop' | 'design',
  item: SourceImage,
  library: MediaLibrary | null,
): Promise<{ media: MediaAsset; duplicate: boolean }> {
  const blob = await fetchSourceImage(source, item.url)
  const category = library?.categories.find((c) => fold(c.label) === fold(item.group)) ?? null
  const subcategory = category?.subcategories.find((s) => fold(s.label) === fold(item.detail)) ?? null

  return api.uploadMedia(blob, {
    name: item.name,
    cutout: item.cutout,
    category: category?.code ?? undefined,
    subcategory: subcategory?.code ?? undefined,
  })
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
