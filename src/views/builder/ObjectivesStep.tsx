import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import type { SalesQuantities, ShopSalesRow } from '../../lib/api/module'
import type { Draft } from './CampaignBuilder'

/**
 * Étape « Objectifs » : un objectif de pièces par boutique, éclairé par les
 * ventes réelles des produits de l'offre.
 *
 * L'historique n'est qu'une aide : la période d'analyse se règle librement,
 * se compare à N-1, et peut pré-remplir les objectifs — mais c'est la saisie
 * qui fait foi, et elle vit dans le brouillon comme le reste de l'assistant.
 */

/** `AAAA-MM-JJ` local. */
function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Raccourcis de période : libellé → bornes. */
function shortcuts(): Array<{ label: string; from: string; to: string }> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  return [
    { label: 'Mois en cours', from: iso(new Date(year, month, 1)), to: iso(now) },
    {
      label: 'Mois dernier',
      from: iso(new Date(year, month - 1, 1)),
      to: iso(new Date(year, month, 0)),
    },
    {
      label: 'Trimestre en cours',
      from: iso(new Date(year, month - (month % 3), 1)),
      to: iso(now),
    },
    { label: 'Année en cours', from: iso(new Date(year, 0, 1)), to: iso(now) },
    {
      label: '12 derniers mois',
      from: iso(new Date(year - 1, month, now.getDate())),
      to: iso(now),
    },
  ]
}

/** `+12 %` / `−8 %`, ou `—` quand N-1 est nul : pas de division par zéro. */
function evolution(total: number, previous: number | null): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  if (previous === null) return null
  if (previous === 0) return { text: '—', tone: 'flat' }

  const pct = Math.round(((total - previous) / previous) * 100)

  return {
    text: `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)} %`,
    tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
  }
}

type SortKey = 'name' | 'total'

