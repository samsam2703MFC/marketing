import { useCallback, useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatEur, formatNumber } from '../lib/useAsync'
import { describeError } from '../state/auth'
import type { FunnelStep, Lead, LeadStatus } from '../lib/api/module'

interface MonitorProps {
  campaignId: number
  leadStatuses: LeadStatus[]
  onBack: () => void
}

/**
 * Suivi en direct d'une campagne : KPI, classement des boutiques, base CRM.
 */
export default function CampaignMonitorView({ campaignId, leadStatuses, onBack }: MonitorProps) {
  const campaign = useAsync(() => api.getCampaign(campaignId), [campaignId])
  const monitor = useAsync(() => api.getMonitor(campaignId), [campaignId])
  const [reloadKey, setReloadKey] = useState(0)
  const leads = useAsync(() => api.getLeads(campaignId), [campaignId, reloadKey])
  const [generating, setGenerating] = useState(false)
  const [generation, setGeneration] = useState<string | null>(null)

  /**
   * Relance la génération depuis le vivier.
   *
   * Rejouable : les comptes déjà rattachés sont écartés côté serveur. C'est ce
   * qui permet de relancer après un import complémentaire sans se demander si
   * on va appeler deux fois la même entreprise.
   */
  async function generate() {
    setGenerating(true)
    setGeneration(null)

    try {
      const report = await api.generateLeads(campaignId)
      setGeneration(
        report.reason ??
          `${report.created} lead(s) créé(s) sur ${report.shops} boutique(s)` +
            (report.skipped_existing > 0
              ? `, ${report.skipped_existing} déjà rattaché(s).`
              : '.'),
      )
      setReloadKey((current) => current + 1)
    } catch (cause: unknown) {
      setGeneration(describeError(cause))
    } finally {
      setGenerating(false)
    }
  }

  const refreshLeads = useCallback(() => setReloadKey((key) => key + 1), [])

  return (
    <>
      <button type="button" className="filter back" onClick={onBack}>
        ← Retour aux campagnes
      </button>

      {campaign.error ? <p className="error">{campaign.error}</p> : null}
      {campaign.data ? <h2 className="screen-subtitle">{String(campaign.data.name)}</h2> : null}

      {/* a. KPI et classement des boutiques */}
      <div className="grid">
        {(monitor.data?.kpis ?? []).map((kpi) => (
          <section key={kpi.kpi_code} className="card">
            <h2>{kpi.kpi_label ?? kpi.kpi_code}</h2>
            <p className="metric">
              {formatNumber(kpi.value)}
              {kpi.unit ? <span className="unit"> {kpi.unit}</span> : null}
            </p>
            {kpi.target_value !== null ? (
              <p className="muted">
                Cible {formatNumber(kpi.target_value)}
                {kpi.attainment_pct !== null ? (
                  <span
                    className="attainment"
                    // Vert au-dessus de la cible, ambre en dessous.
                    style={{ color: kpi.attainment_pct >= 100 ? '#3f7a52' : '#b26a00' }}
                  >
                    {' '}
                    {formatNumber(kpi.attainment_pct)} %
                  </span>
                ) : null}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      {monitor.data && monitor.data.shops.length > 0 ? (
        <section className="card table-card">
          <h2>Classement des boutiques</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Boutique</th>
                  <th className="num">Valeur</th>
                  <th className="num">Cible</th>
                  <th>Atteinte</th>
                </tr>
              </thead>
              <tbody>
                {monitor.data.shops.map((shop) => (
                  <tr key={`${shop.shop_id}-${shop.kpi_code}`}>
                    <td>{shop.shop_name}</td>
                    <td className="num">{formatNumber(shop.value)}</td>
                    <td className="num">{formatNumber(shop.target_value)}</td>
                    <td>
                      <div className="progress progress--inline">
                        <div
                          className="progress__fill"
                          style={{
                            width: `${Math.min(100, shop.attainment_pct ?? 0)}%`,
                            background: (shop.attainment_pct ?? 0) >= 100 ? '#3f7a52' : '#b26a00',
                          }}
                        />
                      </div>
                      <span className="muted">{formatNumber(shop.attainment_pct)} %</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* c. Base CRM — leads B2B */}
      <section className="card table-card">
        <div className="crm__head">
          <div>
            <h2>Base CRM — leads B2B à développer</h2>
            <p className="muted">
              Comptes rattachés à la campagne, distribués aux boutiques référentes.
            </p>
          </div>
          <Funnel steps={leads.data?.funnel ?? []} />
        </div>

        <div className="filters__row">
          <button type="button" className="filter" onClick={generate} disabled={generating}>
            {generating ? 'Génération…' : 'Générer depuis le vivier B2B'}
          </button>
          {generation ? <span className="muted">{generation}</span> : null}
        </div>

        {leads.error ? <p className="error">{leads.error}</p> : null}

        {leads.data && leads.data.leads.length === 0 ? (
          <p className="muted">Aucun lead sur cette campagne.</p>
        ) : (
          <div className="table-scroll">
            <table className="leads">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Secteur</th>
                  <th>Boutique référente</th>
                  <th>Contact</th>
                  <th className="num">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(leads.data?.leads ?? []).map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    statuses={leadStatuses}
                    onChanged={refreshLeads}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

/** Entonnoir : une pilule par état, `n · libellé`, aux couleurs de l'état. */
function Funnel({ steps }: { steps: FunnelStep[] }) {
  return (
    <ul className="chips funnel">
      {steps.map((step) => (
        <li
          key={step.status_code}
          className="chip"
          style={{ color: step.color_hex, background: step.bg_hex, border: `1px solid ${step.border_hex}` }}
        >
          {step.leads_count} · {step.status_label}
        </li>
      ))}
    </ul>
  )
}

function LeadRow({
  lead,
  statuses,
  onChanged,
}: {
  lead: Lead
  statuses: LeadStatus[]
  onChanged: () => void
}) {
  // Surcharge locale : la pilule et l'entonnoir doivent réagir immédiatement,
  // sans attendre l'aller-retour serveur.
  const [status, setStatus] = useState(lead.status_code)
  const [error, setError] = useState<string | null>(null)
  const current = statuses.find((entry) => entry.code === status)

  async function change(next: string) {
    const previous = status
    setStatus(next)
    setError(null)

    try {
      await api.setLeadStatus(lead.id, next)
      onChanged()
    } catch (cause) {
      // L'écriture a échoué : on revient à l'état réel plutôt que d'afficher
      // un changement qui n'existe pas côté serveur.
      setStatus(previous)
      setError(describeError(cause))
    }
  }

  return (
    <tr>
      <td>
        <div className="lead">
          <span className="lead__initials">{lead.initials}</span>
          <div>
            <div className="lead__name">{lead.company_name}</div>
            {lead.potential_amount !== null ? (
              <div className="muted lead__potential">{formatEur(lead.potential_amount)} estimés</div>
            ) : null}
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </td>
      <td className="muted">{lead.sector_label ?? '—'}</td>
      <td>{lead.shop_name ?? '—'}</td>
      <td className="muted">{lead.contact_name ?? lead.contact_email ?? '—'}</td>
      <td className="num">
        <select
          className="status-select"
          aria-label={`Statut de ${lead.company_name}`}
          value={status}
          onChange={(event) => void change(event.target.value)}
          style={
            current
              ? {
                  color: current.color_hex,
                  background: current.bg_hex,
                  borderColor: current.border_hex,
                }
              : undefined
          }
        >
          {statuses.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>
      </td>
    </tr>
  )
}
