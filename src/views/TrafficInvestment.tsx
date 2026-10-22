import { useState } from 'react'
import { module as api } from '../lib/api'
import type { Shop, StoreMonth } from '../lib/api/module'
import { useAsync, formatEur } from '../lib/useAsync'

/**
 * Trafic, panier moyen, et ce qu'il faudrait investir pour vendre plus.
 *
 * Tout part du P&L mensuel du panel, la lecture que le cockpit tient pour son
 * tableau des magasins et son levier Trafic : CA, tickets et panier moyen par
 * mois. Le trafic s'y compte comme au cockpit, en clients par jour du mois. Le
 * calcul de l'investissement se lit d'un trait — objectif ÷ panier moyen =
 * clients en plus ; × coût par client gagné = investissement. Ce coût n'est pas
 * encore mesuré (aucune campagne n'a de ventes rattachées) : il se saisit, et le
 * calcul le dit.
 */

/** Teintes des boutiques, dans un ordre fixe validé (daltonisme, contraste) : jamais réattribuées. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** Le panier moyen, le trafic et le CA de référence se lisent sur les derniers mois clos. */
const MOIS_REFERENCE = 3

/** Un mois d'une boutique, prêt à lire. */
interface Point {
  ca: number
  tickets: number
  /** Jours du mois : le cockpit compte le trafic ainsi, les magasins ouvrant 7 jours sur 7. */
  days: number
  basket: number
}

interface ShopSales {
  shop: Shop
  /** Mois clos → ventes ; le mois d'ouverture, partiel, n'y est pas. */
  points: Map<string, Point>
}

