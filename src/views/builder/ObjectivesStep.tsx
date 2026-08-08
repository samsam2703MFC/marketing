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
 * Une fiche par magasin plutôt qu'un tableau croisé. Chaque fiche porte ses
 * trois barres — période, N-1, objectif — sur une échelle commune à tout le
 * réseau : c'est ce qui permet de comparer deux magasins sans remonter à un
 * graphique séparé, et de voir que l'objectif de l'un demande deux fois plus
 * d'effort que celui de l'autre. Le tableau produit par produit reste, replié,
 * pour la saisie fine.
 */

/** `AAAA-MM-JJ` local. */
function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** `01/11/2025`, l'ordre français — celui du reste de l'assistant. */
function human(value: string): string {
  const [year, month, day] = value.split('-')

  return year === undefined || month === undefined || day === undefined
    ? value
    : `${day}/${month}/${year}`
}

/** Nombre de jours couverts, bornes comprises. */
function span(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00`)
  const end = Date.parse(`${to}T00:00:00`)

  return Number.isNaN(start) || Number.isNaN(end)
    ? 0
    : Math.round((end - start) / 86_400_000) + 1
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

const fr = (value: number): string => value.toLocaleString('fr-BE')

/** Entier saisi, ou zéro : une saisie en cours ne doit rien fausser. */
function readInt(value: string): number {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : 0
}

/**
 * Nuance d'une part du mix, sur une rampe de cinq crans.
 *
 * Les crans sont étalés sur toute la rampe plutôt que pris dans l'ordre : deux
 * produits recevraient sinon les deux nuances les plus foncées, voisines, et
 * une barre de 8 px de haut les donnerait à lire comme une seule.
 */
function mixStep(rank: number, count: number): number {
  const spread: Record<number, number[]> = {
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
  }

  return spread[count]?.[rank] ?? rank + 1
}

/** Largeur d'une barre en pourcentage de l'échelle commune. */
function width(value: number, max: number): string {
  if (max <= 0 || value <= 0) return '0%'

  // Un plancher visible : une boutique à 12 pièces sur une échelle de 2 000
  // donnerait un trait de moins d'un pixel, impossible à distinguer de zéro.
  return `${Math.max(0.6, (value / max) * 100)}%`
}

/** Critères de classement, dans l'ordre où ils se proposent. */
const METRICS: Array<{ key: Draft['challenge_metric']; label: string; note: string }> = [
  {
    key: 'attainment',
    label: 'Taux d’atteinte de l’objectif',
    note: 'Met les magasins sur la même ligne de départ, quelle que soit leur taille.',
  },
  {
    key: 'pieces',
    label: 'Pièces vendues',
    note: 'Le volume brut : la plus grosse boutique part avec une avance qu’aucun effort ne comble.',
  },
  {
    key: 'growth',
    label: 'Progression vs N-1',
    note: 'Récompense l’accélération — avantage celle qui partait de bas.',
  },
]

type SortKey = 'name' | 'total'

export default function ObjectivesStep({
  draft,
  patch,
}: {
  draft: Draft
  patch: (change: Partial<Draft>) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortAsc, setSortAsc] = useState(false)
  const [growthPct, setGrowthPct] = useState('5')
  const [attempt, setAttempt] = useState(0)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  const itemIds = draft.offer_items
    .map((element) => element.offer_item_id)
    .filter((id): id is number => id !== null)

  const periodInvalid = draft.analysis_to < draft.analysis_from

  // La donnée précédente reste affichée pendant un rechargement : changer de
  // période estompe l'écran au lieu de le faire disparaître.
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

  /**
   * Échelle commune à toutes les fiches. Elle couvre le réalisé, le N-1 et les
   * objectifs saisis : une échelle par fiche ferait lire une boutique à 681
   * pièces comme l'égale d'une boutique à 1 541.
   */
  const axisMax =
    data === null
      ? 0
      : Math.max(
          0,
          ...data.shops.map((shop) =>
            Math.max(
              shop.total,
              shop.total_previous ?? 0,
              readInt(objectiveOf(shop.shop_id)),
            ),
          ),
        )

  const networkPrevious = data?.network.total_previous ?? null
  const networkTrend = compare ? evolution(data?.network.total ?? 0, networkPrevious) : null

  /** Part du chemin déjà parcourue, bornée : un objectif sous l'historique ne déborde pas. */
  const achieved =
    data === null || objectivesTotal === 0
      ? 0
      : Math.min(100, (data.network.total / objectivesTotal) * 100)

  const activeShortcut = shortcuts().find(
    (shortcut) => draft.analysis_from === shortcut.from && draft.analysis_to === shortcut.to,
  )

  /* ── Challenge ───────────────────────────────────────────────────────── */

  /** Seuil applicable : celui du magasin, sinon le général. */
  const triggerOf = (shopId: number): number => {
    const own = draft.shop_triggers[shopId]
    const value = own !== undefined && own.trim() !== '' ? own : draft.challenge_trigger_pct

    return /^\d+([.,]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(',', '.')) : 0
  }

  const setTrigger = (shopId: number, value: string) => {
    patch({ shop_triggers: { ...draft.shop_triggers, [shopId]: value } })
  }

  const setPrize = (rank: number, value: string) => {
    patch({
      challenge_prizes: draft.challenge_prizes.map((label, index) =>
        index === rank ? value : label,
      ),
    })
  }

  /** Pièces qu'il faut atteindre pour entrer dans la course. */
  const barOf = (shopId: number, objective: number): number =>
    Math.ceil((objective * triggerOf(shopId)) / 100)

  /**
   * Ligne de départ : où chacun en est de sa propre barre, avec les données de
   * la période d'analyse. Ce n'est pas un classement final — la campagne n'a
   * pas commencé — mais c'est ce qui permet de voir qu'un objectif mal posé
   * décide du classement avant le premier jour.
   */
  const standings =
    data === null
      ? []
      : data.shops
          .map((shop) => {
            const objective = readInt(objectiveOf(shop.shop_id))
            const bar = barOf(shop.shop_id, objective)
            const previous = shop.total_previous ?? 0

            return {
              shop,
              objective,
              bar,
              rate: objective === 0 ? null : (shop.total / objective) * 100,
              growth: previous === 0 ? null : ((shop.total - previous) / previous) * 100,
              qualified: objective > 0 && shop.total >= bar,
              missing: Math.max(0, bar - shop.total),
            }
          })
          .filter((entry) => entry.objective > 0)
          .sort((left, right) => {
            if (draft.challenge_metric === 'pieces') return right.shop.total - left.shop.total
            if (draft.challenge_metric === 'growth') return (right.growth ?? -Infinity) - (left.growth ?? -Infinity)

            return (right.rate ?? -Infinity) - (left.rate ?? -Infinity)
          })

  /** Magasins hors course : sans objectif, il n'y a rien à franchir. */
  const outOfRace =
    data === null ? [] : data.shops.filter((shop) => readInt(objectiveOf(shop.shop_id)) === 0)

  const prizeCount = draft.challenge_prizes.filter((label) => label.trim() !== '').length
  const activeMetric = METRICS.find((entry) => entry.key === draft.challenge_metric)

  return (
    <>
      <h2>Objectifs</h2>
      <p className="muted">
        Chaque magasin porte ses trois barres sur une échelle commune : ce qu’il a vendu, ce
        qu’il vendait l’an dernier, ce qu’on lui demande. Deux fiches se comparent à l’œil.
      </p>

      {/* Période : une ligne repliée plutôt que deux mois de calendrier en
          permanence. Le réglage se fait une fois, les raccourcis couvrent le
          cas courant, et le calendrier ne s'ouvre que si on le demande. */}
      <div className="period-bar">
        <strong>
          Du {human(draft.analysis_from)} au {human(draft.analysis_to)}
        </strong>
        <span className="period-bar__meta">
          {span(draft.analysis_from, draft.analysis_to)} jours
          {data === null ? null : ` · ${fr(data.network.tickets)} tickets`}
          {activeShortcut === undefined ? null : ` · ${activeShortcut.label.toLowerCase()}`}
        </span>
        <span className="period-bar__spacer" />
        <div className="period-bar__actions">
          {shortcuts().map((shortcut) => (
            <button
              key={shortcut.label}
              type="button"
              className={`filter${activeShortcut?.label === shortcut.label ? ' is-on' : ''}`}
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
          <button
            type="button"
            className={`filter${periodOpen ? ' is-on' : ''}`}
            aria-expanded={periodOpen}
            onClick={() => setPeriodOpen(!periodOpen)}
          >
            {periodOpen ? 'Fermer le calendrier' : 'Modifier la période'}
          </button>
        </div>
      </div>

      {/* Les deux champs natifs affichaient `mm/dd/yyyy` — l'ordre américain —
          parce qu'un `input[type=date]` suit la locale du navigateur et non
          celle de l'application. Le calendrier maison règle la question. */}
      {periodOpen ? (
        <RangeCalendar
          from={draft.analysis_from}
          to={draft.analysis_to}
          onChange={(range) =>
            patch({ analysis_from: range.starts_on, analysis_to: range.ends_on })
          }
        />
      ) : null}

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

          {/* Bandeau réseau : l'écart entre ce qui a été fait et ce qui est
              demandé. C'est le chiffre que l'écran ne donnait nulle part, et
              c'est pourtant celui que la campagne doit combler. */}
          <div className="network-strip">
            <div className="network-strip__totals">
              <span className="network-strip__label">Réseau</span>
              <span className="network-strip__figures">
                <strong>{fr(data.network.total)}</strong> réalisées →{' '}
                <strong className="network-strip__goal">{fr(objectivesTotal)}</strong> visées
              </span>
            </div>
            <div className="network-strip__gauge">
              <div className="network-strip__bar">
                <span className="network-strip__done" style={{ width: `${achieved}%` }} />
                <span className="network-strip__todo" />
              </div>
              <div className="network-strip__legend">
                <span>
                  {fr(data.network.total)} acquis · {fr(data.network.tickets)} tickets
                  {networkTrend === null ? null : ` · ${networkTrend.text} vs N-1`}
                </span>
                <span>
                  {objectivesTotal <= data.network.total
                    ? 'objectif atteint par l’historique'
                    : `+${fr(objectivesTotal - data.network.total)} à conquérir${
                        data.network.total === 0
                          ? ''
                          : ` (+${Math.round(
                              ((objectivesTotal - data.network.total) / data.network.total) * 100,
                            )} %)`
                      }`}
                </span>
              </div>
            </div>
          </div>

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
            <span className="objectives__sorts">
              Trier :
              <button
                type="button"
                className={sortKey === 'total' ? 'objectives__sort is-on' : 'objectives__sort'}
                onClick={() => toggleSort('total')}
              >
                Ventes{sortMark('total')}
              </button>
              <button
                type="button"
                className={sortKey === 'name' ? 'objectives__sort is-on' : 'objectives__sort'}
                onClick={() => toggleSort('name')}
              >
                A-Z{sortMark('name')}
              </button>
            </span>
            {sales.loading ? <span className="muted">Actualisation…</span> : null}
          </div>

          <h3 className="section-label">
            Magasins
            <span className="shop-legend">
              <span>
                <i className="shop-legend__mark shop-legend__mark--real" />
                Période
              </span>
              {compare ? (
                <span>
                  <i className="shop-legend__mark shop-legend__mark--prev" />
                  N-1
                </span>
              ) : null}
              <span>
                <i className="shop-legend__mark shop-legend__mark--goal" />
                Objectif
              </span>
              <span className="shop-legend__scale">
                échelle commune 0 → {fr(axisMax)}
              </span>
            </span>
          </h3>

          <div className="shop-cards">
            {sortedShops.map((shop) => {
              const goal = readInt(objectiveOf(shop.shop_id))
              const raw = objectiveOf(shop.shop_id)
              const valid = objectiveValid(raw)
              const previous = compare ? (shop.total_previous ?? 0) : null
              const trend = compare ? evolution(shop.total, previous) : null
              const share =
                data.network.total === 0 ? 0 : Math.round((shop.total / data.network.total) * 100)
              const effort =
                shop.total === 0 ? null : Math.round(((goal - shop.total) / shop.total) * 100)

              // Le mix produit : classé par volume, donc une seule teinte
              // déclinée du foncé au clair. Une couleur par produit dépenserait
              // cinq teintes pour une information que l'ordre porte déjà.
              const mix = data.products
                .map((product) => ({
                  name: product.name,
                  quantity: shop.quantities[product.item_id] ?? 0,
                }))
                .filter((entry) => entry.quantity > 0)
                .sort((left, right) => right.quantity - left.quantity)

              return (
                <div
                  key={shop.shop_id}
                  className={shop.tickets === 0 ? 'shop-card shop-card--blind' : 'shop-card'}
                >
                  <div className="shop-card__head">
                    <strong>{shop.shop_name}</strong>
                    <span className="shop-card__tickets">
                      {shop.tickets === 0
                        ? 'aucun ticket'
                        : `${fr(shop.tickets)} ticket${shop.tickets > 1 ? 's' : ''}`}
                    </span>
                  </div>

                  <div className="shop-card__hero">
                    <span className="shop-card__total">{fr(shop.total)}</span>
                    <span className="shop-card__unit">
                      pièce{shop.total > 1 ? 's' : ''} · {share} % du réseau
                    </span>
                    {trend === null ? null : (
                      <span className={`objectives__trend-${trend.tone} shop-card__trend`}>
                        {trend.text}
                      </span>
                    )}
                  </div>

                  <div className="shop-card__bars">
                    <div className="bar-row">
                      <span className="bar-row__track">
                        <span
                          className="bar-row__fill bar-row__fill--real"
                          style={{ width: width(shop.total, axisMax) }}
                        />
                      </span>
                      <span className="bar-row__value">{fr(shop.total)}</span>
                    </div>

                    {compare ? (
                      <div className="bar-row">
                        <span className="bar-row__track">
                          <span
                            className="bar-row__fill bar-row__fill--prev"
                            style={{ width: width(previous ?? 0, axisMax) }}
                          />
                        </span>
                        <span className="bar-row__value bar-row__value--muted">
                          {fr(previous ?? 0)}
                        </span>
                      </div>
                    ) : null}

                    <div className="bar-row">
                      <span className="bar-row__track">
                        <span
                          className="bar-row__fill bar-row__fill--goal"
                          style={{ width: width(goal, axisMax) }}
                        />
                      </span>
                      <span className="bar-row__value bar-row__value--goal">{fr(goal)}</span>
                    </div>
                  </div>

                  {shop.tickets === 0 ? (
                    <p className="shop-card__blind">
                      Aucune vente sur la période : ce chiffre se décide, il ne se déduit pas.
                    </p>
                  ) : mix.length > 1 ? (
                    <div className="shop-card__mix">
                      <span className="shop-card__mix-bar">
                        {mix.slice(0, 5).map((entry, rank) => (
                          <span
                            key={entry.name}
                            className={`shop-card__mix-part shop-card__mix-part--${mixStep(
                              rank,
                              Math.min(mix.length, 5),
                            )}`}
                            style={{ width: `${(entry.quantity / shop.total) * 100}%` }}
                            title={`${entry.name} — ${fr(entry.quantity)} pièce${
                              entry.quantity > 1 ? 's' : ''
                            }`}
                          />
                        ))}
                      </span>
                      {/* Deux produits se nomment tous les deux ; au-delà, le
                          premier suffit et le reste se compte — un nom entier
                          par part remplirait la fiche sans rien apprendre. */}
                      <span className="shop-card__mix-legend">
                        {mix.length === 2
                          ? mix
                              .map(
                                (entry) =>
                                  `${entry.name} ${Math.round((entry.quantity / shop.total) * 100)} %`,
                              )
                              .join(' · ')
                          : `${mix[0]?.name} ${Math.round(
                              ((mix[0]?.quantity ?? 0) / shop.total) * 100,
                            )} % · ${mix.length - 1} autres produits`}
                      </span>
                    </div>
                  ) : null}

                  {/* Le seuil du magasin, traduit en pièces : un chef d'équipe
                      agit sur des pièces, pas sur un pourcentage. */}
                  {draft.challenge_enabled && goal > 0 ? (
                    <div className="shop-card__challenge">
                      <span>
                        Seuil {triggerOf(shop.shop_id)} % ={' '}
                        <strong>{fr(barOf(shop.shop_id, goal))} pièces</strong>
                      </span>
                      <span className="shop-card__challenge-gap">
                        {shop.total >= barOf(shop.shop_id, goal)
                          ? 'déjà franchi sur la période'
                          : `il manque ${fr(barOf(shop.shop_id, goal) - shop.total)}`}
                      </span>
                    </div>
                  ) : null}

                  <div className="shop-card__goal">
                    <span className="shop-card__goal-label">Objectif</span>
                    <input
                      value={raw}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Objectif ${shop.shop_name}`}
                      aria-invalid={!valid}
                      className={valid ? undefined : 'is-invalid'}
                      onChange={(e) => setObjective(shop.shop_id, e.target.value)}
                    />
                    {!valid ? (
                      <span className="error">Entier ≥ 0</span>
                    ) : effort === null ? (
                      <span className="shop-card__effort shop-card__effort--blind">
                        sans repère
                      </span>
                    ) : (
                      <span className="shop-card__effort">
                        {effort > 0 ? '+' : effort < 0 ? '−' : ''}
                        {Math.abs(effort)} %
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Challenge ─────────────────────────────────────────────────
              Facultatif, et l'écran le dit avant d'en montrer les réglages :
              une campagne sans challenge est une campagne valide, c'est même
              le cas par défaut. */}
          <h3 className="section-label">
            Challenge
            <span className="section-label__aside">Facultatif</span>
          </h3>

          <button
            type="button"
            className={draft.challenge_enabled ? 'switch is-on' : 'switch'}
            aria-pressed={draft.challenge_enabled}
            onClick={() => patch({ challenge_enabled: !draft.challenge_enabled })}
          >
            <span className="switch__track" aria-hidden="true" />
            <span className="switch__label">Classer les magasins entre eux</span>
            <span className="switch__hint">
              {draft.challenge_enabled
                ? 'Chaque magasin doit franchir son seuil pour entrer dans la course.'
                : 'Sans challenge, chaque magasin ne joue que contre son propre objectif.'}
            </span>
          </button>

          {draft.challenge_enabled ? (
            <div className="challenge">
              <div className="challenge__grid">
                <div className="challenge__field">
                  <span className="challenge__label">Critère de classement</span>
                  <div className="filters__row">
                    {METRICS.map((metric) => (
                      <button
                        key={metric.key}
                        type="button"
                        className={`filter${draft.challenge_metric === metric.key ? ' is-on' : ''}`}
                        aria-pressed={draft.challenge_metric === metric.key}
                        onClick={() => patch({ challenge_metric: metric.key })}
                      >
                        {metric.label}
                      </button>
                    ))}
                  </div>
                  <span className="challenge__note">{activeMetric?.note}</span>
                </div>

                <div className="challenge__field">
                  <span className="challenge__label">Seuil de participation</span>
                  <span className="objectives__pct">
                    <input
                      value={draft.challenge_trigger_pct}
                      inputMode="numeric"
                      aria-label="Seuil de participation général en pourcentage"
                      onChange={(e) => patch({ challenge_trigger_pct: e.target.value })}
                    />
                    % de l’objectif
                  </span>
                  <span className="challenge__note">
                    S’applique à tous, sauf aux magasins dont vous réglez le seuil à la main.
                  </span>
                </div>

                <div className="challenge__field">
                  <span className="challenge__label">Récompenses</span>
                  <div className="challenge__prizes">
                    {draft.challenge_prizes.map((label, rank) => (
                      <span key={rank} className="challenge__prize">
                        <span className={`challenge__rank challenge__rank--${rank + 1}`}>
                          {rank + 1}
                        </span>
                        <input
                          value={label}
                          placeholder={rank === 0 ? '1 000 € + trophée' : 'Dotation'}
                          aria-label={`Récompense du rang ${rank + 1}`}
                          onChange={(e) => setPrize(rank, e.target.value)}
                        />
                      </span>
                    ))}
                  </div>
                  <span className="challenge__note">
                    {prizeCount === 0
                      ? 'Aucune dotation saisie : le classement s’affichera sans prix.'
                      : `${prizeCount} rang${prizeCount > 1 ? 's' : ''} récompensé${
                          prizeCount > 1 ? 's' : ''
                        } — le coût ne suit pas la taille du réseau.`}
                  </span>
                </div>
              </div>

              {draft.challenge_metric === 'attainment' ? null : (
                <p className="challenge__flag">
                  Sur ce critère, le classement se joue en partie avant la campagne :{' '}
                  {draft.challenge_metric === 'pieces'
                    ? 'un magasin qui pèse la moitié du réseau garde son avance quel que soit l’effort des autres.'
                    : 'un magasin qui partait de très bas affiche une progression qu’un magasin déjà installé ne peut pas égaler.'}{' '}
                  Le taux d’atteinte compare chacun à sa propre cible.
                </p>
              )}

              {outOfRace.length > 0 ? (
                <p className="challenge__flag">
                  {outOfRace.map((shop) => shop.shop_name).join(', ')} —{' '}
                  {outOfRace.length > 1 ? 'objectifs à 0' : 'objectif à 0'} : rien à franchir, donc
                  hors classement. Posez-leur un objectif pour les faire entrer dans la course.
                </p>
              ) : null}

              {standings.length > 0 ? (
                <>
                  <h3 className="section-label">
                    Ligne de départ
                    <span className="section-label__aside">
                      Où chacun en est de son seuil, avec les ventes de la période analysée
                    </span>
                  </h3>
                  <div className="table-card">
                    <div className="table-scroll">
                      <table className="standings">
                        <thead>
                          <tr>
                            <th className="standings__rank">#</th>
                            <th>Magasin</th>
                            <th className="num">Réalisé</th>
                            <th className="num">Objectif</th>
                            <th className="num">Taux d’atteinte</th>
                            <th className="num">Seuil</th>
                            <th className="num">Barre</th>
                            <th className="num">Écart</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.map((entry, rank) => (
                            <tr key={entry.shop.shop_id}>
                              <td className="standings__rank">
                                <span
                                  className={`standings__medal${
                                    rank < prizeCount ? ` standings__medal--${rank + 1}` : ''
                                  }`}
                                >
                                  {rank + 1}
                                </span>
                              </td>
                              <td>
                                {entry.shop.shop_name}
                                {rank < prizeCount ? (
                                  <span className="standings__prize">
                                    {draft.challenge_prizes[rank]}
                                  </span>
                                ) : null}
                              </td>
                              <td className="num">{fr(entry.shop.total)}</td>
                              <td className="num">{fr(entry.objective)}</td>
                              <td className="num">
                                <strong>
                                  {entry.rate === null ? '—' : `${Math.round(entry.rate)} %`}
                                </strong>
                              </td>
                              <td className="num standings__trigger">
                                <span className="objectives__pct">
                                  <input
                                    value={draft.shop_triggers[entry.shop.shop_id] ?? ''}
                                    placeholder={draft.challenge_trigger_pct}
                                    inputMode="numeric"
                                    title="Vide : suit le seuil général"
                                    aria-label={`Seuil de ${entry.shop.shop_name}`}
                                    onChange={(e) => setTrigger(entry.shop.shop_id, e.target.value)}
                                  />
                                  %
                                </span>
                              </td>
                              <td className="num">{fr(entry.bar)}</td>
                              <td className="num">
                                {entry.qualified ? (
                                  <span className="standings__ok">franchie</span>
                                ) : (
                                  <span className="standings__gap">−{fr(entry.missing)}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="muted challenge__footnote">
                    La campagne n’a pas commencé : ce classement montre où mènent les objectifs et
                    les seuils que vous venez de poser. Corriger un objectif ici, c’est corriger le
                    classement — mieux vaut le voir maintenant qu’à l’arrivée.
                  </p>
                </>
              ) : null}
            </div>
          ) : null}

          {/* Le détail produit par produit reste accessible : c'est là que se
              règle la progression d'un produit en particulier, et que se lit
              le taux de pénétration. Replié, parce qu'on l'ouvre rarement. */}
          <button
            type="button"
            className="filter"
            aria-expanded={detailOpen}
            onClick={() => setDetailOpen(!detailOpen)}
          >
            {detailOpen ? 'Masquer le détail produit par produit' : 'Voir le détail produit par produit'}
          </button>

          {detailOpen ? (
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
                      <th className="objectives__corner">Produit</th>
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

                    <tr className="objectives__goals">
                      <td>Objectif (pièces)</td>
                      {sortedShops.map((shop) => (
                        <td key={shop.shop_id} className="num">
                          {fr(readInt(objectiveOf(shop.shop_id)))}
                        </td>
                      ))}
                      <td className="num">
                        <strong>{fr(objectivesTotal)}</strong>
                      </td>
                      {compare ? <td /> : null}
                      {compare ? <td /> : null}
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}