export default function ObjectivesStep({
  draft,
  patch,
}: {
  draft: Draft
  patch: (change: Partial<Draft>) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [growthPct, setGrowthPct] = useState('5')
  const [attempt, setAttempt] = useState(0)
  const [chartMode, setChartMode] = useState<'shops' | 'products'>('shops')

  const itemIds = draft.offer_items
    .map((element) => element.offer_item_id)
    .filter((id): id is number => id !== null)

  const periodInvalid = draft.analysis_to < draft.analysis_from

  // La donnée précédente reste affichée pendant un rechargement : changer de
  // période estompe le tableau au lieu de le faire disparaître.
  const sales = useAsync<SalesQuantities | null>(
    () =>
      itemIds.length === 0 || periodInvalid
        ? Promise.resolve(null)
        : api.getSalesQuantities({
            itemIds,
            from: draft.analysis_from,
            to: draft.analysis_to,
            compare: draft.analysis_compare,
          }),
    [
      draft.analysis_from,
      draft.analysis_to,
      draft.analysis_compare,
      itemIds.join(','),
      attempt,
    ],
  )

  const data = sales.data

  const sortedShops: ShopSalesRow[] =
    data === null
      ? []
      : [...data.shops].sort((left, right) => {
          const order =
            sortKey === 'name'
              ? left.shop_name.localeCompare(right.shop_name, 'fr')
              : left.total - right.total

          return sortAsc ? order : -order
        })

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc)
    else {
      setSortKey(key)
      setSortAsc(key === 'name')
    }
  }

  const sortMark = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '')

  const objectiveOf = (shopId: number): string => draft.shop_objectives[shopId] ?? ''
  const objectiveValid = (value: string): boolean => value === '' || /^\d+$/.test(value)

  const setObjective = (shopId: number, value: string) => {
    patch({ shop_objectives: { ...draft.shop_objectives, [shopId]: value } })
  }

  /** Pré-remplit chaque objectif avec les pièces réellement vendues. */
  const copyHistory = () => {
    if (data === null) return
    patch({
      shop_objectives: Object.fromEntries(
        data.shops.map((shop) => [shop.shop_id, String(shop.total)]),
      ),
    })
  }

  /** Historique × (1 + p %), arrondi à l'entier, jamais négatif. */
  const applyGrowth = () => {
    if (data === null || !/^-?\d+$/.test(growthPct.trim())) return
    const factor = 1 + Number(growthPct.trim()) / 100
    patch({
      shop_objectives: Object.fromEntries(
        data.shops.map((shop) => [
          shop.shop_id,
          String(Math.max(0, Math.round(shop.total * factor))),
        ]),
      ),
    })
  }

  const objectivesTotal = Object.values(draft.shop_objectives).reduce(
    (sum, value) => (/^\d+$/.test(value) ? sum + Number(value) : sum),
    0,
  )

  const compare = data?.compare ?? draft.analysis_compare

  // Deux lectures du même agrégat : les magasins qui vendent, les produits qui
  // partent. Chaque vue norme ses barres sur son propre maximum.
  const shopChartMax =
    data === null
      ? 0
      : Math.max(0, ...data.shops.map((shop) => Math.max(shop.total, shop.total_previous ?? 0)))
  const productChartMax =
    data === null
      ? 0
      : Math.max(
          0,
          ...data.products.map((product) =>
            Math.max(
              data.network.by_product[product.item_id] ?? 0,
              data.network.by_product_previous?.[product.item_id] ?? 0,
            ),
          ),
        )
  const chartMax = chartMode === 'shops' ? shopChartMax : productChartMax

  return (
    <>
      <h2>Objectifs</h2>
      <p className="muted">
        Fixez, boutique par boutique, un objectif de pièces sur les produits de l’offre. Les
        ventes réelles de la période choisie servent de repère — reprenez-les telles quelles ou
        appliquez-leur une progression.
      </p>

      <h3 className="section-label">Période d’analyse</h3>
      <div className="filters__row">
        <label className="field">
          Du
          <input
            type="date"
            value={draft.analysis_from}
            onChange={(e) => patch({ analysis_from: e.target.value })}
          />
        </label>
        <label className="field">
          Au
          <input
            type="date"
            value={draft.analysis_to}
            onChange={(e) => patch({ analysis_to: e.target.value })}
          />
        </label>
        {shortcuts().map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            className={`filter${
              draft.analysis_from === shortcut.from && draft.analysis_to === shortcut.to
                ? ' is-on'
                : ''
            }`}
            onClick={() => patch({ analysis_from: shortcut.from, analysis_to: shortcut.to })}
          >
            {shortcut.label}
          </button>
        ))}
        <button
          type="button"
          className={`filter${draft.analysis_compare ? ' is-on' : ''}`}
          aria-pressed={draft.analysis_compare}
          onClick={() => patch({ analysis_compare: !draft.analysis_compare })}
        >
          Comparer à N-1
        </button>
      </div>

      {periodInvalid ? <p className="error">La date de fin précède la date de début.</p> : null}

      {itemIds.length === 0 ? (
        <p className="muted">
          Aucun produit dans l’offre : retournez à l’étape « Offre » pour en sélectionner —
          l’historique et les objectifs portent sur eux.
        </p>
      ) : sales.error !== null ? (
        <p className="error">
          Ventes indisponibles : {sales.error}{' '}
          <button type="button" className="filter" onClick={() => setAttempt(attempt + 1)}>
            Réessayer
          </button>
        </p>
      ) : data === null ? (
        <p className="muted">Chargement des ventes…</p>
      ) : (
        <div className={sales.loading ? 'objectives is-refreshing' : 'objectives'}>
          {data.warning !== null ? <p className="muted">{data.warning}</p> : null}
          {data.warning === null && data.network.total === 0 ? (
            <p className="muted">
              Aucune vente de ces produits sur la période — les objectifs se posent quand même.
            </p>
          ) : null}

          <div className="filters__row">
            <button type="button" className="filter" onClick={copyHistory}>
              Reprendre l’historique
            </button>
            <label className="field objectives__growth">
              Progression
              <span className="objectives__growth-input">
                <input
                  value={growthPct}
                  inputMode="numeric"
                  onChange={(e) => setGrowthPct(e.target.value)}
                  aria-label="Progression en pourcentage"
                />
                %
              </span>
            </label>
            <button
              type="button"
              className="filter"
              disabled={!/^-?\d+$/.test(growthPct.trim())}
              onClick={applyGrowth}
            >
              Appliquer à l’historique
            </button>
            {sales.loading ? <span className="muted">Actualisation…</span> : null}
          </div>

          <div className="table-card">
            <div className="table-scroll objectives__scroll">
              <table>
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="objectives__sort" onClick={() => toggleSort('name')}>
                        Magasin{sortMark('name')}
                      </button>
                    </th>
                    {data.products.map((product) => (
                      <th key={product.item_id} className="num">
                        {product.name}
                      </th>
                    ))}
                    <th className="num">
                      <button type="button" className="objectives__sort" onClick={() => toggleSort('total')}>
                        Total{sortMark('total')}
                      </button>
                    </th>
                    {compare ? <th className="num">Total N-1</th> : null}
                    {compare ? <th className="num">Évol.</th> : null}
                    <th className="num">Objectif (pièces)</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedShops.map((shop) => {
                    const value = objectiveOf(shop.shop_id)
                    const valid = objectiveValid(value)
                    const trend = evolution(shop.total, shop.total_previous)

                    return (
                      <tr key={shop.shop_id}>
                        <td>{shop.shop_name}</td>
                        {data.products.map((product) => (
                          <td key={product.item_id} className="num">
                            {shop.quantities[product.item_id] ?? 0}
                          </td>
                        ))}
                        <td className="num">
                          <strong>{shop.total}</strong>
                        </td>
                        {compare ? <td className="num">{shop.total_previous ?? 0}</td> : null}
                        {compare ? (
                          <td className={`num objectives__trend-${trend?.tone ?? 'flat'}`}>
                            {trend?.text ?? '—'}
                          </td>
                        ) : null}
                        <td className="num objectives__goal">
                          <input
                            value={value}
                            inputMode="numeric"
                            placeholder="0"
                            aria-invalid={!valid}
                            className={valid ? undefined : 'is-invalid'}
                            onChange={(e) => setObjective(shop.shop_id, e.target.value)}
                          />
                          {valid ? null : <span className="error">Entier ≥ 0</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Réseau</td>
                    {data.products.map((product) => (
                      <td key={product.item_id} className="num">
                        {data.network.by_product[product.item_id] ?? 0}
                      </td>
                    ))}
                    <td className="num">
                      <strong>{data.network.total}</strong>
                    </td>
                    {compare ? <td className="num">{data.network.total_previous ?? 0}</td> : null}
                    {compare ? (
                      <td className="num">
                        {evolution(data.network.total, data.network.total_previous)?.text ?? '—'}
                      </td>
                    ) : null}
                    <td className="num">
                      <strong>{objectivesTotal}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {shopChartMax > 0 || productChartMax > 0 ? (
            <>
              <h3 className="section-label">
                Pièces vendues{compare ? ' — période vs N-1' : ''}
                <span className="sales-chart__modes">
                  <button
                    type="button"
                    className={`filter${chartMode === 'shops' ? ' is-on' : ''}`}
                    aria-pressed={chartMode === 'shops'}
                    onClick={() => setChartMode('shops')}
                  >
                    Par magasin
                  </button>
                  <button
                    type="button"
                    className={`filter${chartMode === 'products' ? ' is-on' : ''}`}
                    aria-pressed={chartMode === 'products'}
                    onClick={() => setChartMode('products')}
                  >
                    Par produit
                  </button>
                </span>
              </h3>
              <div className="sales-chart">
                {chartMode === 'shops'
                  ? sortedShops.map((shop) => (
                      <div
                        key={shop.shop_id}
                        className="sales-chart__group"
                        title={`${shop.shop_name} — ${shop.total} pièce${shop.total > 1 ? 's' : ''}${
                          shop.total_previous !== null ? ` (N-1 : ${shop.total_previous})` : ''
                        }`}
                      >
                        <div className="sales-chart__bars">
                          <span
                            className="sales-chart__bar"
                            style={{ height: `${Math.round((shop.total / (chartMax || 1)) * 100)}%` }}
                          />
                          {compare ? (
                            <span
                              className="sales-chart__bar sales-chart__bar--previous"
                              style={{
                                height: `${Math.round(((shop.total_previous ?? 0) / (chartMax || 1)) * 100)}%`,
                              }}
                            />
                          ) : null}
                        </div>
                        <span className="sales-chart__label">{shop.shop_name}</span>
                      </div>
                    ))
                  : data.products.map((product) => {
                      const total = data.network.by_product[product.item_id] ?? 0
                      const previous = data.network.by_product_previous?.[product.item_id] ?? null

                      return (
                        <div
                          key={product.item_id}
                          className="sales-chart__group"
                          title={`${product.name} — ${total} pièce${total > 1 ? 's' : ''}${
                            previous !== null ? ` (N-1 : ${previous})` : ''
                          }`}
                        >
                          <div className="sales-chart__bars">
                            <span
                              className="sales-chart__bar"
                              style={{ height: `${Math.round((total / (chartMax || 1)) * 100)}%` }}
                            />
                            {compare ? (
                              <span
                                className="sales-chart__bar sales-chart__bar--previous"
                                style={{
                                  height: `${Math.round(((previous ?? 0) / (chartMax || 1)) * 100)}%`,
                                }}
                              />
                            ) : null}
                          </div>
                          <span className="sales-chart__label">{product.name}</span>
                        </div>
                      )
                    })}
              </div>
            </>
          ) : null}
        </div>
      )}
    </>
  )
}
