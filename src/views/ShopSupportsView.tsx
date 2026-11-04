import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api/module'
import type { Shop, ShopSupport, ShopSupportInput } from '../lib/api/module'
import { summarize } from './builder/Supports'

/**
 * Marketing en magasin › Bâches & affiches : les supports de chaque boutique, déclarés
 * une fois — emplacement, taille et quantité des bâches, cadres d'affiche A1, A2, A3.
 * L'assistant de campagne les reprend (étape « Supports ») pour la commande d'impression.
 */

type Row = ShopSupportInput & { key: string }

const MATERIALS: Array<{ value: 'pvc' | 'mesh'; label: string }> = [
  { value: 'pvc', label: 'PVC' },
  { value: 'mesh', label: 'Mesh (vent)' },
]
const FIXINGS: Array<{ value: 'oeillets' | 'fourreaux' | 'sangles'; label: string }> = [
  { value: 'oeillets', label: 'Œillets' },
  { value: 'fourreaux', label: 'Fourreaux' },
  { value: 'sangles', label: 'Sangles' },
]
const FORMATS = ['A1', 'A2', 'A3'] as const

let seq = 0
const keyed = (row: ShopSupportInput): Row => ({ ...row, key: `r${++seq}` })

export default function ShopSupportsView() {
  const [shops, setShops] = useState<Shop[] | null>(null)
  const [supports, setSupports] = useState<ShopSupport[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([api.listShops(), api.listShopSupports()])
      .then(([s, sup]) => {
        setShops(s)
        setSupports(sup)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  const byShop = useMemo(() => {
    const map = new Map<string, ShopSupport[]>()
    for (const s of supports) map.set(s.shopId, [...(map.get(s.shopId) ?? []), s])
    return map
  }, [supports])

  if (error) return <p className="error">{error}</p>
  if (!shops) return <p className="muted">Chargement…</p>

  const count = (list: ShopSupport[], format: string) =>
    list.filter((s) => s.kind === 'affiche' && s.paperFormat === format).reduce((n, s) => n + s.quantity, 0)
  const allBaches = supports.filter((s) => s.kind === 'bache')
  const current = editing !== null ? shops.find((shop) => shop.id === editing) ?? null : null

  return (
    <div className={`supports${current ? ' has-sheet' : ''}`}>
      <section className="card table-card">
        <h2 className="settings__group">Supports par boutique</h2>
        <div className="table-scroll">
          <table className="supports__table">
            <thead>
              <tr>
                <th>Boutique</th>
                <th>Bâches · emplacement · format · quantité</th>
                <th className="num">A1</th>
                <th className="num">A2</th>
                <th className="num">A3</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => {
                const list = byShop.get(String(shop.id)) ?? []
                const baches = list.filter((s) => s.kind === 'bache')
                return (
                  <tr key={shop.id} className={editing === shop.id ? 'is-sel' : undefined}>
                    <td>
                      <b>{shop.name}</b>
                      {shop.city ? <small className="muted supports__city">{shop.city}</small> : null}
                    </td>
                    <td>
                      {baches.length === 0 ? (
                        <span className="muted">aucune bâche déclarée</span>
                      ) : (
                        baches.map((s) => (
                          <span key={s.id} className="supports__chip">
                            {s.placement ? `${s.placement} ` : ''}
                            <i>
                              {s.widthCm} × {s.heightCm} cm{s.material === 'mesh' ? ' · mesh' : ''}
                            </i>{' '}
                            ×{s.quantity}
                          </span>
                        ))
                      )}
                    </td>
                    {FORMATS.map((format) => (
                      <td key={format} className="num">
                        {count(list, format) || '—'}
                      </td>
                    ))}
                    <td className="num">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(shop.id)}>
                        Modifier
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Réseau</td>
                <td>{allBaches.length ? summarize(allBaches) : '—'}</td>
                {FORMATS.map((format) => (
                  <td key={format} className="num">
                    {count(supports, format) || '—'}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted wizard__hint">
          L’assistant de campagne reprend ces supports : une campagne qui coche « Bâches extérieures » ou « Affiches » en tire
          ses quantités, boutique par boutique.
        </p>
      </section>

      {current ? (
        <SupportsSheet
          key={current.id}
          shop={current}
          supports={byShop.get(String(current.id)) ?? []}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setSupports((all) => all.filter((s) => s.shopId !== String(current.id)).concat(saved))
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}

function SupportsSheet({
  shop,
  supports,
  onClose,
  onSaved,
}: {
  shop: Shop
  supports: ShopSupport[]
  onClose: () => void
  onSaved: (saved: ShopSupport[]) => void
}) {
  const [baches, setBaches] = useState<Row[]>(() =>
    supports
      .filter((s) => s.kind === 'bache')
      .map((s) => keyed({ kind: 'bache', placement: s.placement, widthCm: s.widthCm, heightCm: s.heightCm, quantity: s.quantity, material: s.material, fixing: s.fixing, note: s.note })),
  )
  const [frames, setFrames] = useState<Record<(typeof FORMATS)[number], number>>(() => ({
    A1: supports.filter((s) => s.kind === 'affiche' && s.paperFormat === 'A1').reduce((n, s) => n + s.quantity, 0),
    A2: supports.filter((s) => s.kind === 'affiche' && s.paperFormat === 'A2').reduce((n, s) => n + s.quantity, 0),
    A3: supports.filter((s) => s.kind === 'affiche' && s.paperFormat === 'A3').reduce((n, s) => n + s.quantity, 0),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (key: string, change: Partial<Row>) => setBaches((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)))

  async function save() {
    setBusy(true)
    setError(null)
    const payload: ShopSupportInput[] = [
      ...baches.map(({ key: _key, ...row }) => ({
        kind: 'bache' as const,
        placement: row.placement || undefined,
        widthCm: Number(row.widthCm),
        heightCm: Number(row.heightCm),
        quantity: Number(row.quantity) || 1,
        material: row.material || undefined,
        fixing: row.fixing || undefined,
        note: row.note || undefined,
      })),
      ...FORMATS.filter((format) => frames[format] > 0).map((format) => ({ kind: 'affiche' as const, paperFormat: format, quantity: frames[format] })),
    ]
    try {
      onSaved(await api.saveShopSupports(shop.id, payload))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="card supports__sheet" aria-label={`Supports de ${shop.name}`}>
      <div className="supports__sheet-head">
        <h2 className="settings__group">Supports de {shop.name}</h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          Fermer
        </button>
      </div>

      {baches.map((row, i) => (
        <div key={row.key} className="supports__bache">
          <div className="supports__bache-head">
            <b>Bâche {i + 1}</b>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBaches((rows) => rows.filter((r) => r.key !== row.key))}>
              Retirer
            </button>
          </div>
          <label className="supports__field">
            Emplacement
            <input value={row.placement ?? ''} maxLength={120} placeholder="Façade, au-dessus de la vitrine" onChange={(e) => update(row.key, { placement: e.target.value })} />
          </label>
          <div className="supports__row">
            <label className="supports__field">
              Largeur (cm)
              <input type="number" min={10} max={2000} value={row.widthCm ?? ''} onChange={(e) => update(row.key, { widthCm: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label className="supports__field">
              Hauteur (cm)
              <input type="number" min={10} max={2000} value={row.heightCm ?? ''} onChange={(e) => update(row.key, { heightCm: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label className="supports__field">
              Qté
              <input type="number" min={1} max={99} value={row.quantity ?? 1} onChange={(e) => update(row.key, { quantity: Number(e.target.value) })} />
            </label>
          </div>
          <div className="supports__row">
            <label className="supports__field">
              Matière
              <select value={row.material ?? ''} onChange={(e) => update(row.key, { material: (e.target.value || null) as Row['material'] })}>
                <option value="">—</option>
                {MATERIALS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="supports__field">
              Fixation
              <select value={row.fixing ?? ''} onChange={(e) => update(row.key, { fixing: (e.target.value || null) as Row['fixing'] })}>
                <option value="">—</option>
                {FIXINGS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn--sm supports__add" onClick={() => setBaches((rows) => [...rows, keyed({ kind: 'bache', quantity: 1, material: 'pvc', fixing: 'oeillets' })])}>
        + Ajouter une bâche
      </button>

      <h3 className="section-label">Cadres d’affiche</h3>
      <div className="supports__row">
        {FORMATS.map((format) => (
          <label key={format} className="supports__field">
            {format}
            <input type="number" min={0} max={99} value={frames[format]} onChange={(e) => setFrames((f) => ({ ...f, [format]: Math.max(0, Number(e.target.value) || 0) }))} />
          </label>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}
      <div className="supports__actions">
        <button type="button" className="btn btn--sm" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void save()}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </aside>
  )
}
