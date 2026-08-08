import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import type { SalesQuantities, ShopSalesRow } from '../../lib/api/module'
import type { Draft } from './CampaignBuilder'
import RangeCalendar from './RangeCalendar'

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

/**
 * Part des tickets contenant le produit. Sans ticket sur la période, la
 * question n'a pas de réponse : « — » plutôt qu'un zéro trompeur.
 */
function penetration(withProduct: number, tickets: number): string {
  if (tickets === 0) return '—'

  const pct = (withProduct / tickets) * 100

  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1).replace('.', ',')} %`
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

  /** Pourcentage exploitable, ou zéro : une saisie en cours ne fausse rien. */
  const readPct = (value: string): number =>
    /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : 0

  /**
   * Objectif de chaque boutique : son historique produit par produit, chacun
   * majoré de sa propre progression — celle du produit s'il en porte une, la
   * générale sinon. L'arrondi vient à la fin, sur le total de la boutique :
   * arrondir chaque produit d'abord accumulerait sept erreurs sur sept lignes.
   */
  const computeObjectives = (
    growths: Record<number, string>,
    general: string,
  ): Record<number, string> => {
    if (data === null) return draft.shop_objectives

    return Object.fromEntries(
      data.shops.map((shop) => {
        const total = data.products.reduce((sum, product) => {
          const own = growths[product.item_id]
          const pct = readPct(own !== undefined && own.trim() !== '' ? own : general)

          return sum + (shop.quantities[product.item_id] ?? 0) * (1 + pct / 100)
        }, 0)

        return [shop.shop_id, String(Math.max(0, Math.round(total)))]
      }),
    )
  }

  /** Progression du produit : la sienne, ou rien — le champ montre la générale. */
  const growthOf = (itemId: number): string => draft.product_growth[itemId] ?? ''

  const setProductGrowth = (itemId: number, value: string) => {
    const next = { ...draft.product_growth, [itemId]: value }
    patch({ product_growth: next, shop_objectives: computeObjectives(next, growthPct) })
  }

  /** Pré-remplit chaque objectif avec les pièces réellement vendues. */
  const copyHistory = () => {
    if (data === null) return
    patch({ product_growth: {}, shop_objectives: computeObjectives({}, '0') })
  }

  /** La progression générale s'applique partout : les réglages produit cèdent. */
  const applyGrowth = () => {
    if (data === null || !/^-?\d+$/.test(growthPct.trim())) return
    patch({ product_growth: {}, shop_objectives: computeObjectives({}, growthPct) })
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

      {/* Le même calendrier qu'aux autres étapes. Les deux champs natifs
          affichaient `mm/dd/yyyy` — l'ordre américain — parce qu'un
          `input[type=date]` suit la locale du navigateur et non celle de
          l'application : impossible à corriger en CSS, et rien n'empêchait de
          saisir le 10 janvier pour le 1er octobre. Les raccourcis ci-dessus
          couvrent les périodes courantes ; le calendrier sert aux autres. */}
      <RangeCalendar
        from={draft.analysis_from}
        to={draft.analysis_to}
        onChange={(range) =>
          patch({ analysis_from: range.starts_on, analysis_to: range.ends_on })
        }
      />

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

          {/* Rangée d'outils à part : dans les rangées de filtres de
              l'assistant, un champ porte son étiquette au-dessus, ce qui
              décalait ces contrôles d'une demi-hauteur par rapport aux
              pastilles voisines. Ici tout est aligné sur une même ligne. */}
          <div className="objectives__tools">
            <button type="button" className="filter" onClick={copyHistory}>
              Reprendre l’historique
            </button>
            <span className="objectives__general">
              Progression générale
              <span className="objectives__pct">
                <input
                  value={growthPct}
                  inputMode="numeric"
                  onChange={(e) => setGrowthPct(e.target.value)}
                  aria-label="Progression générale en pourcentage"
                />
                %
              </span>
            </span>
            <button
              type="button"
              className="filter"
              disabled={!/^-?\d+$/.test(growthPct.trim())}
              onClick={applyGrowth}
            >
              Appliquer à tous les produits
            </button>
            {sales.loading ? <span className="muted">Actualisation…</span> : null}
          </div>

          <div className="table-card">
            <div className="table-scroll objectives__scroll">
              {/* Axes inversés : les produits en lignes, les magasins en
                  colonnes. Les noms de produits — « Bûche cheesecake &
                  fruits des bois - passion - 4/6 personnes » — tenaient mal
                  en en-tête de colonne, où ils s'empilaient sur trois lignes
                  et poussaient le tableau hors du cadre. */}
              <table className="objectives__table">
                <thead>
                  <tr>
                    <th className="objectives__corner">
                      Produit
                      <span className="objectives__sorts">
                        Magasins :
                        <button
                          type="button"
                          className={sortKey === 'name' ? 'objectives__sort is-on' : 'objectives__sort'}
                          onClick={() => toggleSort('name')}
                        >
                          A-Z{sortMark('name')}
                        </button>
                        <button
                          type="button"
                          className={sortKey === 'total' ? 'objectives__sort is-on' : 'objectives__sort'}
                          onClick={() => toggleSort('total')}
                        >
                          Ventes{sortMark('total')}
                        </button>
                      </span>
                    </th>
                    {sortedShops.map((shop) => (
                      <th key={shop.shop_id} className="num objectives__shop">
                        {shop.shop_name}
                        <span className="objectives__tickets">
                          {shop.tickets.toLocaleString('fr-BE')} ticket
                          {shop.tickets > 1 ? 's' : ''}
                        </span>
                      </th>
                    ))}
                    <th className="num objectives__shop">
                      Total réseau
                      <span className="objectives__tickets">
                        {data.network.tickets.toLocaleString('fr-BE')} ticket
                        {data.network.tickets > 1 ? 's' : ''}
                      </span>
                    </th>
                    {compare ? <th className="num">N-1</th> : null}
                    {compare ? <th className="num">Évol.</th> : null}
                    <th className="num">Progression</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.map((product) => {
                    const total = data.network.by_product[product.item_id] ?? 0
                    const previous = compare
                      ? (data.network.by_product_previous?.[product.item_id] ?? 0)
                      : null
                    const trend = evolution(total, previous)

                    return (
                      <tr key={product.item_id}>
                        <td>{product.name}</td>
                        {sortedShops.map((shop) => (
                          <td key={shop.shop_id} className="num">
                            {shop.quantities[product.item_id] ?? 0}
                            <span className="objectives__rate">
                              {penetration(
                                shop.tickets_by_product[product.item_id] ?? 0,
                                shop.tickets,
                              )}
                            </span>
                          </td>
                        ))}
                        <td className="num">
                          <strong>{total}</strong>
                          <span className="objectives__rate">
                            {penetration(
                              data.network.tickets_by_product[product.item_id] ?? 0,
                              data.network.tickets,
                            )}
                          </span>
                        </td>
                        {compare ? <td className="num">{previous ?? 0}</td> : null}
                        {compare ? (
                          <td className={`num objectives__trend-${trend?.tone ?? 'flat'}`}>
                            {trend?.text ?? '—'}
                          </td>
                        ) : null}
                        <td className="num">
                          <span className="objectives__pct">
                            <input
                              value={growthOf(product.item_id)}
                              placeholder={growthPct}
                              inputMode="numeric"
                              aria-label={`Progression pour ${product.name}`}
                              title="Vide : suit la progression générale"
                              onChange={(e) => setProductGrowth(product.item_id, e.target.value)}
                            />
                            %
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total période</td>
                    {sortedShops.map((shop) => (
                      <td key={shop.shop_id} className="num">
                        <strong>{shop.total}</strong>
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
                    <td />
                  </tr>

                  {compare ? (
                    <tr>
                      <td>Total N-1</td>
                      {sortedShops.map((shop) => (
                        <td key={shop.shop_id} className="num">
                          {shop.total_previous ?? 0}
                        </td>
                      ))}
                      <td className="num">{data.network.total_previous ?? 0}</td>
                      <td />
                      <td />
                      <td />
                    </tr>
                  ) : null}

                  {compare ? (
                    <tr>
                      <td>Évolution</td>
                      {sortedShops.map((shop) => {
                        const trend = evolution(shop.total, shop.total_previous)

                        return (
                          <td
                            key={shop.shop_id}
                            className={`num objectives__trend-${trend?.tone ?? 'flat'}`}
                          >
                            {trend?.text ?? '—'}
                          </td>
                        )
                      })}
                      <td className="num">
                        {evolution(data.network.total, data.network.total_previous)?.text ?? '—'}
                      </td>
                      <td />
                      <td />
                      <td />
                    </tr>
                  ) : null}

                  <tr className="objectives__goals">
                    <td>Objectif (pièces)</td>
                    {sortedShops.map((shop) => {
                      const value = objectiveOf(shop.shop_id)
                      const valid = objectiveValid(value)

                      return (
                        <td key={shop.shop_id} className="num objectives__goal">
                          <input
                            value={value}
                            inputMode="numeric"
                            placeholder="0"
                            aria-label={`Objectif ${shop.shop_name}`}
                            aria-invalid={!valid}
                            className={valid ? undefined : 'is-invalid'}
                            onChange={(e) => setObjective(shop.shop_id, e.target.value)}
                          />
                          {valid ? null : <span className="error">Entier ≥ 0</span>}
                        </td>
                      )
                    })}
                    <td className="num">
                      <strong>{objectivesTotal}</strong>
                    </td>
                    {compare ? <td /> : null}
                    {compare ? <td /> : null}
                    <td />
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
