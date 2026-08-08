import { module as api } from '../lib/api'
import { useAsync, formatEur } from '../lib/useAsync'
import type { CampaignChannel, AssetRender, CampaignUniform } from '../lib/api/module'

/**
 * Pub physique & PLV, et Pub digitale.
 *
 * Un seul composant pour les deux écrans : ils lisent la même chose — les
 * canaux activés par campagne — et ne diffèrent que par la famille et par ce
 * qui les accompagne (tenues terrain d'un côté, déclinaisons de visuels de
 * l'autre). Deux fichiers presque identiques auraient divergé à la première
 * évolution.
 */
export default function DiffusionView({ family }: { family: 'PHYSIQUE' | 'DIGITAL' }) {
  const { data, error, loading } = useAsync(() => api.getDiffusion(family), [family])

  if (error) return <p className="error">{error}</p>
  if (loading) return <p className="muted">Chargement…</p>
  if (!data) return null

  const enabled = data.channels.filter((channel) => channel.is_enabled)
  const budget = enabled.reduce((sum, channel) => sum + (channel.budget_amount ?? 0), 0)

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Canaux activés</h2>
          <p className="metric">{enabled.length}</p>
          <p className="muted">
            sur {data.channels.length} rattachement{data.channels.length > 1 ? 's' : ''} de campagne
          </p>
        </section>

        <section className="card">
          <h2>Budget diffusion</h2>
          <p className="metric">{formatEur(budget)}</p>
          <p className="muted">Somme des budgets par canal</p>
        </section>

        <section className="card">
          <h2>{family === 'PHYSIQUE' ? 'Tenues & accessoires' : 'Déclinaisons produites'}</h2>
          <p className="metric">
            {family === 'PHYSIQUE' ? data.uniforms.length : data.renders.length}
          </p>
        </section>
      </div>

      <ChannelTable channels={data.channels} />

      {family === 'PHYSIQUE' ? <Uniforms uniforms={data.uniforms} /> : null}
      {family === 'DIGITAL' ? <Renders renders={data.renders} /> : null}
    </>
  )
}

function ChannelTable({ channels }: { channels: CampaignChannel[] }) {
  if (channels.length === 0) {
    return <p className="muted">Aucun canal rattaché à une campagne de votre périmètre.</p>
  }

  return (
    <section className="card table-card">
      <h2>Canaux par campagne</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Campagne</th>
              <th>Canal</th>
              <th>Prestataire</th>
              <th className="num">Budget</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.id}>
                <td>
                  {channel.campaign_name}
                  <span
                    className="chip chip--inline"
                    style={{ color: channel.status_text_hex, background: channel.status_bg_rgba }}
                  >
                    {channel.status_label}
                  </span>
                </td>
                <td>{channel.channel_label}</td>
                <td className="muted">{channel.agency_name ?? 'Interne'}</td>
                <td className="num">
                  {channel.budget_amount === null ? '—' : formatEur(channel.budget_amount)}
                </td>
                <td className="muted">{channel.is_enabled ? 'Activé' : 'Désactivé'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Uniforms({ uniforms }: { uniforms: CampaignUniform[] }) {
  if (uniforms.length === 0) return null

  return (
    <section className="card">
      <h2>Tenues & accessoires terrain</h2>
      <ul className="chips">
        {uniforms.map((uniform) => (
          <li key={uniform.id} className="chip chip--lever" title={uniform.description ?? undefined}>
            {uniform.icon_path ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d={uniform.icon_path}
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
            {uniform.name}
            {uniform.campaign_name ? (
              <span className="muted"> · {uniform.campaign_name}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Déclinaisons d'un visuel par format.
 *
 * `override_file_url` porte le recadrage manuel : quand il existe il prime sur
 * le rendu automatique, et l'écran doit le montrer — c'est le seul moyen de
 * savoir si une reprise à la main a bien été prise en compte.
 */
function Renders({ renders }: { renders: AssetRender[] }) {
  if (renders.length === 0) {
    return <p className="muted">Aucune déclinaison produite pour vos campagnes.</p>
  }

  return (
    <section className="card table-card">
      <h2>Déclinaisons par format</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Campagne</th>
              <th>Format</th>
              <th className="num">Dimensions</th>
              <th>Source</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {renders.map((render) => (
              <tr key={render.id}>
                <td>{render.campaign_name}</td>
                <td>
                  {render.format_name}
                  {render.note ? <div className="muted">{render.note}</div> : null}
                </td>
                <td className="num">
                  {render.width_px} × {render.height_px}
                </td>
                <td className="muted">
                  {render.override_file_url ? 'Recadrage manuel' : 'Rendu automatique'}
                </td>
                <td className="muted">{render.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
