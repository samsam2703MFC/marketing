import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatDate, formatEur, formatPeriod } from '../lib/useAsync'
import type { Granularity, LedgerPeriod, LedgerRow } from '../lib/api/module'
import LinkBadge from '../components/LinkBadge'
import { useLabel } from '../state/references'

const GRANULARITIES: Array<{ value: Granularity; label: string }> = [
  { value: 'month', label: 'Mois' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'year', label: 'Année' },
]

/**
 * Grand livre du fonds marketing.
 *
 * Entrées d'abord avec leur sous-total, sorties ensuite avec le leur, et un
 * solde courant qui cumule à travers les deux blocs — calculé côté serveur,
 * qui seul voit la séquence complète des périodes.
 */
export default function FundsView() {
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const { data, error, loading } = useAsync(
    () => api.getLedger(granularity, from || undefined, to || undefined),
    [granularity, from, to],
  )

  const periods = data?.periods ?? []

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <>
      <div className="filters">
        <div className="filters__row">
          {GRANULARITIES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={`filter${granularity === entry.value ? ' is-on' : ''}`}
              onClick={() => setGranularity(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="filters__row">
          <label className="field">
            Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            Au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="filter" onClick={() => setCollapsed(new Set())}>
            Tout déplier
          </button>
          <button
            type="button"
            className="filter"
            onClick={() => setCollapsed(new Set(periods.map((p) => p.period_key)))}
          >
            Tout replier
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Chargement…</p> : null}

      {data ? (
        <section className="card balance">
          <h2>Solde du fonds</h2>
          <p className="metric">{formatEur(data.closing_balance, 2)}</p>
        </section>
      ) : null}

      {periods.length === 0 && !loading ? (
        <p className="muted">Aucun mouvement sur cette période.</p>
      ) : null}

      {periods.map((period) => (
        <Period
          key={period.period_key}
          period={period}
          open={!collapsed.has(period.period_key)}
          onToggle={() => toggle(period.period_key)}
        />
      ))}
    </>
  )
}

function Period({
  period,
  open,
  onToggle,
}: {
  period: LedgerPeriod
  open: boolean
  onToggle: () => void
}) {
  return (
    <section className="card ledger">
      <button type="button" className="ledger__head" onClick={onToggle} aria-expanded={open}>
        <span className="ledger__key">{formatPeriod(period.period_key)}</span>
        <span className="ledger__totals">
          <span className="ledger__in">+ {formatEur(period.entries_total, 2)}</span>
          <span className="ledger__out">− {formatEur(period.exits_total, 2)}</span>
          <span className="ledger__balance">{formatEur(period.closing_balance, 2)}</span>
        </span>
      </button>

      {open ? (
        <div className="table-scroll">
          <table>
            <tbody>
              <Block rows={period.entries} label="Entrées" total={period.entries_total} sign="+" />
              <Block rows={period.exits} label="Sorties" total={period.exits_total} sign="−" />
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

function Block({
  rows,
  label,
  total,
  sign,
}: {
  rows: LedgerRow[]
  label: string
  total: number
  sign: '+' | '−'
}) {
  const sourceLabel = useLabel((refs) => refs.fundSources)

  if (rows.length === 0) return null

  return (
    <>
      <tr className="ledger__section">
        <th colSpan={4}>{label}</th>
      </tr>
      {rows.map((row) => (
        <tr key={row.id}>
          <td className="ledger__date">{formatDate(row.movement_date)}</td>
          <td>
            {/* Badge de rattachement : la ligne est liée à une campagne. */}
            {row.is_linked ? (
              <LinkBadge
                color={row.lever_color_hex ?? undefined}
                title={row.campaign_name ?? undefined}
              />
            ) : null}
            {row.label}
            {row.shop_name ? <span className="muted"> — {row.shop_name}</span> : null}
          </td>
          {/* Sans référentiel, cette colonne affichait « ROYALTY » tel quel. */}
          <td className="muted">{row.supplier_name ?? sourceLabel(row.source)}</td>
          <td className="num">{formatEur(row.amount, 2)}</td>
        </tr>
      ))}
      <tr className="ledger__total">
        <td colSpan={3}>Sous-total {label.toLowerCase()}</td>
        <td className="num">
          {sign} {formatEur(total, 2)}
        </td>
      </tr>
    </>
  )
}
