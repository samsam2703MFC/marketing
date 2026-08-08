import * as api from '../lib/api/module'
import { useAsync, formatEur } from '../lib/useAsync'

/** Libellés des canaux de diffusion d'un bon. */
const CHANNELS: Record<string, string> = {
  WS: 'Web shop',
  POS: 'Caisse',
  OFF: 'Office',
  B2B: 'B2B',
}

/**
 * Bons et codes.
 *
 * Le compteur d'utilisations est cloisonné au périmètre de l'appelant : un
 * franchisé voit les utilisations de ses boutiques, pas celles du réseau. Ce
 * n'est pas cosmétique — c'est le même chiffre qui alimente le ROI.
 */
export default function VouchersView() {
  const { data, error, loading } = useAsync(() => api.listVouchers(), [])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data?.length) return <p className="muted">Aucun bon enregistré.</p>

  return (
    <section className="card table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Mécanique</th>
              <th>Canaux</th>
              <th>Périmètre</th>
              <th className="num">Utilisations</th>
              <th className="num">Remise cumulée</th>
              <th>Limite</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {data.map((voucher) => (
              <tr key={voucher.id}>
                <td>
                  <span className="voucher__code">{voucher.code}</span>
                  {voucher.campaign_name ? (
                    <div className="muted lead__potential">
                      <span className="link-badge">⛓</span>
                      {voucher.campaign_name}
                    </div>
                  ) : null}
                </td>
                <td>{voucher.mechanic_label ?? '—'}</td>
                <td>
                  <ul className="chips">
                    {voucher.channels.map((code) => (
                      <li key={code} className="chip chip--lever" title={CHANNELS[code] ?? code}>
                        {code}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="muted">{voucher.scope_label ?? '—'}</td>
                <td className="num">{voucher.redemptions}</td>
                <td className="num">{formatEur(voucher.discount_total, 2)}</td>
                <td className="muted">{voucher.usage_limit_label ?? '—'}</td>
                <td className="muted">
                  {voucher.partner_name ?? voucher.source ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
