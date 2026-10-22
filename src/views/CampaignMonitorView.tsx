import { useCallback, useState } from 'react'
import { module as api } from '../lib/api'
import { useAsync, formatEur, formatNumber } from '../lib/useAsync'
import { describeError } from '../state/auth'
import CampaignBrief from '../components/CampaignBrief'
import type { CampaignDetail, FunnelStep, Lead, LeadStatus, TrackingBaseline, TrackingScope } from '../lib/api/module'
import { useReferences } from '../state/references'
import { campaignGaps } from '../lib/completeness'

interface MonitorProps {
  campaignId: number
  leadStatuses: LeadStatus[]
  onBack: () => void
  /** Ouvre « Créer un post » (module Social & Ads) avec cette campagne comme opération liée — réseau seul. */
  onCreatePost?: () => void
  /** Ouvre le plan de posts de la campagne (module Social & Ads) : durée, réseaux, mix → brouillons au calendrier. */
  onPlanPosts?: () => void
  /** Le réseau change le suivi de toute campagne ; une boutique, celui de ses campagnes locales (l'API tranche). */
  brandAdmin?: boolean
  /** Ouvre l'assistant de campagne (sept étapes) sur cette campagne. */
  onOpenAssistant?: () => void
  /** Ouvre « Compléter les campagnes » sur celle-ci. */
  onComplete?: () => void
}

/**
 * Suivi en direct d'une campagne : KPI, classement des boutiques, base CRM.
 */
