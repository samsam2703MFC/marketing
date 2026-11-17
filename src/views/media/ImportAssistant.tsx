import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import * as api from '../../lib/api/module'
import type { MediaLibrary, MediaMoment, MediaUsage } from '../../lib/api/module'
import { webshopProducts } from './sources'
import type { WebshopProduct } from './sources'
import { proposeFor } from './tagRules'
import type { ProposalDraft } from './tagRules'
import { TagRect, formatLabel } from './MediaTags'

/**
 * L'assistant d'import en lot : « importer des photos en lot, avec la proposition des étiquettes ».
 *
 *  1. Les photos — glissées ou choisies, lues dans le navigateur (taille, fond transparent) ; la
 *     taille à l'envoi : l'original (impression) ou réduite à 2 048 px en WebP (plus rapide).
 *  2. Les étiquettes — pour tout le lot (usage, saison, boutique, catégorie, fin de validité,
 *     libres) et, photo par photo, celles qui se déduisent (produit d'après le nom du webshop,
 *     moment d'après le rayon, saison, détourée), cochées d'office : on décoche ce qui ne va pas.
 *  3. L'import — une photo après l'autre ; une photo déjà dans la médiathèque garde sa fiche.
 */

type Step = 1 | 2 | 3

interface Item {
  key: string
  file: File
  preview: string
  name: string
  width: number | null
  height: number | null
  transparent: boolean
  proposals: ProposalDraft[]
  /** Les propositions retenues (famille:valeur). */
  kept: Set<string>
  moments: MediaMoment[]
  state: 'waiting' | 'sending' | 'done' | 'duplicate' | 'error'
  message?: string
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
const REDUCED_SIDE = 2048

const keyOf = (p: ProposalDraft) => `${p.family}:${p.value}`

export function ImportAssistant({ library, shops, onClose }: { library: MediaLibrary; shops: api.Shop[]; onClose: (imported: boolean) => void }) {
  const [step, setStep] = useState<Step>(1)
  const [items, setItems] = useState<Item[]>([])
  const [ignored, setIgnored] = useState(0)
  const [reduce, setReduce] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [products, setProducts] = useState<WebshopProduct[] | null>(null)
  const [webshopError, setWebshopError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const stop = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  // Pour tout le lot.
  const [usages, setUsages] = useState<MediaUsage[]>([])
  const [season, setSeason] = useState('')
  const [shopId, setShopId] = useState('')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [free, setFree] = useState('')

  // Les aperçus sont libérés à la fermeture.
  const previews = useRef<string[]>([])
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), [])

  // Échap ferme, sauf pendant l'envoi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose(step === 3)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, step, onClose])

  async function add(files: File[]) {
    const images = files.filter((f) => IMAGE_TYPES.includes(f.type))
    setIgnored((n) => n + files.length - images.length)
    const read = await Promise.all(
      images.map(async (file, i): Promise<Item> => {
        const preview = URL.createObjectURL(file)
        previews.current.push(preview)
        const info = await inspect(file)
        return {
          key: `${Date.now()}-${i}-${file.name}`,
          file,
          preview,
          name: nameFromFile(file.name),
          width: info.width,
          height: info.height,
          transparent: info.transparent,
          proposals: [],
          kept: new Set(),
          moments: [],
          state: 'waiting',
        }
      }),
    )
    setItems((current) => current.concat(read.filter((r) => !current.some((c) => c.file.name === r.file.name && c.file.size === r.file.size))))
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void add(Array.from(event.dataTransfer.files ?? []))
  }

  /** Passe aux étiquettes : les propositions de chaque photo, cochées d'office. */
  async function toTags() {
    let list = products
    if (!list) {
      list = await webshopProducts().catch((cause: unknown) => {
        setWebshopError(cause instanceof Error ? cause.message : String(cause))
        return [] as WebshopProduct[]
      })
      setProducts(list)
    }
    const all = list
    setItems((current) =>
      current.map((item) => {
        if (item.proposals.length || item.kept.size) return item
        const proposals = proposeFor({ name: item.name, transparent: item.transparent }, all, library.seasons)
        const moment = proposals.find((p) => p.family === 'moment')
        return {
          ...item,
          proposals: proposals.filter((p) => p.family !== 'moment').concat(moment ? [moment] : []),
          kept: new Set(proposals.filter((p) => p.family !== 'moment').map(keyOf)),
          moments: moment ? [moment.value as MediaMoment] : [],
        }
      }),
    )
    setStep(2)
  }

