import { module as api } from '../lib/api'
import { useAsync, formatEur, formatNumber } from '../lib/useAsync'
import CostTable from '../components/CostTable'

/**
 * Marketing Analyse : dépense, valeur générée et ROI par levier.
 *
 * Les barres sont relatives à la dépense la plus forte, pas à un maximum
 * arbitraire : c'est une comparaison entre leviers, pas une progression vers
 * une cible.
 */
export default function AnalysisView() {
  const { data, error, loading } = useAsync(() => api.getAnalysis(), [])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data) return null

  const levers = data.levers
  const spent = levers.reduce((sum, lever) => sum + lever.spent_amount, 0)
  const generated = levers.reduce((sum, lever) => sum + lever.actual_value, 0)
  const maxSpent = levers.reduce((max, lever) => Math.max(max, lever.spent_amount), 0)

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Dépense mesurée</h2>
          <p className="metric">{formatEur(spent)}</p>
          <p className="muted">Sorties du fonds rattachées à un levier</p>
        </section>
        <section className="card">
          <h2>Valeur générée</h2>
          <p className="metric">{formatEur(generated)}</p>
          <p className="muted">Objectifs de levier réalisés</p>
        </section>
        <section className="card">
          <h2>ROI global</h2>
          <p className="metric">{spent === 0 ? '—' : formatNumber(generated / spent)}</p>
          <p className="muted">Valeur générée / dépense</p>
        </section>
      </div>

      <section className="card table-card">
        <h2>Performance par levier</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Levier</th>
                <th className="num">Dépense</th>
                <th className="num">Objectif</th>
                <th className="num">Réalisé</th>
                <th className="num">ROI</th>
                <th>Poids</th>
              </tr>
            </thead>
            <tbody>
              {levers.map((lever) => (
                <tr key={lever.lever_id}>
                  <td>
                    <span className="chip chip--lever">
                      <span className="dot" style={{ background: lever.color_hex }} />
                      {lever.lever_label}
                    </span>
                  </td>
                  <td className="num">{formatEur(lever.spent_amount)}</td>
                  <td className="num">{formatEur(lever.target_value)}</td>
                  <td className="num">{formatEur(lever.actual_value)}</td>
                  <td className="num">{formatNumber(lever.roi_value)}</td>
                  <td>
                    <span className="progress progress--inline">
                      <span
                        className="progress__fill"
                        style={{
                          width:
                            maxSpent === 0
                              ? '0%'
                              : `${Math.round((lever.spent_amount / maxSpent) * 100)}%`,
                          background: lever.color_hex,
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CostTable costs={data.costs} />
    </>
  )
}
