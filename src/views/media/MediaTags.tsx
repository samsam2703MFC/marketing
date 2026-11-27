import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as api from '../../lib/api/module'
import type { MediaAsset, MediaLibrary, MediaMoment, MediaTagFields, MediaTagProposal, MediaUsage } from '../../lib/api/module'
import { webshopProducts } from './sources'
import type { WebshopProduct } from './sources'
import { fold, proposeForAssets } from './tagRules'
import Erreur from '../../components/Erreur'

/**
 * Les étiquettes d'une image (idée 1 de la maquette) et les étiquettes proposées, à valider
 * (idée 2). Des rectangles aux coins arrondis, pas des pastilles : une couleur par famille,
 * plein quand l'étiquette est posée, en pointillés quand elle n'est que proposée.
 */

export type TagFamily = 'moment' | 'saison' | 'produit' | 'format' | 'usage' | 'boutique' | 'validite' | 'libre' | 'detouree'

const FAMILY_LABEL: Record<TagFamily, string> = {
  moment: 'Moment',
  saison: 'Saison',
  produit: 'Produit lié',
  format: 'Format',
  usage: 'Usage',
  boutique: 'Boutique',
  validite: 'Fin de validité',
  libre: 'Libres',
  detouree: 'Détourage',
}

export function TagRect({
  family,
  children,
  on = true,
  proposed = false,
  title,
  onClick,
  onRemove,
  disabled,
}: {
  family: TagFamily
  children: ReactNode
  on?: boolean
  proposed?: boolean
  title?: string
  onClick?: () => void
  onRemove?: () => void
  disabled?: boolean
}) {
  const cls = `tagr tagr--${family}${on ? ' is-on' : ''}${proposed ? ' is-proposed' : ''}${onClick ? ' is-button' : ''}`
  const body = (
    <>
      <i className="tagr__mark" aria-hidden="true" />
      <span className="tagr__text">{children}</span>
    </>
  )
  return (
    <span className={cls} title={title}>
      {onClick ? (
        <button type="button" className="tagr__hit" onClick={onClick} disabled={disabled} aria-pressed={on}>
          {body}
        </button>
      ) : (
        body
      )}
      {onRemove ? (
        <button type="button" className="tagr__x" onClick={onRemove} disabled={disabled} aria-label="Retirer">
          ✕
        </button>
      ) : null}
    </span>
  )
}

const MOMENT_LABEL = Object.fromEntries(api.MEDIA_MOMENTS.map((m) => [m.value, m.label])) as Record<MediaMoment, string>
const USAGE_LABEL = Object.fromEntries(api.MEDIA_USAGES.map((u) => [u.value, u.label])) as Record<MediaUsage, string>

export function formatLabel(asset: Pick<MediaAsset, 'format' | 'width' | 'height'>): string | null {
  if (!asset.format) return null
  return asset.format === 'carre' ? 'Carré 1:1' : api.MEDIA_FORMATS[asset.format]
}

/** Ce qu'une image porte, en peu de place (tuile de la grille). */
export function TileTags({ asset }: { asset: MediaAsset }) {
  const t = asset.tags
  const items: Array<{ family: TagFamily; label: string }> = [
    ...t.moments.map((m) => ({ family: 'moment' as const, label: MOMENT_LABEL[m] ?? m })),
    ...(asset.season ? [{ family: 'saison' as const, label: asset.season.label }] : []),
    ...t.products.map((p) => ({ family: 'produit' as const, label: p.name })),
    ...t.usages.map((u) => ({ family: 'usage' as const, label: USAGE_LABEL[u] ?? u })),
    ...t.free.map((f) => ({ family: 'libre' as const, label: `#${f}` })),
  ]
  const format = formatLabel(asset)
  const shown = items.slice(0, 3)
  return (
    <span className="media__tagrow">
      {items.length === 0 ? (
        <span className="tagr tagr--none">sans étiquette</span>
      ) : (
        <>
          {shown.map((i, n) => (
            <TagRect key={n} family={i.family}>
              {i.label}
            </TagRect>
          ))}
          {format && items.length < 3 ? <TagRect family="format">{format}</TagRect> : null}
          {items.length > shown.length ? <span className="tagr tagr--more">+{items.length - shown.length}</span> : null}
        </>
      )}
      {asset.pendingProposals > 0 ? (
        <TagRect family="moment" on={false} proposed title="Étiquettes proposées, à valider">
          {asset.pendingProposals} proposée{asset.pendingProposals > 1 ? 's' : ''}
        </TagRect>
      ) : null}
    </span>
  )
}

