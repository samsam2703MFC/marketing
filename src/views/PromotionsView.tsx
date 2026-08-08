import * as api from '../lib/api/module'
import { useAsync } from '../lib/useAsync'

/**
 * Mécaniques promotionnelles.
 *
 * Le libellé du type de mécanique vient du code stocké : la table n'a pas de
 * référentiel pour ces cinq valeurs, contrairement aux statuts et aux leviers.
 * C'est la seule correspondance qui reste dans le front — à basculer en table
 * si le marketing doit un jour en ajouter.
 */
const MECHANICS: Record<string, string> = {
  PERCENT: 'Pourcentage',
  BUNDLE_FIXED: 'Prix de formule',
  BUY_X_GET_Y: 'Offre liée',
  CROSSED_PRICE: 'Prix barré',
  FREE_DELIVERY: 'Livraison offerte',
}

export default function PromotionsView() {
  const { data, error, loading } = useAsync(() => api.listPromotions(), [])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data?.length) return <p className="muted">Aucune promotion enregistrée.</p>

  return (
    <section className="card table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Promotion</th>
              <th>Mécanique</th>
              <th>Valeur</th>
              <th>Périmètre</th>
              <th>Disponibilité</th>
              <th>Campagne</th>
            </tr>
          </thead>
          <tbody>
            {data.map((promotion) => (
              <tr key={promotion.id}>
                <td>{promotion.name}</td>
                <td className="muted">
                  {MECHANICS[promotion.mechanic_type] ?? promotion.mechanic_type}
                </td>
                <td>{promotion.value_label ?? '—'}</td>
                <td className="muted">{promotion.scope_label ?? '—'}</td>
                <td className="muted">{promotion.availability_label ?? '—'}</td>
                <td>
                  {promotion.campaign_name ? (
                    <>
                      {/* Le badge ⛓ signale le rattachement, comme au grand livre. */}
                      <span className="link-badge">⛓</span>
                      {promotion.campaign_name}
                      {promotion.campaign_status_label ? (
                        <span
                          className="chip chip--inline"
                          style={{
                            color: promotion.campaign_status_text_hex ?? undefined,
                            background: promotion.campaign_status_bg_rgba ?? undefined,
                          }}
                        >
                          {promotion.campaign_status_label}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">Permanente</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
