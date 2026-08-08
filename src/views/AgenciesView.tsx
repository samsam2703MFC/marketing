import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatEur, formatNumber } from '../lib/useAsync'
import type { Agency } from '../lib/api/module'

/**
 * Agences & prestataires.
 *
 * `mar_agency` porte des colonnes dénormalisées (ROI moyen, taux de
 * transformation, nombre de campagnes) qui sont des saisies, pas des calculs.
 * L'API renvoie à côté le compte réellement observé sur les interventions.
 * L'écran affiche les deux : un écart entre le déclaré et le mesuré est une
 * information, la moyenne des deux n'en serait pas une.
 */
export default function AgenciesView() {
  const { data, error, loading } = useAsync(() => api.listAgencies(), [])
  const [openId, setOpenId] = useState<number | null>(null)

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data?.length) return <p className="muted">Aucune agence référencée.</p>

  const fees = data.reduce((sum, agency) => sum + agency.fees_total, 0)

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Prestataires</h2>
          <p className="metric">{data.length}</p>
        </section>
        <section className="card">
          <h2>Honoraires engagés</h2>
          <p className="metric">{formatEur(fees)}</p>
          <p className="muted">Sur interventions enregistrées</p>
        </section>
      </div>

      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Agence</th>
                <th>Levier</th>
                <th className="num">ROI déclaré</th>
                <th className="num">ROI mesuré</th>
                <th className="num">Transformation</th>
                <th className="num">Interventions</th>
                <th className="num">Honoraires</th>
              </tr>
            </thead>
            <tbody>
              {data.map((agency) => (
                <AgencyRow
                  key={agency.id}
                  agency={agency}
                  open={openId === agency.id}
                  onToggle={() => setOpenId(openId === agency.id ? null : agency.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function AgencyRow({
  agency,
  open,
  onToggle,
}: {
  agency: Agency
  open: boolean
  onToggle: () => void
}) {
  const interventions = useAsync(
    () => (open ? api.getAgencyInterventions(agency.id) : Promise.resolve([])),
    [open, agency.id],
  )

  // L'écart porte sur le nombre de campagnes : la colonne saisie face au compte
  // réel des interventions.
  const drift = agency.campaigns_count !== agency.interventions

  return (
    <>
      <tr className="row-link" onClick={onToggle} aria-expanded={open}>
        <td>
          {agency.name}
          {agency.speciality ? <div className="muted">{agency.speciality}</div> : null}
        </td>
        <td>
          {agency.lever_label ? (
            <span className="chip chip--lever">
              <span className="dot" style={{ background: agency.lever_color_hex ?? undefined }} />
              {agency.lever_label}
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="num">{formatNumber(agency.avg_roi)}</td>
        <td className="num">{formatNumber(agency.roi_measured)}</td>
        <td className="num">
          {agency.hit_rate_pct === null ? '—' : `${formatNumber(agency.hit_rate_pct)} %`}
        </td>
        <td className="num">
          {agency.interventions}
          {drift ? (
            <span className="muted" title={`${agency.campaigns_count} déclarée(s) en fiche`}>
              {' '}
              / {agency.campaigns_count}
            </span>
          ) : null}
        </td>
        <td className="num">{formatEur(agency.fees_total)}</td>
      </tr>

      {open ? (
        <tr>
          <td colSpan={7}>
            {interventions.error ? <p className="error">{interventions.error}</p> : null}
            {interventions.loading ? <p className="muted">Chargement…</p> : null}
            {interventions.data?.length === 0 && !interventions.loading ? (
              <p className="muted">Aucune intervention enregistrée pour cette agence.</p>
            ) : null}
            {interventions.data?.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Campagne</th>
                    <th>Canal</th>
                    <th className="num">Honoraires</th>
                    <th className="num">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {interventions.data.map((row) => (
                    <tr key={row.id}>
                      <td>{row.campaign_name}</td>
                      <td className="muted">{row.channel_label ?? '—'}</td>
                      <td className="num">
                        {row.fee_amount === null ? '—' : formatEur(row.fee_amount)}
                      </td>
                      <td className="num">{formatNumber(row.roi_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}
