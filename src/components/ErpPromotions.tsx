import * as api from '../lib/api/module'
import type { ErpPromotion, ErpPromotionFamily } from '../lib/api/module'
import { useAsync, formatDate } from '../lib/useAsync'

const FAMILY_LABEL: Record<ErpPromotionFamily, string> = {
  bundle: 'Bundle',
  buyXGetY: 'X achetés = Y offert',
  quantity: 'Promotion de quantité',
  scheduledDiscount: 'Remise programmée',
  voucher: 'Campagne de bons',
}
const DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

function euros(cents: number | null | undefined): string {
  return cents == null ? '—' : (cents / 100).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
}

/** La mécanique en clair, dans les mots des écrans des magasins (« 2 achetés = 1 offert »). */
export function mechanicLabel(p: ErpPromotion): string {
  const m = p.mechanic
  const r = m.reward ?? null

  if (p.family === 'bundle') return m.priceCents != null ? `${euros(m.priceCents)} le lot` : 'Lot de produits'

  if (p.family === 'buyXGetY') {
    const x = m.buyQuantity ?? 1
    const y = m.getQuantity ?? 1
    const bought = `${x} acheté${x > 1 ? 's' : ''}`
    if (!r || r.type === 'free' || (r.type === 'percentage' && (r.percent ?? 0) >= 100)) return `${bought} = ${y} offert${y > 1 ? 's' : ''}`
    if (r.type === 'percentage') return `${bought} = ${y} à -${r.percent} %`
    if (r.type === 'fixedPrice') return `${bought} = ${y} à ${euros(r.amountCents)}`
    return `${bought} = ${y} à -${euros(r.amountCents)}`
  }

  if (p.family === 'quantity') {
    const n = m.quantity ?? 0
    const f = m.freeQuantity ?? 0
    if (n > 0 && f > 0 && f < n) return `${n} pour le prix de ${n - f}`
    return n > 0 ? `Dès ${n} pièces` : 'Promotion de quantité'
  }

  if (p.family === 'scheduledDiscount') {
    if (!r) return 'Remise'
    if (r.type === 'percentage') return `-${r.percent} %`
    if (r.type === 'amountOff') return `-${euros(r.amountCents)}`
    if (r.type === 'fixedPrice') return euros(r.amountCents)
    return 'Offert'
  }

  return m.codeType === 'SHARED' && m.sharedCode ? `Code « ${m.sharedCode} »` : 'Codes uniques'
}

/** Les créneaux : les jours qui se suivent avec les mêmes heures sont groupés (« lun. → ven. 14:00–16:00 »). */
function scheduleLabel(p: ErpPromotion): string {
  if (!p.schedule.length) return 'Tous les jours, toute la journée'

  const byHours = new Map<string, number[]>()
  for (const w of p.schedule) {
    const key = `${w.from}–${w.to}`
    byHours.set(key, [...(byHours.get(key) ?? []), w.dayOfWeek])
  }

  return [...byHours]
    .map(([hours, days]) => {
      const d = [...new Set(days)].sort((a, b) => a - b)
      const run = d.length >= 3 && d.every((v, i) => i === 0 || v === d[i - 1] + 1)
      const label = d.length === 7 ? 'tous les jours' : run ? `${DAYS[d[0] - 1]} → ${DAYS[d[d.length - 1] - 1]}` : d.map((v) => DAYS[v - 1]).join(', ')
      return `${label} ${hours}`
    })
    .join(' · ')
}

function targets(p: ErpPromotion): string {
  // Un même produit peut déclencher l'offre et être offert (« 2 croissants achetés = 1 offert ») : une fois suffit.
  const products = p.products.map((x) => `${x.quantity && x.quantity !== 1 ? `${x.quantity}× ` : ''}${x.name ?? `produit ${x.erpProductId}`}`)
  const categories = p.categories.map((c) => `catégorie ${c.erpCategoryId}`)
  return [...new Set([...products, ...categories])].join(' · ') || '—'
}

function shops(p: ErpPromotion): string {
  if (p.family === 'voucher') return '—'
  if (p.shopScope === 'all') return 'Tout le réseau'
  return p.shops.map((s) => s.name ?? `boutique ERP ${s.erpShopId}`).join(', ') || '—'
}

interface ErpPromotionsProps {
  /** Les familles montrées par cet onglet. */
  families: ErpPromotionFamily[]
  title: string
}

/**
 * Les promotions de l'ERP (TFBuddy), telles qu'il les applique en caisse.
 *
 * Elles se créent et se modifient dans l'ERP : le module les lit sur son API,
 * pour les montrer à côté des offres de campagne. Une famille que l'ERP refuse
 * (droit manquant) ou qu'il ne sert pas est dite, sans masquer les autres.
 */
export default function ErpPromotions({ families, title }: ErpPromotionsProps) {
  const { data, error, loading } = useAsync(
    () => api.listErpPromotions(families.length === 1 ? families[0] : undefined),
    [families.join(',')],
  )

  if (loading) {
    return (
      <section className="card">
        <h2>{title}</h2>
        <p className="muted">Lecture de l’ERP…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>{title}</h2>
        <p className="error">{error}</p>
      </section>
    )
  }

  const rows = (data?.promotions ?? []).filter((p) => families.includes(p.family))
  const refusals = families
    .map((family) => ({ family, source: data?.sources[family] }))
    .filter((x) => x.source && !x.source.ok)

  return (
    <section className="card table-card">
      <h2>{title}</h2>
      <p className="muted">
        Lues sur l’API de l’ERP : elles s’y créent et s’y modifient, et ce sont elles que la caisse applique.
      </p>
      {!data?.configured ? (
        <p className="muted">L’adresse de l’ERP n’est pas renseignée sur ce serveur (MAR_ERP_API_BASE) : rien n’a été lu.</p>
      ) : (
        refusals.map(({ family, source }) => (
          <p key={family} className="error">
            {FAMILY_LABEL[family]} : {source?.error}
          </p>
        ))
      )}
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Promotion</th>
                <th>Mécanique</th>
                <th>Produits</th>
                <th>Créneaux</th>
                <th>Boutiques</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    <div className="muted">
                      {FAMILY_LABEL[p.family]}
                      {p.activationMode === 'VOUCHER_ONLY' ? ' · sur bon seulement' : ''}
                    </div>
                  </td>
                  <td>{mechanicLabel(p)}</td>
                  <td className="muted">{targets(p)}</td>
                  <td className="muted">
                    {p.family === 'voucher' ? '—' : scheduleLabel(p)}
                    {p.validFrom || p.validTo ? (
                      <div>
                        {formatDate(p.validFrom)} → {formatDate(p.validTo)}
                      </div>
                    ) : null}
                  </td>
                  <td className="muted">{shops(p)}</td>
                  <td>
                    <span className="chip chip--inline">{p.status === 'ACTIVE' ? 'Active' : p.status === 'DRAFT' ? 'Brouillon' : 'Inactive'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data?.configured && !refusals.length ? (
        <p className="muted">Aucune promotion de ce type dans l’ERP.</p>
      ) : null}
    </section>
  )
}
