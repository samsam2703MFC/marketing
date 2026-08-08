import { module as api } from '../lib/api'
import { useAsync, formatEur } from '../lib/useAsync'
import type { Role } from '../lib/navigation'

/**
 * Kit local & DAM.
 *
 * Côté réseau l'écran mesure l'adoption — combien de boutiques ont activé quoi.
 * Côté boutique il présente le même catalogue comme une offre à activer. Les
 * données sont identiques ; seul le cadrage change, d'où le rôle en paramètre
 * plutôt que deux écrans.
 */
export default function DamView({ role }: { role: Role }) {
  const { data, error, loading } = useAsync(() => api.listKits(), [])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data?.length) return <p className="muted">Aucun kit publié.</p>

  const activations = data.reduce((sum, kit) => sum + kit.activations, 0)
  const assets = data.reduce((sum, kit) => sum + kit.assets_count, 0)

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Kits publiés</h2>
          <p className="metric">{data.length}</p>
        </section>
        <section className="card">
          <h2>{role === 'BRAND_ADMIN' ? 'Activations réseau' : 'Mes activations'}</h2>
          <p className="metric">{activations}</p>
        </section>
        <section className="card">
          <h2>Visuels disponibles</h2>
          <p className="metric">{assets}</p>
          <p className="muted">Fichiers rattachés aux kits</p>
        </section>
      </div>

      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Kit</th>
                <th>Type de campagne</th>
                <th className="num">Budget conseillé</th>
                <th className="num">Visuels</th>
                <th className="num">
                  {role === 'BRAND_ADMIN' ? 'Boutiques activées' : 'Mes activations'}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((kit) => (
                <tr key={kit.id}>
                  <td>
                    {kit.name}
                    {kit.description ? <div className="muted">{kit.description}</div> : null}
                  </td>
                  <td className="muted">{kit.type_label ?? '—'}</td>
                  <td className="num">
                    {kit.default_budget_amount === null
                      ? '—'
                      : formatEur(kit.default_budget_amount)}
                  </td>
                  <td className="num">{kit.assets_count}</td>
                  <td className="num">{kit.activations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
