import { module as api } from '../lib/api'
import { useAsync, formatNumber } from '../lib/useAsync'
import { useLabel } from '../state/references'


/**
 * Présence locale : fiches plateformes et avis.
 *
 * La complétude d'une fiche et les avis sans réponse sont les deux seuls
 * chiffres sur lesquels une boutique peut agir le jour même — ils passent donc
 * devant la note moyenne, qui bouge lentement.
 */
export default function LocalPresenceView() {
  const { data, error, loading } = useAsync(() => api.getPresence(), [])
  const platformLabel = useLabel((refs) => refs.reviewPlatforms)

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data) return null

  const shops = data.shops
  const pending = shops.reduce((sum, shop) => sum + shop.pending_replies, 0)
  const rated = shops.filter((shop) => shop.rating_avg !== null)
  const avgRating =
    rated.length === 0
      ? null
      : rated.reduce((sum, shop) => sum + (shop.rating_avg ?? 0), 0) / rated.length

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Fiches suivies</h2>
          <p className="metric">{shops.length}</p>
        </section>
        <section className="card">
          <h2>Note moyenne</h2>
          <p className="metric">{avgRating === null ? '—' : avgRating.toFixed(1)}</p>
          <p className="muted">
            {formatNumber(shops.reduce((sum, shop) => sum + shop.reviews_count, 0))} avis cumulés
          </p>
        </section>
        <section className="card">
          <h2>Avis sans réponse</h2>
          <p className="metric">{pending}</p>
          <p className="muted">À traiter</p>
        </section>
      </div>

      <section className="card table-card">
        <h2>Fiches par boutique</h2>
        {shops.length === 0 ? (
          <p className="muted">Aucune fiche plateforme rattachée.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Boutique</th>
                  <th>Plateforme</th>
                  <th className="num">Note</th>
                  <th className="num">Avis</th>
                  <th>Complétude</th>
                  <th className="num">Sans réponse</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((shop) => (
                  <tr key={shop.id}>
                    <td>{shop.shop_name}</td>
                    <td className="muted">{platformLabel(shop.platform)}</td>
                    <td className="num">
                      {shop.rating_avg === null ? '—' : shop.rating_avg.toFixed(1)}
                    </td>
                    <td className="num">{formatNumber(shop.reviews_count)}</td>
                    <td>
                      <span className="progress progress--inline">
                        <span
                          className="progress__fill"
                          style={{ width: `${Math.round(shop.completeness_pct ?? 0)}%` }}
                        />
                      </span>
                      <span className="attainment">
                        {shop.completeness_pct === null
                          ? '—'
                          : `${Math.round(shop.completeness_pct)} %`}
                      </span>
                    </td>
                    <td className="num">{shop.pending_replies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card table-card">
        <h2>Derniers avis</h2>
        {data.reviews.length === 0 ? (
          <p className="muted">Aucun avis remonté.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <tbody>
                {data.reviews.map((review) => (
                  <tr key={review.id}>
                    <td className="ledger__date">{formatDateTime(review.published_at)}</td>
                    <td>
                      <strong>{'★'.repeat(review.rating ?? 0) || '—'}</strong>
                      <div>{review.body ?? <span className="muted">Sans commentaire</span>}</div>
                    </td>
                    <td className="muted">
                      {review.author_name ?? 'Anonyme'}
                      <div>{review.shop_name}</div>
                    </td>
                    <td className="muted">
                      {review.reply_status === 'pending' ? 'À répondre' : 'Répondu'}
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

/** `2026-07-20 10:00:00` → `20/07/2026`. La colonne est un DATETIME, pas une DATE. */
function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')

  return `${day}/${month}/${year}`
}
