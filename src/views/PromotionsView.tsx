import * as api from '../lib/api/module'
import { useAsync, formatDate } from '../lib/useAsync'
import type { CampaignOffer } from '../lib/api/module'
import LinkBadge from '../components/LinkBadge'
import { useLabel } from '../state/references'


export default function PromotionsView() {
  const { data, error, loading } = useAsync(() => api.listPromotions(), [])
  const offers = useAsync(() => api.listCampaignOffers(), [])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>

  return (
    <>
      {data?.length ? <CatalogTable promotions={data} /> : <EmptyCatalog />}
      {offers.error ? <p className="error">{offers.error}</p> : null}
      {offers.data?.length ? <OfferTable offers={offers.data} /> : null}
    </>
  )
}

/**
 * Promotions du catalogue.
 *
 * `mar_promotion` n'a aucune écriture dans le module : ces lignes viennent de
 * l'import produit de l'ERP, qui n'est pas encore branché. Le dire explicitement
 * évite de lire une table vide comme « le réseau n'a aucune promotion ».
 */
function EmptyCatalog() {
  return (
    <section className="card">
      <h2>Promotions du catalogue</h2>
      <p className="muted">
        Aucune promotion : cette table (<code>mar_promotion</code>) est alimentée par l’import
        produit de l’ERP, qui n’est pas encore raccordé. Les offres montées dans l’assistant de
        campagne apparaissent ci-dessous.
      </p>
    </section>
  )
}

function CatalogTable({ promotions }: { promotions: api.Promotion[] }) {
  const data = promotions
  const mechanicLabel = useLabel((refs) => refs.promotionMechanics)

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
                  {mechanicLabel(promotion.mechanic_type)}
                </td>
                <td>{promotion.value_label ?? '—'}</td>
                <td className="muted">{promotion.scope_label ?? '—'}</td>
                <td className="muted">{promotion.availability_label ?? '—'}</td>
                <td>
                  {promotion.campaign_name ? (
                    <>
                      {/* Même badge qu'au grand livre : la ligne est rattachée. */}
                      <LinkBadge title={promotion.campaign_name ?? undefined} />
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

/** `11:30:00` → `11:30`. */
function shortTime(value: string | null): string {
  return value ? value.slice(0, 5) : '—'
}

/** Offres montées dans l'assistant : même écran, source différente. */
function OfferTable({ offers }: { offers: CampaignOffer[] }) {
  return (
    <section className="card table-card">
      <h2>Offres de campagne</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Offre</th>
              <th>Mécanique</th>
              <th>Modèle</th>
              <th className="num">Éléments</th>
              <th>Fenêtre</th>
              <th>Campagne</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => (
              <tr key={offer.id}>
                <td>{offer.title}</td>
                <td className="muted">{offer.mechanic_text ?? '—'}</td>
                <td className="muted">{offer.template_label ?? '—'}</td>
                <td className="num">{offer.items_count}</td>
                <td className="muted">
                  {formatDate(offer.starts_on)} → {formatDate(offer.ends_on)}
                  <div>
                    {/* Aucune heure enregistrée signifie « sans contrainte
                        horaire », et non « de 00:00 à 23:59 ». */}
                    {offer.hour_from === null && offer.hour_to === null
                      ? 'Toute la journée'
                      : `${shortTime(offer.hour_from)} – ${shortTime(offer.hour_to)}`}
                  </div>
                </td>
                <td>
                  <LinkBadge title={offer.campaign_name} />
                  {offer.campaign_name}
                  <span
                    className="chip chip--inline"
                    style={{
                      color: offer.campaign_status_text_hex,
                      background: offer.campaign_status_bg_rgba,
                    }}
                  >
                    {offer.campaign_status_label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