  /** Relit les propositions d'une photo renommée. */
  function rename(key: string, name: string) {
    setItems((current) =>
      current.map((item) => {
        if (item.key !== key) return item
        const proposals = products ? proposeFor({ name, transparent: item.transparent }, products, library.seasons) : item.proposals
        const moment = proposals.find((p) => p.family === 'moment')
        const others = proposals.filter((p) => p.family !== 'moment')
        return { ...item, name, proposals: others.concat(moment ? [moment] : []), kept: new Set(others.map(keyOf)), moments: moment ? [moment.value as MediaMoment] : item.moments }
      }),
    )
  }

  function patch(key: string, change: (item: Item) => Partial<Item>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change(item) } : item)))
  }

  async function run() {
    setStep(3)
    setRunning(true)
    stop.current = false
    const limits = library.limits
    const freeTags = free
      .split(',')
      .map((t) => t.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean)
      .slice(0, 12)
    for (const item of items) {
      if (stop.current) break
      if (item.state === 'done' || item.state === 'duplicate') continue
      const mark = (change: Partial<Item>) => patch(item.key, () => change)
      mark({ state: 'sending', message: undefined })
      try {
        const blob = reduce ? await reduceImage(item.file, REDUCED_SIDE) : item.file
        if (blob.size > limits.imageMaxBytes || (limits.serverMaxBytes && blob.size > limits.serverMaxBytes)) {
          const max = Math.min(limits.imageMaxBytes, limits.serverMaxBytes ?? Infinity)
          mark({ state: 'error', message: `trop lourde (${humanBytes(blob.size)}, maximum ${humanBytes(max)})${reduce ? '' : ' — essayez « réduite à 2 048 px »'}` })
          continue
        }
        const kept = item.proposals.filter((p) => item.kept.has(keyOf(p)))
        const product = kept.find((p) => p.family === 'produit')
        const ownSeason = kept.find((p) => p.family === 'saison')
        const { media, duplicate } = await api.uploadMedia(blob, {
          name: item.name.trim() || 'Photo',
          category: category || undefined,
          subcategory: subcategory || undefined,
          season: ownSeason?.value ?? (season || undefined),
          shopId: shopId ? Number(shopId) : undefined,
          cutout: kept.some((p) => p.family === 'detouree') || undefined,
        })
        if (duplicate) {
          mark({ state: 'duplicate', message: `déjà dans la médiathèque (« ${media.name} ») : sa fiche est gardée` })
          continue
        }
        const tags: api.MediaTagFields = {}
        if (item.moments.length) tags.moments = item.moments
        if (usages.length) tags.usages = usages
        if (product) tags.products = [{ id: product.value, name: product.label }]
        if (freeTags.length) tags.freeTags = freeTags
        if (validUntil) tags.validUntil = validUntil
        if (Object.keys(tags).length) await api.updateMedia(media.id, tags)
        mark({ state: 'done' })
      } catch (cause) {
        mark({ state: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    setRunning(false)
  }

  const cat = library.categories.find((c) => c.code === category) ?? null
  const proposed = useMemo(() => items.reduce((n, i) => n + i.proposals.length, 0), [items])
  const totals = useMemo(
    () => ({
      done: items.filter((i) => i.state === 'done').length,
      duplicate: items.filter((i) => i.state === 'duplicate').length,
      error: items.filter((i) => i.state === 'error').length,
      left: items.filter((i) => i.state === 'waiting' || i.state === 'sending').length,
    }),
    [items],
  )
  const weight = items.reduce((n, i) => n + i.file.size, 0)

  return (
    <div className="imp" role="dialog" aria-modal="true" aria-label="Importer des photos">
      <div className="imp__box card">
        <div className="imp__head">
          <div>
            <div className="imp__kicker">Importer des photos</div>
            <ol className="imp__steps">
              {(['Les photos', 'Les étiquettes', 'L’import'] as const).map((label, i) => (
                <li key={label} className={step === i + 1 ? 'is-on' : step > i + 1 ? 'is-done' : ''}>
                  <span>{i + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
          </div>
          <span className="media__spacer" />
          {!running ? (
            <button type="button" className="btn" onClick={() => onClose(step === 3 && totals.done > 0)}>
              {step === 3 && !totals.left ? 'Fermer' : 'Annuler'}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => (stop.current = true)}>
              Arrêter après cette photo
            </button>
          )}
          {step === 1 ? (
            <button type="button" className="btn btn--primary" disabled={!items.length} onClick={() => void toTags()}>
              Étiquettes →
            </button>
          ) : step === 2 ? (
            <>
              <button type="button" className="btn" onClick={() => setStep(1)}>
                ← Photos
              </button>
              <button type="button" className="btn btn--primary" disabled={!items.length} onClick={() => void run()}>
                Importer {items.length} photo{items.length > 1 ? 's' : ''}
              </button>
            </>
          ) : !running && totals.done + totals.duplicate > 0 ? (
            <button type="button" className="btn btn--primary" onClick={() => onClose(true)}>
              Voir dans la médiathèque
            </button>
          ) : null}
        </div>

        {step === 1 ? (
          <div className="imp__body">
            <div
              className={`imp__drop${dragging ? ' is-dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            >
              <b>Glissez les photos ici</b>
              <span className="muted">ou cliquez pour les choisir — PNG, JPEG, WebP, GIF, AVIF ; plusieurs à la fois</span>
              <input
                ref={input}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                multiple
                hidden
                onChange={(e) => {
                  void add(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
            </div>
            {ignored ? <p className="muted imp__note">{ignored} fichier{ignored > 1 ? 's' : ''} laissé{ignored > 1 ? 's' : ''} de côté (pas une photo) : les vidéos passent par le dépôt rapide.</p> : null}

            {items.length ? (
              <>
                <div className="imp__size">
                  <span className="imp__label">Taille à l’envoi</span>
                  <TagRect family="format" on={!reduce} onClick={() => setReduce(false)}>
                    Originale — impression, affiche, bâche
                  </TagRect>
                  <TagRect family="format" on={reduce} onClick={() => setReduce(true)}>
                    Réduite à 2 048 px (WebP) — plus rapide, écrans et réseaux
                  </TagRect>
                  <span className="muted">
                    {items.length} photo{items.length > 1 ? 's' : ''} · {humanBytes(weight)}
                  </span>
                </div>
                <div className="imp__grid">
                  {items.map((item) => (
                    <div key={item.key} className="imp__card">
                      <span className={`imp__thumb${item.transparent ? ' is-cutout' : ''}`}>
                        <img src={item.preview} alt="" />
                      </span>
                      <span className="imp__name" title={item.file.name}>
                        {item.name}
                      </span>
                      <span className="muted imp__facts">
                        {item.width && item.height ? `${item.width} × ${item.height}` : 'taille illisible'} · {humanBytes(item.file.size)}
                      </span>
                      <button type="button" className="imp__x" aria-label={`Retirer ${item.name}`} onClick={() => setItems((current) => current.filter((c) => c.key !== item.key))}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="imp__body">
            <div className="imp__batch">
              <span className="imp__label">Pour tout le lot</span>
              <div className="imp__batch-row">
                <span className="imp__batch-name">Usage</span>
                {api.MEDIA_USAGES.map((u) => (
                  <TagRect key={u.value} family="usage" on={usages.includes(u.value)} onClick={() => setUsages((list) => (list.includes(u.value) ? list.filter((v) => v !== u.value) : [...list, u.value]))}>
                    {u.label}
                  </TagRect>
                ))}
              </div>
              <div className="imp__batch-row">
                <label>
                  <span className="imp__batch-name">Saison</span>
                  <select value={season} onChange={(e) => setSeason(e.target.value)}>
                    <option value="">—</option>
                    {library.seasons.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="imp__batch-name">Boutique</span>
                  <select value={shopId} onChange={(e) => setShopId(e.target.value)}>
                    <option value="">Réseau</option>
                    {shops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="imp__batch-name">Catégorie</span>
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value)
                      setSubcategory('')
                    }}
                  >
                    <option value="">Non classée</option>
                    {library.categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                {cat?.subcategories.length ? (
                  <label>
                    <span className="imp__batch-name">Sous-catégorie</span>
                    <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
                      <option value="">—</option>
                      {cat.subcategories.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  <span className="imp__batch-name">Fin de validité</span>
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </label>
                <label className="imp__free">
                  <span className="imp__batch-name">Libres</span>
                  <input placeholder="vitrine, fait-maison" value={free} onChange={(e) => setFree(e.target.value)} />
                </label>
              </div>
            </div>

            <p className="muted imp__note">
              {proposed
                ? `${proposed} étiquette${proposed > 1 ? 's' : ''} proposée${proposed > 1 ? 's' : ''} d’après le webshop et les fichiers, cochée${proposed > 1 ? 's' : ''} d’office : décochez ce qui ne va pas.`
                : 'Aucune étiquette ne se déduit des noms de fichiers : renommez une photo comme son produit du webshop (« Croissant »), la proposition suit.'}
              {webshopError ? ` Webshop muet (${webshopError}) : pas de produit proposé.` : ''}
            </p>

            <table className="imp__table">
              <thead>
                <tr>
                  <th colSpan={2}>Photo</th>
                  <th>Étiquettes</th>
                  <th>D’après</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const others = item.proposals.filter((p) => p.family !== 'moment')
                  const moment = item.proposals.find((p) => p.family === 'moment')
                  const format = formatLabel({ format: formatOf(item.width, item.height), width: item.width, height: item.height })
                  return (
                    <tr key={item.key}>
                      <td className="imp__row-thumb">
                        <img src={item.preview} alt="" />
                      </td>
                      <td className="imp__row-name">
                        <input value={item.name} maxLength={200} onChange={(e) => rename(item.key, e.target.value)} aria-label="Nom de la photo" />
                      </td>
                      <td>
                        <span className="tagrow__values">
                          {others.map((p) => (
                            <TagRect
                              key={keyOf(p)}
                              family={p.family === 'detouree' ? 'format' : p.family}
                              on={item.kept.has(keyOf(p))}
                              proposed={!item.kept.has(keyOf(p))}
                              onClick={() =>
                                patch(item.key, (it) => {
                                  const kept = new Set(it.kept)
                                  if (kept.has(keyOf(p))) kept.delete(keyOf(p))
                                  else kept.add(keyOf(p))
                                  return { kept }
                                })
                              }
                            >
                              {p.label}
                            </TagRect>
                          ))}
                          {api.MEDIA_MOMENTS.map((m) => (
                            <TagRect
                              key={m.value}
                              family="moment"
                              on={item.moments.includes(m.value)}
                              title={moment?.value === m.value ? `Proposé d’après : ${moment.reason}` : undefined}
                              onClick={() => patch(item.key, (it) => ({ moments: it.moments.includes(m.value) ? it.moments.filter((v) => v !== m.value) : [...it.moments, m.value] }))}
                            >
                              {m.label}
                            </TagRect>
                          ))}
                          {format ? <TagRect family="format">{format}</TagRect> : null}
                        </span>
                      </td>
                      <td className="muted imp__why">{item.proposals.map((p) => p.reason).join(' · ') || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="imp__body">
            <div className="imp__progress" aria-live="polite">
              <div className="imp__bar">
                <span style={{ width: `${items.length ? ((items.length - totals.left) / items.length) * 100 : 0}%` }} />
              </div>
              <span>
                {running ? `Envoi… ${items.length - totals.left} / ${items.length}` : 'Terminé'} · {totals.done} déposée{totals.done > 1 ? 's' : ''}
                {totals.duplicate ? ` · ${totals.duplicate} déjà là` : ''}
                {totals.error ? ` · ${totals.error} refusée${totals.error > 1 ? 's' : ''}` : ''}
              </span>
            </div>
            <ul className="imp__results">
              {items.map((item) => (
                <li key={item.key} className={`is-${item.state}`}>
                  <img src={item.preview} alt="" />
                  <span className="imp__name">{item.name}</span>
                  <span className="imp__state">
                    {STATE_LABEL[item.state]}
                    {item.message ? ` — ${item.message}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {!running && totals.error ? (
              <button type="button" className="btn btn--sm" onClick={() => void run()}>
                Réessayer les refusées
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const STATE_LABEL: Record<Item['state'], string> = {
  waiting: 'en attente',
  sending: 'envoi…',
  done: 'déposée, étiquetée',
  duplicate: 'déjà là',
  error: 'refusée',
}

function formatOf(width: number | null, height: number | null): api.MediaFormat | null {
  if (!width || !height) return null
  const ratio = width / height
  return ratio >= 0.95 && ratio <= 1.05 ? 'carre' : ratio > 1 ? 'paysage' : 'portrait'
}

/** La taille et la transparence d'une photo, lues dans le navigateur (un échantillon du bord). */
async function inspect(file: File): Promise<{ width: number | null; height: number | null; transparent: boolean }> {
  try {
    const bitmap = await createImageBitmap(file)
    const out = { width: bitmap.width, height: bitmap.height, transparent: false }
    if (file.type !== 'image/jpeg') {
      const side = 48
      const canvas = document.createElement('canvas')
      canvas.width = side
      canvas.height = side
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, side, side)
        const data = ctx.getImageData(0, 0, side, side).data
        for (let y = 0; y < side && !out.transparent; y++) {
          for (let x = 0; x < side; x++) {
            if (x > 1 && x < side - 2 && y > 1 && y < side - 2) continue
            if (data[(y * side + x) * 4 + 3] < 250) {
              out.transparent = true
              break
            }
          }
        }
      }
    }
    bitmap.close()
    return out
  } catch {
    return { width: null, height: null, transparent: false }
  }
}

/** Réduit au côté long donné, en WebP ; garde l'original s'il est déjà plus léger (ou un GIF animé). */
async function reduceImage(file: File, maxSide: number): Promise<Blob> {
  if (file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * k))
    canvas.height = Math.max(1, Math.round(bitmap.height * k))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

function nameFromFile(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Photo').slice(0, 200)
}

function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`
}