export default function CampaignMonitorView({ campaignId, leadStatuses, onBack, onCreatePost, onPlanPosts, brandAdmin = false, onOpenAssistant, onComplete }: MonitorProps) {
  // Relue après un changement du suivi : la carte montre ce que la base a gardé, pas ce qu'on a tapé.
  const [reloadCampaign, setReloadCampaign] = useState(0)
  const campaign = useAsync(() => api.getCampaign(campaignId), [campaignId, reloadCampaign])
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
      <div className="monitor-actions">
        <button type="button" className="filter back" onClick={onBack}>
          ← Retour aux campagnes
        </button>
        {onOpenAssistant ? (
          <button type="button" className="filter is-on back" onClick={onOpenAssistant}>
            Ouvrir l’assistant de la campagne →
          </button>
        ) : null}
        {onCreatePost ? (
          <button type="button" className="filter is-on back" onClick={onCreatePost}>
            Créer un post pour cette campagne →
          </button>
        ) : null}
        {onPlanPosts ? (
          <button type="button" className="filter is-on back" onClick={onPlanPosts}>
            Planifier les posts de la campagne →
          </button>
        ) : null}
      </div>

      {campaign.error ? <p className="error">{campaign.error}</p> : null}
      {campaign.data ? <h2 className="screen-subtitle">{campaign.data.name}</h2> : null}

      {/* Ce qui manque pour mesurer le retour de la campagne, nommé avant ses chiffres. */}
      {campaign.data && onComplete && (brandAdmin || campaign.data.scope === 'LOCALE') ? <GapsNotice campaign={campaign.data} onComplete={onComplete} /> : null}

      {/* a. Cadrage : ce que l'assistant a fait saisir à la création. */}
      {campaign.data ? <CampaignBrief campaign={campaign.data} /> : null}

      {/* Le suivi : l'action que la campagne doit faire bouger, et comment on la juge. */}
      {campaign.data ? <TrackingCard key={reloadCampaign} campaign={campaign.data} canEdit={brandAdmin || campaign.data.scope === 'LOCALE'} onSaved={() => setReloadCampaign((key) => key + 1)} /> : null}

      {/* b. KPI et classement des boutiques */}
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

/** Les données qui manquent pour mesurer le retour, et l'accès à leur saisie. Rien ne manque : rien ne s'affiche. */
function GapsNotice({ campaign, onComplete }: { campaign: CampaignDetail; onComplete: () => void }) {
  const gaps = campaignGaps(campaign)
  if (gaps.length === 0) return null

  return (
    <section className="card fix-notice">
      <p>
        <span className="tag-warn">À compléter</span> Son retour ne peut pas se mesurer : il manque{' '}
        {gaps.map((g) => g.label.toLowerCase()).join(', ')}.
      </p>
      <button type="button" className="btn btn--sm" onClick={onComplete}>
        Compléter la campagne →
      </button>
    </section>
  )
}

/**
 * Le suivi de la campagne : l'action qu'elle doit faire bouger, sa portée (par
 * boutique ou pour le réseau), sa cible et sa référence, avec l'endroit où elle
 * se lit. Il se choisit à l'assistant (étape « Suivi ») et se change ici, même
 * campagne lancée : l'assistant ne réécrit qu'un brouillon, alors qu'une campagne
 * planifiée peut encore préciser ce qu'on en attend. Sans suivi, la carte le dit
 * au lieu de disparaître : c'est un choix qui manque, pas une donnée.
 */
function TrackingCard({ campaign, canEdit, onSaved }: { campaign: CampaignDetail; canEdit: boolean; onSaved: () => void }) {
  const refs = useReferences()
  const actions = refs.trackingActions ?? []
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [form, setForm] = useState({
    action: campaign.tracking_action_id ?? null,
    scope: (campaign.tracking_scope ?? (campaign.scope === 'LOCALE' ? 'SHOP' : 'NETWORK')) as TrackingScope,
    target: campaign.tracking_target === null || campaign.tracking_target === undefined ? '' : String(campaign.tracking_target),
    baseline: (campaign.tracking_baseline ?? 'N1') as TrackingBaseline,
  })
  const choisie = actions.find((entry) => entry.id === form.action) ?? null

  const save = async () => {
    setBusy(true)
    setFailure(null)
    try {
      await api.updateCampaign(campaign.id, {
        tracking_action_id: form.action,
        tracking_scope: form.action === null ? null : form.scope,
        tracking_target: form.action === null || form.target.trim() === '' ? null : Number(form.target),
        tracking_baseline: form.action === null ? null : form.baseline,
      })
      setEdit(false)
      onSaved()
    } catch (error) {
      setFailure(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  if (edit) {
    return (
      <section className="card">
        <h2>Suivi</h2>
        <div className="filters__row">
          <label className="field">
            Action suivie
            <select
              value={form.action ?? ''}
              onChange={(event) => setForm({ ...form, action: event.target.value === '' ? null : Number(event.target.value) })}
            >
              <option value="">— Pas de suivi —</option>
              {actions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          {choisie !== null ? (
            <>
              <label className="field">
                Mesurée
                <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as TrackingScope })}>
                  <option value="NETWORK">Pour le réseau</option>
                  <option value="SHOP">Par boutique</option>
                </select>
              </label>
              <label className="field">
                Cible ({choisie.unit_label})
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.target}
                  placeholder="à fixer"
                  onChange={(event) => setForm({ ...form, target: event.target.value })}
                />
              </label>
              <label className="field">
                Comparée à
                <select value={form.baseline} onChange={(event) => setForm({ ...form, baseline: event.target.value as TrackingBaseline })}>
                  <option value="N1">Mêmes dates l'an dernier</option>
                  <option value="AVANT">Même durée juste avant le lancement</option>
                </select>
              </label>
            </>
          ) : null}
        </div>
        {choisie !== null ? <p className="muted">Se lit : {choisie.source_label}.</p> : null}
        {failure ? <p className="error">{failure}</p> : null}
        <div className="filters__row">
          <button type="button" className="filter is-on" disabled={busy} onClick={() => void save()}>
            {busy ? 'Enregistrement…' : 'Enregistrer le suivi'}
          </button>
          <button type="button" className="filter" disabled={busy} onClick={() => setEdit(false)}>
            Annuler
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Suivi</h2>
      {campaign.tracking_action_label ? (
        <>
          <p className="metric">{campaign.tracking_action_label}</p>
          <p className="muted">
            {campaign.tracking_scope === 'SHOP' ? 'Par boutique' : 'Pour le réseau'} ·{' '}
            {campaign.tracking_target === null || campaign.tracking_target === undefined
              ? 'cible à fixer'
              : `cible ${formatNumber(campaign.tracking_target)} ${campaign.tracking_unit_label ?? ''}`}{' '}
            · comparé {campaign.tracking_baseline === 'AVANT' ? 'à la même durée juste avant le lancement' : 'aux mêmes dates l’an dernier'}
          </p>
          <p className="muted">Se lit : {campaign.tracking_source_label}.</p>
        </>
      ) : (
        <p className="muted">Aucune action suivie pour cette campagne.</p>
      )}
      {canEdit ? (
        <button type="button" className="filter" onClick={() => setEdit(true)}>
          {campaign.tracking_action_label ? 'Changer le suivi' : 'Choisir l’action suivie'}
        </button>
      ) : null}
    </section>
  )
}
