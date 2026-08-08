import { module as api } from '../lib/api'
import { useAsync, formatEur, formatNumber } from '../lib/useAsync'
import ProspectImport from '../components/ProspectImport'

/**
 * Fidélité & CRM.
 *
 * Les segments RFM existent en base mais leur règle de calcul (`rule_json`)
 * n'est pas écrite : l'appartenance n'est donc peuplée par personne et les
 * effectifs restent à zéro. L'écran le dit au lieu d'afficher un tableau vide
 * qu'on prendrait pour une base sans clients.
 */
export default function CrmView() {
  const { data, error, loading } = useAsync(() => api.getCrm(), [])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data) return null

  const { summary, segments } = data
  const segmented = segments.reduce((sum, segment) => sum + segment.customers_count, 0)
  const optInPct = summary.customers === 0 ? null : (summary.opted_in / summary.customers) * 100

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Clients</h2>
          <p className="metric">{formatNumber(summary.customers)}</p>
          <p className="muted">Dans votre périmètre</p>
        </section>
        <section className="card">
          <h2>Consentement marketing</h2>
          <p className="metric">{optInPct === null ? '—' : `${Math.round(optInPct)} %`}</p>
          <p className="muted">{formatNumber(summary.opted_in)} clients contactables</p>
        </section>
        <section className="card">
          <h2>Chiffre d'affaires client</h2>
          <p className="metric">{formatEur(summary.total_spent)}</p>
          <p className="muted">{formatNumber(summary.avg_orders)} commandes en moyenne</p>
        </section>
      </div>

      <section className="card table-card">
        <h2>Segments RFM</h2>
        {segments.length === 0 ? (
          <p className="muted">Aucun segment défini.</p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th className="num">Clients</th>
                    <th className="num">Part</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((segment) => (
                    <tr key={segment.id}>
                      <td>
                        <span className="chip chip--lever">
                          <span
                            className="dot"
                            style={{ background: segment.color_hex ?? undefined }}
                          />
                          {segment.label}
                        </span>
                      </td>
                      <td className="num">{formatNumber(segment.customers_count)}</td>
                      <td className="num">
                        {segmented === 0
                          ? '—'
                          : `${Math.round((segment.customers_count / segmented) * 100)} %`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {segmented === 0 ? (
              <p className="muted">
                Les segments sont déclarés mais leur règle de calcul n’est pas encore écrite :
                l’appartenance (<code>mar_crm_customer_segment</code>) n’est peuplée par aucun
                traitement, d’où des effectifs à zéro.
              </p>
            ) : null}
          </>
        )}
      </section>

      <ProspectImport />
    </>
  )
}
