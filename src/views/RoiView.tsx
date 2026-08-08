import { module as api } from '../lib/api'
import { useAsync, formatEur, formatPeriod } from '../lib/useAsync'
import CostTable from '../components/CostTable'

/**
 * ROI & rentabilité : coût pour +1 000 € de chiffre d'affaires, par trimestre.
 *
 * Le sens de lecture est inversé par rapport à l'habitude : ici une flèche vers
 * le bas est une bonne nouvelle — le même euro de chiffre coûte moins cher à
 * générer. Le serveur le dit explicitement (`is_improvement`) plutôt que de
 * laisser l'écran deviner à partir du signe.
 */
export default function RoiView() {
  const { data, error, loading } = useAsync(() => api.getRoi(), [])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data) return null

  const quarters = data.quarterly
  const latest = quarters[quarters.length - 1]
  const cost = quarters.reduce((sum, quarter) => sum + quarter.total_cost_amount, 0)
  const revenue = quarters.reduce((sum, quarter) => sum + quarter.generated_revenue, 0)

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Coût marketing</h2>
          <p className="metric">{formatEur(cost)}</p>
          <p className="muted">Tous postes, tous trimestres</p>
        </section>
        <section className="card">
          <h2>CA généré</h2>
          <p className="metric">{formatEur(revenue)}</p>
        </section>
        <section className="card">
          <h2>Coût pour 1 000 € de CA</h2>
          <p className="metric">
            {latest?.cost_per_1000_revenue == null
              ? '—'
              : formatEur(latest.cost_per_1000_revenue, 2)}
          </p>
          <p className="muted">
            {latest ? `Dernier trimestre — ${formatPeriod(latest.period_label)}` : 'Aucun trimestre'}
          </p>
        </section>
      </div>

      <section className="card table-card">
        <h2>Par trimestre</h2>
        {quarters.length === 0 ? (
          <p className="muted">
            Aucun coût saisi : le ratio se calcule sur <code>mar_roi_cost</code>.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Trimestre</th>
                  <th className="num">Coût</th>
                  <th className="num">CA généré</th>
                  <th className="num">Coût / 1 000 €</th>
                  <th>Évolution</th>
                </tr>
              </thead>
              <tbody>
                {quarters.map((quarter) => (
                  <tr key={quarter.period_label}>
                    <td>{formatPeriod(quarter.period_label)}</td>
                    <td className="num">{formatEur(quarter.total_cost_amount)}</td>
                    <td className="num">{formatEur(quarter.generated_revenue)}</td>
                    <td className="num">
                      {quarter.cost_per_1000_revenue == null
                        ? '—'
                        : formatEur(quarter.cost_per_1000_revenue, 2)}
                    </td>
                    <td>
                      <Trend
                        trend={quarter.trend}
                        isImprovement={quarter.is_improvement}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CostTable costs={data.costs} />
    </>
  )
}

function Trend({
  trend,
  isImprovement,
}: {
  trend: 'up' | 'down' | 'flat' | null
  isImprovement: boolean | null
}) {
  if (trend === null) return <span className="muted">—</span>
  if (trend === 'flat') return <span className="muted">▬ stable</span>

  // Le vert suit l'amélioration, pas la direction de la flèche.
  const color = isImprovement ? '#3f7a52' : '#8D1D2C'

  return (
    <span style={{ color, fontWeight: 600 }}>
      {trend === 'down' ? '▼' : '▲'} {isImprovement ? 'amélioration' : 'dégradation'}
    </span>
  )
}
