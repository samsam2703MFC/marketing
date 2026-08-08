import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatDate, formatEur } from '../lib/useAsync'
import type { Campaign, CampaignStatus } from '../lib/api/module'

interface CampaignsViewProps {
  statuses: CampaignStatus[]
  brandId: number | 'all'
  onOpen: (campaignId: number) => void
  onCreate: () => void
}

/**
 * Liste des campagnes.
 *
 * Les filtres de statut sont construits depuis le référentiel, pas depuis une
 * liste figée : leurs libellés et leurs couleurs viennent de la base.
 */
export default function CampaignsView({ statuses, brandId, onOpen, onCreate }: CampaignsViewProps) {
  const [status, setStatus] = useState<string | null>(null)
  const [scope, setScope] = useState<'RESEAU' | 'LOCALE' | null>(null)

  const { data, error, loading } = useAsync(
    () =>
      api.listCampaigns({
        status: status ?? undefined,
        scope: scope ?? undefined,
        brand_id: brandId === 'all' ? undefined : brandId,
      }),
    [status, scope, brandId],
  )

  return (
    <>
      <div className="filters">
        <div className="filters__row">
          <button
            type="button"
            className={`filter${status === null ? ' is-on' : ''}`}
            onClick={() => setStatus(null)}
          >
            Tous les statuts
          </button>
          {statuses.map((entry) => (
            <button
              key={entry.code}
              type="button"
              className={`filter${status === entry.code ? ' is-on' : ''}`}
              onClick={() => setStatus(entry.code)}
              style={
                status === entry.code
                  ? { color: entry.text_hex, background: entry.bg_rgba, borderColor: entry.text_hex }
                  : undefined
              }
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="filters__row">
          <button
            type="button"
            className={`filter${scope === null ? ' is-on' : ''}`}
            onClick={() => setScope(null)}
          >
            Tous périmètres
          </button>
          <button
            type="button"
            className={`filter${scope === 'RESEAU' ? ' is-on' : ''}`}
            onClick={() => setScope('RESEAU')}
          >
            Réseau
          </button>
          <button
            type="button"
            className={`filter${scope === 'LOCALE' ? ' is-on' : ''}`}
            onClick={() => setScope('LOCALE')}
          >
            Locale
          </button>

          <button type="button" className="filter is-on" onClick={onCreate}>
            + Nouvelle campagne
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Chargement…</p> : null}

      {data && data.length === 0 ? (
        <p className="muted">Aucune campagne ne correspond à ces filtres.</p>
      ) : null}

      <div className="campaign-grid">
        {(data ?? []).map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} onOpen={onOpen} />
        ))}
      </div>
    </>
  )
}

function CampaignCard({
  campaign,
  onOpen,
}: {
  campaign: Campaign
  onOpen: (campaignId: number) => void
}) {
  // Barre de progression budgétaire, bornée : un dépassement ne doit pas
  // déborder de la carte.
  const ratio = campaign.budget_amount > 0
    ? Math.min(100, (campaign.spent_amount / campaign.budget_amount) * 100)
    : 0

  return (
    <article className="card campaign" onClick={() => onOpen(campaign.id)}>
      {campaign.image_url ? (
        <img className="campaign__image" src={campaign.image_url} alt="" />
      ) : (
        <div className="campaign__image campaign__image--empty" aria-hidden="true" />
      )}

      <div className="campaign__body">
        <div className="campaign__head">
          <h3>{campaign.name}</h3>
          <span
            className="chip"
            style={{ color: campaign.status_text_hex, background: campaign.status_bg_rgba }}
          >
            {campaign.status_label}
          </span>
        </div>

        <p className="muted campaign__meta">
          {campaign.scope === 'RESEAU' ? 'Réseau' : 'Locale'}
          {campaign.type_label ? ` · ${campaign.type_label}` : ''}
          {` · ${campaign.shops_count} boutique${campaign.shops_count > 1 ? 's' : ''}`}
        </p>

        <p className="muted campaign__meta">
          {formatDate(campaign.starts_on)} → {formatDate(campaign.ends_on)}
        </p>

        <div className="progress" role="presentation">
          <div className="progress__fill" style={{ width: `${ratio}%` }} />
        </div>
        <p className="campaign__budget">
          {formatEur(campaign.spent_amount)} <span className="muted">/ {formatEur(campaign.budget_amount)}</span>
        </p>
      </div>
    </article>
  )
}