/** Le numéro de caisse et de panel d'une boutique : son code `erp-N`. */
function erpId(shop: Shop): number | null {
  const match = /^erp-(\d+)$/.exec(shop.code)

  return match ? Number(match[1]) : null
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`
const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number)

  return `${MOIS[m - 1]} ${String(y).slice(2)}`
}
const daysIn = (key: string) => {
  const [y, m] = key.split('-').map(Number)

  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
const fmt = (n: number, digits = 0) => n.toLocaleString('fr-BE', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Les douze derniers mois clos, du plus ancien au plus récent. */
function closedMonths(today: Date): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 12 + i, 1))

    return monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1)
  })
}

/**
 * Les mois vendus d'une boutique. Le premier mois n'est pas gardé quand il ouvre la
 * boutique (il ne tombe pas au début de la fenêtre lue) : partiel, il ne se compare
 * pas — la règle du cockpit.
 */
function shopPoints(cells: StoreMonth[], windowStart: string, current: string): Map<string, Point> {
  const sold = cells
    .filter((c) => (c.ca ?? 0) > 0 && (c.tickets ?? 0) > 0)
    .map((c) => ({ key: monthKey(c.annee, c.mois), ca: c.ca as number, tickets: c.tickets as number, panier: c.panierMoyen }))
    .sort((p, q) => p.key.localeCompare(q.key))
  const opening = sold.length && sold[0].key !== windowStart ? sold[0].key : null

  return new Map(
    sold
      .filter((p) => p.key < current && p.key !== opening)
      .map((p) => [p.key, { ca: p.ca, tickets: p.tickets, days: daysIn(p.key), basket: p.panier ?? p.ca / p.tickets }]),
  )
}

/** Lit un réglage gardé dans ce navigateur ; sans stockage, la page marche quand même. */
function stored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // stockage indisponible : la valeur vit le temps de la page
  }
}

export default function TrafficInvestment() {
  const [goal, setGoal] = useState(() => stored('mk.dash.objectif') || '5000')
  const [cpa, setCpa] = useState(() => stored('mk.dash.cout-client'))
  const [hover, setHover] = useState<number | null>(null)

  const today = new Date()
  const year = today.getUTCFullYear()
  const current = monthKey(year, today.getUTCMonth() + 1)
  const months = closedMonths(today)

  // Les boutiques du périmètre (le serveur filtre) et les mois du panel, lus de front ;
  // seules les boutiques du périmètre sont gardées.
  const sales = useAsync(async () => {
    const [shops, cells] = await Promise.all([api.listShops(), api.getStoreMonths([year - 1, year])])

    return shops.map((shop): ShopSales => {
      const id = erpId(shop)
      const own = id === null ? [] : cells.filter((c) => c.storeId === String(id))

      return { shop, points: shopPoints(own, monthKey(year - 1, 1), current) }
    })
  }, [year, current])

  // Ce que le fonds marketing sort aujourd'hui : la moyenne des trois derniers mois clos.
  const ledger = useAsync(() => api.getLedger('month'), [])

  const rows = (sales.data ?? []).filter((r) => r.points.size > 0)
  const silent = (sales.data ?? []).filter((r) => r.points.size === 0)

  const goalValue = Number(goal.replace(',', '.'))
  const cpaValue = cpa.trim() === '' ? null : Number(cpa.replace(',', '.'))
  const goalOk = Number.isFinite(goalValue) && goalValue > 0
  const cpaOk = cpaValue !== null && Number.isFinite(cpaValue) && cpaValue >= 0

  const stats = rows.map((r, i) => {
    const recent = [...r.points.entries()].sort(([p], [q]) => p.localeCompare(q)).slice(-MOIS_REFERENCE)
    const ca = recent.reduce((s, [, p]) => s + p.ca, 0)
    const tickets = recent.reduce((s, [, p]) => s + p.tickets, 0)
    const days = recent.reduce((s, [, p]) => s + p.days, 0)
    const basket = tickets > 0 ? ca / tickets : null
    const extraClients = basket !== null && goalOk ? goalValue / basket : null

    return {
      ...r,
      color: SERIES[i % SERIES.length],
      from: recent[0]?.[0] ?? null,
      to: recent[recent.length - 1]?.[0] ?? null,
      basket,
      monthlyCa: recent.length ? ca / recent.length : null,
      perDay: days > 0 ? tickets / days : null,
      extraClients,
      extraPerDay: extraClients !== null && days > 0 ? extraClients / (days / recent.length) : null,
      invest: extraClients !== null && cpaOk ? extraClients * (cpaValue as number) : null,
    }
  })
  const periods = [...new Set(stats.map((r) => (r.from && r.to ? `${monthLabel(r.from)} – ${monthLabel(r.to)}` : '')))].filter(Boolean)

  const exits = (ledger.data?.periods ?? []).filter((p) => p.period_key < new Date().toISOString().slice(0, 7)).slice(-3)
  const currentSpend = exits.length ? exits.reduce((s, p) => s + p.exits_total, 0) / exits.length : null

  // --- le graphique : une ligne par boutique, clients par jour ouvert ---------
  const W = 720
  const H = 240
  const pad = { l: 44, r: 12, t: 12, b: 28 }
  const at = (r: ShopSales, key: string) => {
    const p = r.points.get(key)

    return p ? p.tickets / p.days : null
  }
  const values = rows.flatMap((r) => months.map((m) => at(r, m) ?? 0))
  // Des graduations rondes : un pas de 1, 2, 2,5 ou 5 × 10ⁿ, quatre au plus.
  const peak = Math.max(10, ...values) * 1.05
  const step = [1, 2, 2.5, 5, 10].map((f) => f * 10 ** Math.floor(Math.log10(peak / 4))).find((v) => v * 4 >= peak) ?? peak / 4
  const top = Math.ceil(peak / step) * step
  const x = (i: number) => pad.l + (months.length > 1 ? (i / (months.length - 1)) * (W - pad.l - pad.r) : 0)
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)

  const totalExtra = stats.reduce((s, r) => s + (r.extraClients ?? 0), 0)
  const totalInvest = stats.every((r) => r.invest !== null) ? stats.reduce((s, r) => s + (r.invest ?? 0), 0) : null

  return (
    <section className="card traffic">
      <header className="traffic__head">
        <div>
          <h2>Trafic clients et panier moyen</h2>
          <p className="muted">Clients (tickets) par jour, douze derniers mois clos, P&amp;L mensuel du panel — une ligne par magasin.</p>
        </div>
      </header>

      {sales.loading ? <p className="muted">Lecture des ventes mensuelles de chaque magasin…</p> : null}
      {sales.error ? <p className="error">Ventes indisponibles : {sales.error}</p> : null}
      {silent.length ? (
        <p className="muted traffic__method">
          Sans vente au panel sur {year - 1}–{year}, donc hors graphique et hors calcul : {silent.map((r) => r.shop.name).join(', ')}.
        </p>
      ) : null}

      {rows.length ? (
        <>
          <ul className="traffic__legend">
            {stats.map((r) => (
              <li key={r.shop.id}>
                <span className="traffic__swatch" style={{ background: r.color }} />
                {r.shop.name}
              </li>
            ))}
          </ul>

          <div className="traffic__chart">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Clients par jour ouvert, mois par mois, par magasin">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="traffic__grid" />
                  <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="traffic__axis">
                    {fmt(t)}
                  </text>
                </g>
              ))}
              {months.map((m, i) =>
                i % 2 === months.length % 2 || months.length <= 6 ? (
                  <text key={m} x={x(i)} y={H - 8} textAnchor="middle" className="traffic__axis">
                    {monthLabel(m)}
                  </text>
                ) : null,
              )}
              {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="traffic__cross" /> : null}
              {stats.map((r) => {
                const pts = months
                  .map((m, i) => {
                    const v = at(r, m)

                    return v === null ? null : `${x(i)},${y(v)}`
                  })
                  .filter((p): p is string => p !== null)

                return <polyline key={r.shop.id} points={pts.join(' ')} fill="none" stroke={r.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              })}
              {hover !== null
                ? stats.map((r) => {
                    const v = at(r, months[hover])

                    return v === null ? null : <circle key={r.shop.id} cx={x(hover)} cy={y(v)} r={4.5} fill={r.color} stroke="#fff" strokeWidth={2} />
                  })
                : null}
              {months.map((m, i) => (
                <rect
                  key={m}
                  x={x(i) - (W - pad.l - pad.r) / Math.max(1, months.length - 1) / 2}
                  y={pad.t}
                  width={(W - pad.l - pad.r) / Math.max(1, months.length - 1)}
                  height={H - pad.t - pad.b}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </svg>
            {hover !== null ? (
              // L'infobulle se pose du côté libre de la ligne de survol.
              <div
                className="traffic__tip"
                style={x(hover) > W / 2 ? { right: `calc(${(1 - x(hover) / W) * 100}% + 10px)` } : { left: `calc(${(x(hover) / W) * 100}% + 10px)` }}
              >
                <b>{monthLabel(months[hover])}</b>
                {stats.map((r) => {
                  const p = r.points.get(months[hover])

                  return (
                    <span key={r.shop.id}>
                      <i style={{ background: r.color }} />
                      {r.shop.name.replace(/^Atelier by\s*-?\s*/i, '')} : {p ? `${fmt(p.tickets / p.days)} clients/jour · panier ${fmt(p.basket, 2)} €` : '—'}
                    </span>
                  )
                })}
              </div>
            ) : null}
          </div>

          <div className="traffic__goal">
            <h3>Combien investir pour vendre plus</h3>
            <div className="traffic__inputs">
              <label className="field">
                Objectif : + CA par mois et par magasin
                <input
                  value={goal}
                  inputMode="decimal"
                  onChange={(e) => {
                    setGoal(e.target.value)
                    store('mk.dash.objectif', e.target.value)
                  }}
                />
                €
              </label>
              <label className="field">
                Coût par client gagné
                <input
                  value={cpa}
                  inputMode="decimal"
                  placeholder="à saisir"
                  onChange={(e) => {
                    setCpa(e.target.value)
                    store('mk.dash.cout-client', e.target.value)
                  }}
                />
                €
              </label>
            </div>
            <p className="muted traffic__method">
              Clients / jour, panier moyen et CA se lisent sur les {MOIS_REFERENCE} derniers mois clos
              {periods.length === 1 ? ` (${periods[0]})` : ''}. Clients en plus = objectif ÷ panier moyen ; investissement =
              clients en plus × coût par client gagné. Ce coût n’est mesuré sur aucune campagne aujourd’hui (aucune n’a de ventes rattachées) :
              saisissez celui que vous retenez{currentSpend !== null ? ` — pour repère, le fonds marketing sort en moyenne ${formatEur(currentSpend)} par mois (3 derniers mois)` : ''}.
            </p>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Magasin</th>
                    <th className="num">Clients / jour</th>
                    <th className="num">Panier moyen</th>
                    <th className="num">CA / mois</th>
                    <th className="num">Clients en plus / mois</th>
                    <th className="num">soit / jour</th>
                    <th className="num">Investissement / mois</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((r) => (
                    <tr key={r.shop.id}>
                      <td>
                        <span className="traffic__swatch" style={{ background: r.color }} /> {r.shop.name}
                      </td>
                      <td className="num">{r.perDay !== null ? fmt(r.perDay) : '—'}</td>
                      <td className="num">{r.basket !== null ? `${fmt(r.basket, 2)} €` : '—'}</td>
                      <td className="num">{r.monthlyCa !== null ? formatEur(r.monthlyCa) : '—'}</td>
                      <td className="num">{r.extraClients !== null ? fmt(r.extraClients) : '—'}</td>
                      <td className="num">{r.extraPerDay !== null ? fmt(r.extraPerDay, 1) : '—'}</td>
                      <td className="num">
                        <b>{r.invest !== null ? formatEur(r.invest) : '—'}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {stats.length > 1 ? (
                  <tfoot>
                    <tr>
                      <td>Réseau ({stats.length} magasins)</td>
                      <td className="num" />
                      <td className="num" />
                      <td className="num" />
                      <td className="num">{goalOk ? fmt(totalExtra) : '—'}</td>
                      <td className="num" />
                      <td className="num">
                        <b>{totalInvest !== null ? formatEur(totalInvest) : '—'}</b>
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            {!cpaOk ? <p className="muted">Saisissez le coût par client gagné pour obtenir l’investissement.</p> : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
