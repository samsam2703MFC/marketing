import { useEffect, useState } from 'react'
import { module as api } from '../lib/api'
import { describeError } from '../state/auth'
import type { Campaign, References } from '../lib/api/module'

interface OverviewData {
  references: References
  campaigns: Campaign[]
}

/**
 * Vue Réseau.
 *
 * Rien n'est écrit en dur : les libellés de statut, leurs couleurs et les
 * leviers viennent tous de `/references`. Un statut ajouté en base apparaît ici
 * sans toucher au front.
 */
export default function NetworkOverview() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    Promise.all([api.getReferences(), api.listCampaigns()])
      .then(([references, campaigns]) => {
        if (!controller.signal.aborted) setData({ references, campaigns })
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(describeError(cause))
      })

    return () => controller.abort()
  }, [])

  if (error) return <p className="error">Chargement impossible : {error}</p>
  if (!data) return <p className="muted">Chargement du module marketing…</p>

  const { campaigns, references } = data
  const totalBudget = campaigns.reduce((sum, c) => sum + c.budget_amount, 0)
  const totalSpent  = campaigns.reduce((sum, c) => sum + c.spent_amount, 0)

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Campagnes</h2>
          <p className="metric">{campaigns.length}</p>
          <ul className="chips">
            {references.campaignStatuses.map((status) => {
              const count = campaigns.filter((c) => c.status_code === status.code).length
              return (
                <li
                  key={status.code}
                  className="chip"
                  style={{ color: status.text_hex, background: status.bg_rgba }}
                >
                  {count} · {status.label}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="card">
          <h2>Budget réseau</h2>
          <p className="metric">{formatEur(totalBudget)}</p>
          <p className="muted">{formatEur(totalSpent)} engagés</p>
        </section>

        <section className="card">
          <h2>Leviers</h2>
          <ul className="chips">
            {references.levers.map((lever) => (
              <li key={lever.code} className="chip chip--lever">
                <span className="dot" style={{ background: lever.color_hex }} />
                {lever.label}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card table-card">
        <h2>Campagnes du réseau</h2>
        {campaigns.length === 0 ? (
          <p className="muted">Aucune campagne enregistrée.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campagne</th>
                  <th>Périmètre</th>
                  <th>Type</th>
                  <th>Fenêtre</th>
                  <th className="num">Boutiques</th>
                  <th className="num">Budget</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{campaign.name}</td>
                    <td>{campaign.scope === 'RESEAU' ? 'Réseau' : 'Locale'}</td>
                    <td>{campaign.type_label ?? '—'}</td>
                    <td>{formatWindow(campaign.starts_on, campaign.ends_on)}</td>
                    <td className="num">{campaign.shops_count}</td>
                    <td className="num">{formatEur(campaign.budget_amount)}</td>
                    <td>
                      <span
                        className="chip"
                        style={{ color: campaign.status_text_hex, background: campaign.status_bg_rgba }}
                      >
                        {campaign.status_label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function formatEur(amount: number): string {
  return amount.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  })
}

function formatWindow(from: string | null, to: string | null): string {
  if (!from) return '—'
  const short = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')

  return to ? `${short(from)} → ${short(to)}` : short(from)
}
