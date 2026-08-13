import { useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatDate, formatEur } from '../lib/useAsync'
import type { Campaign, CampaignStatus } from '../lib/api/module'

interface CampaignsViewProps {
  statuses: CampaignStatus[]
  brandId: number | 'all'
  onOpen: (campaignId: number) => void
  onCreate: () => void
  /** Rouvre un brouillon dans l'assistant, là où il s'était arrêté. */
  onResume: (campaignId: number) => void
}

/**
 * Liste des campagnes.
 *
 * Les filtres de statut sont construits depuis le référentiel, pas depuis une
 * liste figée : leurs libellés et leurs couleurs viennent de la base.
 */
export default function CampaignsView({
  statuses,
  brandId,
  onOpen,
  onCreate,
  onResume,
}: CampaignsViewProps) {
  const [status, setStatus] = useState<string | null>(null)
  const [scope, setScope] = useState<'RESEAU' | 'LOCALE' | null>(null)
  /** Campagne dont la suppression est proposée, tant qu'elle n'est pas confirmée. */
  const [aSupprimer, setASupprimer] = useState<Campaign | null>(null)
  const [suppression, setSuppression] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [rechargement, setRechargement] = useState(0)

  const { data, error, loading } = useAsync(
    () =>
      api.listCampaigns({
        status: status ?? undefined,
        scope: scope ?? undefined,
        brand_id: brandId === 'all' ? undefined : brandId,
      }),
    [status, scope, brandId, rechargement],
  )

  const supprimer = async () => {
    if (aSupprimer === null) return

    setOccupe(true)
    setSuppression(null)

    try {
      await api.deleteCampaign(aSupprimer.id)
      setASupprimer(null)
      setRechargement((tour) => tour + 1)
    } catch (echec) {
      // Le refus le plus probable est un périmètre : un franchisé ne supprime
      // pas une campagne réseau. Le message du serveur le dit mieux que nous.
      setSuppression(echec instanceof Error ? echec.message : 'Suppression impossible.')
    } finally {
      setOccupe(false)
    }
  }

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
          <CampaignCard
            key={campaign.id}
            campaign={campaign}
            onOpen={onOpen}
            onResume={onResume}
            onDelete={setASupprimer}
          />
        ))}
      </div>

      {/* Confirmation : la suppression emporte les objectifs, l'offre et les
          leads, et rien ne les rend. Elle nomme la campagne plutôt que de
          demander « êtes-vous sûr ? » dans le vide — on ne relit pas ce qu'on
          s'apprête à perdre si l'écran ne le dit pas. */}
      {aSupprimer === null ? null : (
        <div
          className="confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-titre"
          onClick={() => (occupe ? null : setASupprimer(null))}
        >
          <div className="confirm__box card" onClick={(evenement) => evenement.stopPropagation()}>
            <h3 id="confirm-titre">Supprimer « {aSupprimer.name} » ?</h3>
            <p className="muted">
              Ses objectifs par boutique et par produit, son offre, son budget, son planning
              et ses leads seront effacés avec elle. C’est définitif.
            </p>

            {suppression === null ? null : <p className="error">{suppression}</p>}

            <div className="confirm__actions">
              <button
                type="button"
                className="filter"
                disabled={occupe}
                onClick={() => setASupprimer(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="filter confirm__danger"
                disabled={occupe}
                onClick={supprimer}
              >
                {occupe ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CampaignCard({
  campaign,
  onOpen,
  onResume,
  onDelete,
}: {
  campaign: Campaign
  onOpen: (campaignId: number) => void
  onResume: (campaignId: number) => void
  onDelete: (campaign: Campaign) => void
}) {
  // Un brouillon est une campagne qu'on n'a pas fini d'écrire : elle n'a rien à
  // piloter — ni KPI, ni lead, ni dépense — et tout à terminer. Le clic la
  // rouvre donc dans l'assistant, pas dans le suivi, où il n'y avait rien à
  // voir et d'où l'on ne pouvait pas revenir la finir.
  const unfinished = campaign.status_code === 'draft'

  // Barre de progression budgétaire, bornée : un dépassement ne doit pas
  // déborder de la carte.
  const ratio = campaign.budget_amount > 0
    ? Math.min(100, (campaign.spent_amount / campaign.budget_amount) * 100)
    : 0

  return (
    <article
      className={`card campaign${unfinished ? ' campaign--draft' : ''}`}
      onClick={() => (unfinished ? onResume(campaign.id) : onOpen(campaign.id))}
    >
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
          {/* La carte entière ouvre la campagne : sans cet arrêt, demander la
              suppression l'ouvrirait aussi, et la confirmation s'afficherait
              par-dessus l'assistant. */}
          <button
            type="button"
            className="campaign__delete"
            title={`Supprimer ${campaign.name}`}
            aria-label={`Supprimer ${campaign.name}`}
            onClick={(evenement) => {
              evenement.stopPropagation()
              onDelete(campaign)
            }}
          >
            ✕
          </button>
        </div>

        <p className="muted campaign__meta">
          {campaign.scope === 'RESEAU' ? 'Réseau' : 'Locale'}
          {campaign.type_label ? ` · ${campaign.type_label}` : ''}
          {` · ${campaign.shops_count} boutique${campaign.shops_count > 1 ? 's' : ''}`}
        </p>

        <p className="muted campaign__meta">
          {formatDate(campaign.starts_on)} → {formatDate(campaign.ends_on)}
        </p>

        {unfinished ? (
          // Le budget d'un brouillon ne mesure rien : il n'a pas été engagé.
          // À sa place, ce qu'il y a à faire.
          <p className="campaign__resume">Reprendre là où vous en étiez →</p>
        ) : (
          <>
            <div className="progress" role="presentation">
              <div className="progress__fill" style={{ width: `${ratio}%` }} />
            </div>
            <p className="campaign__budget">
              {formatEur(campaign.spent_amount)}{' '}
              <span className="muted">/ {formatEur(campaign.budget_amount)}</span>
            </p>
          </>
        )}
      </div>
    </article>
  )
}