/** Une ligne de la fiche : la famille à gauche, ses rectangles à droite. */
function Row({ family, children, hint }: { family: TagFamily; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className={`tagrow tagrow--${family}`}>
      <span className="tagrow__name">
        <i className={`tagr__mark tagr--${family}`} aria-hidden="true" />
        {FAMILY_LABEL[family]}
      </span>
      <span className="tagrow__values">
        {children}
        {hint ? <span className="tagrow__hint">{hint}</span> : null}
      </span>
    </div>
  )
}

interface EditorProps {
  asset: MediaAsset
  library: MediaLibrary
  shops: api.Shop[]
  busy: boolean
  save: (fields: api.MediaFields & MediaTagFields) => Promise<void>
  /** Une proposition tranchée : la fiche relue. */
  onDecided: (asset: MediaAsset) => void
}

/** Idée 1 : les étiquettes sur la fiche de l'image. */
export function TagEditor({ asset, library, shops, busy, save, onDecided }: EditorProps) {
  const t = asset.tags
  const [free, setFree] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [products, setProducts] = useState<WebshopProduct[] | null>(null)
  const [productError, setProductError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<MediaTagProposal[]>([])
  const [deciding, setDeciding] = useState(false)

  // Les propositions de cette fiche, s'il y en a.
  useEffect(() => {
    if (!asset.pendingProposals) {
      setProposals([])
      return
    }
    let cancelled = false
    api
      .listMediaProposals(1, 1, asset.id)
      .then((page) => !cancelled && setProposals(page.items[0]?.proposals ?? []))
      .catch(() => !cancelled && setProposals([]))
    return () => {
      cancelled = true
    }
  }, [asset.id, asset.pendingProposals])

  useEffect(() => {
    if (!productSearch.trim() || products) return
    webshopProducts()
      .then(setProducts)
      .catch((cause: unknown) => setProductError(cause instanceof Error ? cause.message : String(cause)))
  }, [productSearch, products])

  const matches = useMemo(() => {
    const q = fold(productSearch)
    if (!q || !products) return []
    const linked = new Set(t.products.map((p) => p.id))
    return products.filter((p) => !linked.has(String(p.id)) && fold(p.name).includes(q)).slice(0, 12)
  }, [productSearch, products, t.products])

  async function decide(ids: string[], status: 'accepted' | 'refused') {
    setDeciding(true)
    try {
      if (ids.length === 1) {
        const { media } = await api.decideMediaProposal(ids[0], status)
        if (media) onDecided(media)
      } else {
        await api.decideMediaProposals(ids, status)
        onDecided(await api.getMedia(asset.id))
      }
    } finally {
      setDeciding(false)
    }
  }

  const toggle = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  const today = new Date().toISOString().slice(0, 10)
  const expired = asset.validUntil !== null && asset.validUntil < today
  const off = busy || deciding

  return (
    <div className="tagsheet">
      <div className="tagsheet__head">Les étiquettes de l’image</div>

      {proposals.length ? (
        <div className="tagsheet__proposed">
          <span className="tagsheet__proposed-title">Proposées, à valider</span>
          <span className="tagrow__values">
            {proposals.map((p) => (
              <TagRect
                key={p.id}
                family={p.family === 'detouree' ? 'format' : p.family}
                on={false}
                proposed
                title={`D’après : ${p.reason}. Cliquer pour accepter.`}
                onClick={() => void decide([p.id], 'accepted')}
                onRemove={() => void decide([p.id], 'refused')}
                disabled={off}
              >
                {p.label}
              </TagRect>
            ))}
          </span>
          <span className="tagsheet__proposed-why">d’après : {Array.from(new Set(proposals.map((p) => p.reason))).join(' · ')}</span>
          <span className="tagsheet__proposed-actions">
            <button type="button" className="btn btn--primary btn--sm" disabled={off} onClick={() => void decide(proposals.map((p) => p.id), 'accepted')}>
              ✓ Tout accepter
            </button>
            <button type="button" className="btn btn--sm" disabled={off} onClick={() => void decide(proposals.map((p) => p.id), 'refused')}>
              ✕ Tout refuser
            </button>
          </span>
        </div>
      ) : null}

      <Row family="moment" hint={!t.moments.length ? 'sans moment : elle passe toute la journée' : undefined}>
        {api.MEDIA_MOMENTS.map((m) => (
          <TagRect key={m.value} family="moment" on={t.moments.includes(m.value)} disabled={off} onClick={() => void save({ moments: toggle(t.moments, m.value) })}>
            {m.label}
          </TagRect>
        ))}
        <TagRect family="moment" on={!t.moments.length} disabled={off} onClick={() => void save({ moments: [] })}>
          Toute la journée
        </TagRect>
      </Row>

      <Row family="saison">
        {library.seasons.map((s) => (
          <TagRect key={s.code} family="saison" on={asset.season?.code === s.code} disabled={off} onClick={() => void save({ season: asset.season?.code === s.code ? null : s.code })}>
            {s.label}
          </TagRect>
        ))}
      </Row>

      <Row family="produit">
        {t.products.map((p) => (
          <TagRect key={p.id} family="produit" title={`Produit du webshop n° ${p.id}`} disabled={off} onRemove={() => void save({ products: t.products.filter((x) => x.id !== p.id) })}>
            {p.name}
          </TagRect>
        ))}
        <input
          className="tagrow__input"
          placeholder={t.products.length ? '+ un autre produit…' : '+ lier un produit du webshop…'}
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          disabled={off || t.products.length >= 8}
        />
        {productSearch.trim() ? (
          <span className="tagrow__picks">
            {productError ? (
              <Erreur inline>{productError}</Erreur>
            ) : !products ? (
              <span className="muted">Lecture du webshop…</span>
            ) : matches.length ? (
              matches.map((p) => (
                <TagRect
                  key={p.id}
                  family="produit"
                  on={false}
                  disabled={off}
                  title={[p.rayon, p.categorie].filter(Boolean).join(' › ')}
                  onClick={() => {
                    setProductSearch('')
                    void save({ products: [...t.products, { id: String(p.id), name: p.name }] })
                  }}
                >
                  {p.name}
                </TagRect>
              ))
            ) : (
              <span className="muted">Aucun produit du webshop ne correspond.</span>
            )}
          </span>
        ) : null}
      </Row>

      <Row family="format" hint={asset.width && asset.height ? `${asset.width} × ${asset.height} px` : undefined}>
        {formatLabel(asset) ? <TagRect family="format">{formatLabel(asset)} · détecté</TagRect> : <span className="muted">taille inconnue</span>}
        {asset.cutout ? <TagRect family="format">Détourée</TagRect> : null}
      </Row>

      <Row family="usage">
        {api.MEDIA_USAGES.map((u) => (
          <TagRect key={u.value} family="usage" on={t.usages.includes(u.value)} disabled={off} onClick={() => void save({ usages: toggle(t.usages, u.value) })}>
            {u.label}
          </TagRect>
        ))}
      </Row>

      <Row family="boutique">
        <TagRect family="boutique" on={!asset.shop} disabled={off} onClick={() => asset.shop && void save({ shopId: null })}>
          Réseau
        </TagRect>
        {asset.shop ? <TagRect family="boutique">{asset.shop.name}</TagRect> : null}
        <select className="tagrow__select" value="" disabled={off} onChange={(e) => e.target.value && void save({ shopId: Number(e.target.value) })} aria-label="Boutique montrée">
          <option value="">{asset.shop ? 'changer…' : 'une boutique…'}</option>
          {shops
            .filter((s) => String(s.id) !== asset.shop?.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </Row>

      <Row family="validite" hint={expired ? 'passée : l’image ne sert plus aux écrans' : undefined}>
        <TagRect family="validite" on={asset.validUntil === null} disabled={off} onClick={() => asset.validUntil !== null && void save({ validUntil: null })}>
          Aucune
        </TagRect>
        <input
          type="date"
          className={`tagrow__date${asset.validUntil ? ' is-on' : ''}`}
          value={asset.validUntil ?? ''}
          disabled={off}
          onChange={(e) => void save({ validUntil: e.target.value || null })}
          aria-label="Fin de validité"
        />
      </Row>

      <Row family="libre">
        {t.free.map((f) => (
          <TagRect key={f} family="libre" disabled={off} onRemove={() => void save({ freeTags: t.free.filter((x) => x !== f) })}>
            #{f}
          </TagRect>
        ))}
        <form
          className="tagrow__form"
          onSubmit={(e) => {
            e.preventDefault()
            const value = free.trim().replace(/^#/, '').toLowerCase()
            if (!value || t.free.includes(value)) return
            setFree('')
            void save({ freeTags: [...t.free, value] })
          }}
        >
          <input className="tagrow__input" placeholder="+ ajouter" maxLength={40} value={free} onChange={(e) => setFree(e.target.value)} disabled={off || t.free.length >= 12} />
        </form>
      </Row>

      <p className="tagsheet__why">
        <b>Pour les écrans des magasins</b> — la régie tire au sort une image dont le <b>moment</b> correspond à l’heure (matin avant 11 h,
        midi, après-midi après 16 h) et dont la <b>saison</b> est active ; sans moment, elle passe toute la journée. Le <b>produit lié</b> la
        montre avec son prix ; le <b>format</b> l’écarte d’un écran qui n’a pas le bon sens.
      </p>
    </div>
  )
}

/** Idée 2 : les étiquettes proposées, à valider. */
export function ProposalsPanel({
  library,
  onCount,
  onOpen,
  onDecided,
}: {
  library: MediaLibrary
  onCount: (count: number) => void
  onOpen: (asset: MediaAsset) => void
  /** Des propositions tranchées : les fiches ont changé, la grille se relit. */
  onDecided: () => void
}) {
  const [rows, setRows] = useState<Array<{ media: MediaAsset; proposals: MediaTagProposal[] }>>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scan, setScan] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .listMediaProposals(1, 100)
      .then((page) => {
        if (cancelled) return
        setRows(page.items)
        setTotal(page.proposals)
        onCount(page.proposals)
      })
      .catch((cause: unknown) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [reload, onCount])

  async function decide(ids: string[], status: 'accepted' | 'refused') {
    if (!ids.length) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.decideMediaProposals(ids, status)
      const gone = new Set(ids)
      setRows((current) => current.map((r) => ({ ...r, proposals: r.proposals.filter((p) => !gone.has(p.id)) })).filter((r) => r.proposals.length))
      setTotal(result.proposals)
      onCount(result.proposals)
      onDecided()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  /** Parcourt la médiathèque et propose ce qui peut l'être (produit, moment, saison). */
  async function search() {
    setBusy(true)
    setError(null)
    let created = 0
    try {
      for (let page = 1, pages = 1; page <= pages && page <= 30; page++) {
        const result = await api.listMedia({ kind: 'image', perPage: 100, page, sort: '-createdAt' })
        pages = result.totalPages
        setScan(`Lecture des images : ${Math.min(result.total, page * 100)} / ${result.total}…`)
        const done = await proposeForAssets(result.items, library.seasons)
        created += done?.created ?? 0
      }
      setScan(created ? `${created} nouvelle${created > 1 ? 's' : ''} proposition${created > 1 ? 's' : ''}.` : 'Rien de nouveau à proposer : ce qui pouvait l’être l’est déjà (ou a été refusé).')
      setReload((k) => k + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setScan(null)
    } finally {
      setBusy(false)
    }
  }

  const all = rows.flatMap((r) => r.proposals.map((p) => p.id))

  return (
    <div className="proposals card">
      <div className="proposals__head">
        <span className="proposals__title">Les étiquettes proposées, à valider</span>
        <span className="muted proposals__sub">tirées du webshop et du fichier — rien ne s’enregistre sans ✓</span>
        <span className="media__spacer" />
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void search()}>
          Chercher des propositions
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy || !all.length} onClick={() => void decide(all, 'accepted')}>
          Tout accepter ({total})
        </button>
      </div>
      {scan ? <p className="muted proposals__note">{scan}</p> : null}
      {error ? <Erreur>{error}</Erreur> : null}

      {loading && !rows.length ? <p className="muted">Chargement…</p> : null}
      {!loading && !rows.length ? (
        <div className="proposals__empty">
          <b>Rien à valider.</b>
          <p className="muted">
            « Chercher des propositions » relit les images : le produit d’après le nom du webshop, le moment d’après le rayon
            (viennoiserie → matin, traiteur → midi, pâtisserie et biscuiterie → après-midi), la saison d’après un nom de fête.
          </p>
        </div>
      ) : null}

      {rows.length ? (
        <table className="proposals__table">
          <colgroup>
            <col className="proposals__col-thumb" />
            <col className="proposals__col-name" />
            <col />
            <col className="proposals__col-act" />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={2}>Image · d’après</th>
              <th>Proposé</th>
              <th aria-label="Décision" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ media, proposals }) => (
              <tr key={media.id}>
                <td className="proposals__thumb">
                  <button type="button" onClick={() => onOpen(media)} aria-label={`Ouvrir la fiche de ${media.name}`}>
                    <img src={media.thumbnailUrl ?? media.url} alt="" loading="lazy" />
                  </button>
                </td>
                <td className="proposals__name">
                  {media.name}
                  <span className="proposals__why">{Array.from(new Set(proposals.map((p) => p.reason))).join(' · ')}</span>
                </td>
                <td>
                  <span className="tagrow__values">
                    {proposals.map((p) => (
                      <TagRect
                        key={p.id}
                        family={p.family === 'detouree' ? 'format' : p.family}
                        on={false}
                        proposed
                        disabled={busy}
                        title="Cliquer pour accepter celle-ci"
                        onClick={() => void decide([p.id], 'accepted')}
                        onRemove={() => void decide([p.id], 'refused')}
                      >
                        {p.label}
                      </TagRect>
                    ))}
                  </span>
                </td>
                <td className="proposals__act">
                  <button type="button" className="proposals__ok" disabled={busy} onClick={() => void decide(proposals.map((p) => p.id), 'accepted')} aria-label="Accepter la ligne">
                    ✓
                  </button>
                  <button type="button" className="proposals__no" disabled={busy} onClick={() => void decide(proposals.map((p) => p.id), 'refused')} aria-label="Refuser la ligne">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="proposals__foot">
        <b>Le moins de saisie possible</b> — le produit (et donc son prix et sa rupture sur les écrans), le format et souvent le moment se
        déduisent ; on ne fait que valider. Une proposition refusée ne revient pas.
      </p>
    </div>
  )
}
