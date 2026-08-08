import { module as api } from '../lib/api'
import { useAsync, formatEur, formatNumber } from '../lib/useAsync'
import type { CampaignStatus, Lever } from '../lib/api/module'

interface DashboardProps {
  statuses: CampaignStatus[]
  levers: Lever[]
  brandId: number | 'all'
  onOpen: (campaignId: number) => void
}

/** Vue d'entrée : volumétrie des campagnes, budget engagé, performance par levier. */
export default function DashboardView({ statuses, levers, brandId, onOpen }: DashboardProps) {
  const campaigns = useAsync(
    () => api.listCampaigns(brandId === 'all' ? {} : { brand_id: brandId }),
    [brandId],
  )
  const leverPerf = useAsync(() => api.getLeverSummary(), [])

  const rows = campaigns.data ?? []
  // Le budget exclut les brouillons. L'assistant enregistre à chaque étape,
  // pour qu'une campagne interrompue se reprenne : compter le budget d'une
  // campagne qu'on n'a pas fini d'écrire annoncerait un engagement que
  // personne n'a pris.
  const engaged = rows.filter((c) => c.status_code !== 'draft')
  const budget = engaged.reduce((sum, c) => sum + c.budget_amount, 0)
  const spent = engaged.reduce((sum, c) => sum + c.spent_amount, 0)
  const drafts = rows.length - engaged.length
  const live = rows.filter((c) => c.status_code === 'live')

  return (
    <>
      {campaigns.error ? <p className="error">{campaigns.error}</p> : null}

      <div className="grid">
        <section className="card">
          <h2>Campagnes</h2>
          <p className="metric">{rows.length}</p>
          <ul className="chips">
            {statuses.map((status) => (
              <li
                key={status.code}
                className="chip"
                style={{ color: status.text_hex, background: status.bg_rgba }}
              >
                {rows.filter((c) => c.status_code === status.code).length} · {status.label}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Budget alloué</h2>
          <p className="metric">{formatEur(budget)}</p>
          <p className="muted">
            {formatEur(spent)} engagés
            {drafts > 0
              ? ` · ${drafts} brouillon${drafts > 1 ? 's' : ''} non compté${drafts > 1 ? 's' : ''}`
              : ''}
          </p>
        </section>

        <section className="card">
          <h2>Leviers</h2>
          <ul className="chips">
            {levers.map((lever) => (
              <li key={lever.code} className="chip chip--lever">
                <span className="dot" style={{ background: lever.color_hex }} />
                {lever.label}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card table-card">
        <h2>Campagnes en cours</h2>
        {live.length === 0 ? (
          <p className="muted">Aucune campagne en cours.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campagne</th>
                  <th>Périmètre</th>
                  <th className="num">Boutiques</th>
                  <th className="num">Budget</th>
                  <th className="num">Engagé</th>
                </tr>
              </thead>
              <tbody>
                {live.map((campaign) => (
                  <tr key={campaign.id} className="row-link" onClick={() => onOpen(campaign.id)}>
                    <td>{campaign.name}</td>
                    <td>{campaign.scope === 'RESEAU' ? 'Réseau' : 'Locale'}</td>
                    <td className="num">{campaign.shops_count}</td>
                    <td className="num">{formatEur(campaign.budget_amount)}</td>
                    <td className="num">{formatEur(campaign.spent_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {leverPerf.data && leverPerf.data.some((l) => l.spent_amount > 0) ? (
        <section className="card table-card">
          <h2>Performance par levier</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Levier</th>
                  <th className="num">Dépense</th>
                  <th className="num">Ventes générées</th>
                  <th className="num">ROI</th>
                  <th className="num">Pénétration CA</th>
                </tr>
              </thead>
              <tbody>
                {leverPerf.data
                  .filter((lever) => lever.spent_amount > 0)
                  .map((lever) => (
                    <tr key={lever.lever_code}>
                      <td>
                        <span className="dot" style={{ background: lever.color_hex }} /> {lever.lever_label}
                      </td>
                      <td className="num">{formatEur(lever.spent_amount)}</td>
                      <td className="num">{formatEur(lever.actual_value)}</td>
                      <td className="num">{formatNumber(lever.roi_value)}</td>
                      <td className="num">
                        {lever.penetration_pct !== null ? `${formatNumber(lever.penetration_pct)} %` : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  )
}
