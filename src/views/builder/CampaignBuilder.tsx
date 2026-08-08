import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync, formatDate, formatEur } from '../../lib/useAsync'
import type { CampaignDraft, ClientTarget, References } from '../../lib/api/module'
import type { Role } from '../../lib/navigation'
import { describeError } from '../../state/auth'

/**
 * Assistant de création de campagne, en sept étapes.
 *
 * Le brouillon vit ici et n'est envoyé qu'à la dernière étape : le serveur écrit
 * la campagne, son périmètre, ses canaux et ses objectifs dans une seule
 * transaction. Enregistrer étape par étape aurait laissé des campagnes à
 * moitié montées dès la première interruption.
 *
 * Chaque étape déclare ce qui lui manque plutôt que de bloquer sans dire quoi :
 * une flèche grisée sans explication est la première cause d'abandon.
 */

interface Step {
  key: string
  label: string
  /** Ce qui manque pour passer à la suite. Vide = étape complète. */
  blocking: (draft: Draft) => string | null
}

/** Brouillon en cours de saisie. Les nombres restent des chaînes tant qu'on tape. */
interface Draft {
  type_id: number | null
  name: string
  starts_on: string
  ends_on: string
  image_url: string
  scope: 'RESEAU' | 'LOCALE'
  client_target: ClientTarget
  shop_ids: number[]
  budget_amount: string
  targets: Record<number, string>
  channels: Record<number, { budget: string; agencyId: number | null }>
  status_code: string
  create_crm_leads: boolean
}

const EMPTY: Draft = {
  type_id: null,
  name: '',
  starts_on: '',
  ends_on: '',
  image_url: '',
  scope: 'RESEAU',
  client_target: 'b2c',
  shop_ids: [],
  budget_amount: '',
  targets: {},
  channels: {},
  status_code: 'draft',
  create_crm_leads: false,
}

const STEPS: Step[] = [
  {
    key: 'type',
    label: 'Type & cible',
    blocking: (d) => (d.type_id === null ? 'Choisissez un type de campagne.' : null),
  },
  {
    key: 'identity',
    label: 'Identité & période',
    blocking: (d) => {
      if (d.name.trim() === '') return 'Donnez un nom à la campagne.'
      if (d.starts_on !== '' && d.ends_on !== '' && d.ends_on < d.starts_on) {
        return 'La date de fin précède la date de début.'
      }
      return null
    },
  },
  {
    key: 'scope',
    label: 'Boutiques',
    blocking: (d) =>
      d.scope === 'LOCALE' && d.shop_ids.length === 0
        ? 'Une campagne locale doit désigner au moins une boutique.'
        : null,
  },
  {
    key: 'budget',
    label: 'Budget',
    blocking: (d) =>
      d.budget_amount !== '' && Number(d.budget_amount) < 0
        ? 'Le budget ne peut pas être négatif.'
        : null,
  },
  { key: 'targets', label: 'Objectifs par levier', blocking: () => null },
  { key: 'channels', label: 'Diffusion', blocking: () => null },
  { key: 'review', label: 'Récapitulatif', blocking: () => null },
]

export default function CampaignBuilder({
  refs,
  role,
  brandId,
  onCreated,
  onCancel,
}: {
  refs: References
  role: Role
  /**
   * Marque courante, telle que la désigne le sélecteur de la barre latérale.
   * `'all'` — le cas ordinaire d'un réseau mono-enseigne — laisse le serveur la
   * résoudre : dans un back-office, la marque est connue, elle ne se saisit pas.
   */
  brandId: number | 'all'
  onCreated: (campaignId: number) => void
  onCancel: () => void
}) {
  // Un franchisé ne crée que des campagnes locales : le serveur le lui
  // imposerait de toute façon en refusant les boutiques hors périmètre.
  const [draft, setDraft] = useState<Draft>({
    ...EMPTY,
    scope: role === 'FRANCHISEE' ? 'LOCALE' : 'RESEAU',
  })
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const shops = useAsync(() => api.listShops(), [])
  const agencies = useAsync(() => api.listAgencies(), [])

  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }))
  const blocking = STEPS[step].blocking(draft)

  async function submit() {
    setSubmitting(true)
    setFailure(null)

    try {
      const { inserted_id } = await api.createCampaign(toPayload(draft, brandId))
      onCreated(inserted_id)
    } catch (cause: unknown) {
      setFailure(describeError(cause))
      setSubmitting(false)
    }
  }

  return (
    <>
      <button type="button" className="filter back" onClick={onCancel}>
        ← Annuler
      </button>

      <ol className="wizard__steps">
        {STEPS.map((entry, index) => (
          <li
            key={entry.key}
            className={`wizard__step${index === step ? ' is-on' : ''}${index < step ? ' is-done' : ''}`}
          >
            <button
              type="button"
              // On peut revenir en arrière librement, mais pas sauter en avant :
              // une étape suivante peut dépendre d'un choix non encore fait.
              onClick={() => index < step && setStep(index)}
              disabled={index > step}
            >
              <span className="wizard__num">{index + 1}</span>
              {entry.label}
            </button>
          </li>
        ))}
      </ol>

      <section className="card">
        {step === 0 ? <TypeStep refs={refs} role={role} draft={draft} patch={patch} /> : null}
        {step === 1 ? <IdentityStep draft={draft} patch={patch} /> : null}
        {step === 2 ? (
          <ScopeStep role={role} shops={shops.data ?? []} draft={draft} patch={patch} />
        ) : null}
        {step === 3 ? <BudgetStep draft={draft} patch={patch} /> : null}
        {step === 4 ? <TargetsStep refs={refs} draft={draft} patch={patch} /> : null}
        {step === 5 ? (
          <ChannelsStep refs={refs} agencies={agencies.data ?? []} draft={draft} patch={patch} />
        ) : null}
        {step === 6 ? (
          <ReviewStep refs={refs} shops={shops.data ?? []} draft={draft} patch={patch} />
        ) : null}
      </section>

      {blocking ? <p className="muted wizard__hint">{blocking}</p> : null}
      {failure ? <p className="error">{failure}</p> : null}

      <div className="filters__row">
        <button
          type="button"
          className="filter"
          onClick={() => setStep(step - 1)}
          disabled={step === 0}
        >
          Précédent
        </button>

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="filter is-on"
            onClick={() => setStep(step + 1)}
            disabled={blocking !== null}
          >
            Suivant
          </button>
        ) : (
          <button type="button" className="filter is-on" onClick={submit} disabled={submitting}>
            {submitting ? 'Création…' : 'Créer la campagne'}
          </button>
        )}
      </div>
    </>
  )
}

/** Brouillon → corps de requête. Les champs vides deviennent `null`, pas `""`. */
function toPayload(draft: Draft, brandId: number | 'all'): CampaignDraft {
  return {
    // Omise quand le sélecteur est sur « toutes marques » : le serveur la
    // déduit, et refuse explicitement si plusieurs enseignes sont actives.
    brand_id: brandId === 'all' ? null : brandId,
    name: draft.name.trim(),
    type_id: draft.type_id,
    scope: draft.scope,
    client_target: draft.client_target,
    status_code: draft.status_code,
    starts_on: draft.starts_on || null,
    ends_on: draft.ends_on || null,
    budget_amount: draft.budget_amount === '' ? 0 : Number(draft.budget_amount),
    image_url: draft.image_url.trim() || null,
    create_crm_leads: draft.create_crm_leads,
    shop_ids: draft.scope === 'LOCALE' ? draft.shop_ids : [],
    channels: Object.entries(draft.channels).map(([channelId, entry]) => ({
      channel_id: Number(channelId),
      agency_id: entry.agencyId,
      budget_amount: entry.budget === '' ? null : Number(entry.budget),
    })),
    lever_targets: Object.entries(draft.targets)
      .filter(([, value]) => value !== '' && Number(value) !== 0)
      .map(([leverId, value]) => ({
        lever_id: Number(leverId),
        target_value: Number(value),
        target_unit: 'EUR',
      })),
  }
}

// ---------------------------------------------------------------------------
// Étapes
// ---------------------------------------------------------------------------

type StepProps = { draft: Draft; patch: (change: Partial<Draft>) => void }

/** Cibles client, telles que la maquette les propose. */
const CLIENT_TARGETS: Array<{ value: ClientTarget; label: string }> = [
  { value: 'b2c', label: 'B2C — particuliers' },
  { value: 'b2b', label: 'B2B — professionnels' },
  { value: 'mixte', label: 'Mixte B2C + B2B' },
]

/**
 * Type, portée et cible : les trois choix que la maquette réunit sur un même
 * écran, parce qu'ils se décident ensemble — un partenariat local B2B et une
 * saisonnalité réseau B2C n'ouvrent pas le même assistant derrière.
 *
 * La pastille de levier vient du référentiel, couleur comprise. La maquette la
 * déduisait par mots-clés sur un texte libre ; c'est désormais une relation.
 */
function TypeStep({ refs, role, draft, patch }: StepProps & { refs: References; role: Role }) {
  return (
    <>
      <h2>Quel type de campagne ?</h2>
      <p className="muted">
        Le type détermine le levier suivi et l’indicateur affiché en pilotage.
      </p>

      <ul className="type-grid">
        {refs.campaignTypes.map((type) => (
          <li key={type.id}>
            <button
              type="button"
              className={`type-card${draft.type_id === type.id ? ' is-on' : ''}`}
              onClick={() => patch({ type_id: type.id })}
            >
              {type.icon_path ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d={type.icon_path}
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
              <strong className="type-card__name">{type.label}</strong>
              {type.lever_label ? (
                <span
                  className="lever-tag"
                  style={{ background: type.lever_color_hex ?? undefined }}
                >
                  {type.lever_label}
                </span>
              ) : null}
              {type.default_kpi_label ? (
                <span className="muted type-card__kpi">{type.default_kpi_label}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <h3 className="section-label">Portée</h3>
      {role === 'BRAND_ADMIN' ? (
        <div className="choice-row">
          <button
            type="button"
            className={`choice-card${draft.scope === 'RESEAU' ? ' is-on' : ''}`}
            onClick={() => patch({ scope: 'RESEAU', shop_ids: [] })}
          >
            <strong>Réseau</strong>
            <span className="muted">Toutes les boutiques</span>
          </button>
          <button
            type="button"
            className={`choice-card${draft.scope === 'LOCALE' ? ' is-on' : ''}`}
            onClick={() => patch({ scope: 'LOCALE' })}
          >
            <strong>Locale</strong>
            <span className="muted">Validée avec le ou les franchisés</span>
          </button>
        </div>
      ) : (
        <p className="muted">
          Une boutique crée des campagnes locales : la portée est fixée, le choix des boutiques
          se fait à l’étape suivante.
        </p>
      )}

      <h3 className="section-label">Cible client</h3>
      <div className="choice-row">
        {CLIENT_TARGETS.map((target) => (
          <button
            key={target.value}
            type="button"
            className={`choice-pill${draft.client_target === target.value ? ' is-on' : ''}`}
            // Une campagne B2C n'a pas de leads : cocher « générer les leads »
            // n'aurait alors aucun effet, autant le remettre à zéro ici.
            onClick={() =>
              patch({
                client_target: target.value,
                create_crm_leads: target.value === 'b2c' ? false : draft.create_crm_leads,
              })
            }
          >
            {target.label}
          </button>
        ))}
      </div>
    </>
  )
}

/** La marque n'y figure pas : dans un back-office, elle est connue. */
function IdentityStep({ draft, patch }: StepProps) {
  return (
    <>
      <h2>Identité & période</h2>
      <div className="filters__row">
        <label className="field">
          Nom
          <input
            type="text"
            value={draft.name}
            placeholder="Barbecue été"
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
      </div>
      <div className="filters__row">
        <label className="field">
          Du
          <input
            type="date"
            value={draft.starts_on}
            onChange={(e) => patch({ starts_on: e.target.value })}
          />
        </label>
        <label className="field">
          Au
          <input
            type="date"
            value={draft.ends_on}
            onChange={(e) => patch({ ends_on: e.target.value })}
          />
        </label>
        <label className="field">
          Visuel (URL)
          <input
            type="url"
            value={draft.image_url}
            placeholder="https://…"
            onChange={(e) => patch({ image_url: e.target.value })}
          />
        </label>
      </div>
    </>
  )
}

/**
 * Choix des boutiques. La portée se décide à l'étape 1, avec le type : cet
 * écran ne fait plus que la servir, et disparaît pour une campagne réseau.
 *
 * Les pastilles reprennent celles des filtres — même geste, même apparence.
 */
function ScopeStep({
  role,
  shops,
  draft,
  patch,
}: StepProps & { role: Role; shops: Array<{ id: number; name: string; city: string | null }> }) {
  const toggle = (shopId: number) =>
    patch({
      shop_ids: draft.shop_ids.includes(shopId)
        ? draft.shop_ids.filter((id) => id !== shopId)
        : [...draft.shop_ids, shopId],
    })

  if (draft.scope === 'RESEAU') {
    return (
      <>
        <h2>Boutiques</h2>
        <p className="muted">
          Campagne réseau : toutes les boutiques sont concernées, il n’y a rien à désigner ici.
        </p>
      </>
    )
  }

  return (
    <>
      <h2>Boutiques</h2>
      <p className="muted">
        {role === 'BRAND_ADMIN'
          ? 'Campagne locale : désignez les boutiques avec lesquelles elle est validée.'
          : 'Campagne locale : choisissez parmi les boutiques qui vous sont rattachées.'}
      </p>

      {shops.length === 0 ? (
        <p className="muted">Aucune boutique dans votre périmètre.</p>
      ) : (
        <div className="filters__row">
          {shops.map((shop) => (
            <button
              key={shop.id}
              type="button"
              className={`filter${draft.shop_ids.includes(shop.id) ? ' is-on' : ''}`}
              onClick={() => toggle(shop.id)}
              title={shop.city ?? undefined}
            >
              {shop.name}
            </button>
          ))}
        </div>
      )}

      <p className="muted wizard__hint">
        {draft.shop_ids.length === 0
          ? 'Aucune boutique sélectionnée'
          : `${draft.shop_ids.length} boutique${draft.shop_ids.length > 1 ? 's' : ''} sélectionnée${draft.shop_ids.length > 1 ? 's' : ''}`}
      </p>
    </>
  )
}

function BudgetStep({ draft, patch }: StepProps) {
  return (
    <>
      <h2>Budget</h2>
      <p className="muted">
        Le budget alloué. L’engagé se remplit ensuite depuis le grand livre du fonds, il ne se
        saisit pas ici.
      </p>
      <label className="field">
        Budget alloué (€)
        <input
          type="number"
          min={0}
          step={100}
          value={draft.budget_amount}
          onChange={(e) => patch({ budget_amount: e.target.value })}
        />
      </label>
    </>
  )
}

function TargetsStep({ refs, draft, patch }: StepProps & { refs: References }) {
  return (
    <>
      <h2>Objectifs par levier</h2>
      <p className="muted">
        Facultatif. Les leviers renseignés ici alimentent le ROI mesuré ; ceux laissés vides ne
        sont pas rattachés à la campagne.
      </p>
      <div className="table-scroll">
        <table>
          <tbody>
            {refs.levers.map((lever) => (
              <tr key={lever.id}>
                <td>
                  <span className="chip chip--lever">
                    <span className="dot" style={{ background: lever.color_hex }} />
                    {lever.label}
                  </span>
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    step={100}
                    placeholder="0"
                    value={draft.targets[lever.id] ?? ''}
                    onChange={(e) =>
                      patch({ targets: { ...draft.targets, [lever.id]: e.target.value } })
                    }
                  />
                </td>
                <td className="muted">€ visés</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ChannelsStep({
  refs,
  agencies,
  draft,
  patch,
}: StepProps & { refs: References; agencies: Array<{ id: number; name: string }> }) {
  const toggle = (channelId: number) => {
    const next = { ...draft.channels }
    if (channelId in next) {
      delete next[channelId]
    } else {
      next[channelId] = { budget: '', agencyId: null }
    }
    patch({ channels: next })
  }

  const update = (channelId: number, change: Partial<{ budget: string; agencyId: number | null }>) =>
    patch({
      channels: { ...draft.channels, [channelId]: { ...draft.channels[channelId], ...change } },
    })

  const families: Array<{ key: 'PHYSIQUE' | 'DIGITAL'; label: string }> = [
    { key: 'PHYSIQUE', label: 'Supports physiques' },
    { key: 'DIGITAL', label: 'Canaux digitaux' },
  ]

  return (
    <>
      <h2>Diffusion</h2>
      <p className="muted">
        Les canaux activés ici alimentent les écrans « Pub physique » et « Pub digitale ».
      </p>

      {families.map((family) => (
        <div key={family.key}>
          <h3>{family.label}</h3>
          <div className="table-scroll">
            <table>
              <tbody>
                {refs.channels
                  .filter((channel) => channel.family === family.key)
                  .map((channel) => {
                    const entry = draft.channels[channel.id]

                    return (
                      <tr key={channel.id}>
                        <td>
                          <label className="field">
                            <input
                              type="checkbox"
                              checked={entry !== undefined}
                              onChange={() => toggle(channel.id)}
                            />
                            {channel.label}
                          </label>
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            min={0}
                            step={50}
                            placeholder="Budget €"
                            disabled={entry === undefined}
                            value={entry?.budget ?? ''}
                            onChange={(e) => update(channel.id, { budget: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            disabled={entry === undefined}
                            value={entry?.agencyId ?? ''}
                            onChange={(e) =>
                              update(channel.id, {
                                agencyId: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          >
                            <option value="">Interne</option>
                            {agencies.map((agency) => (
                              <option key={agency.id} value={agency.id}>
                                {agency.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  )
}

function ReviewStep({
  refs,
  shops,
  draft,
  patch,
}: StepProps & {
  refs: References
  shops: Array<{ id: number; name: string }>
}) {
  const type = refs.campaignTypes.find((entry) => entry.id === draft.type_id)
  const chosenShops = shops.filter((shop) => draft.shop_ids.includes(shop.id))
  const channelCount = Object.keys(draft.channels).length
  const targetTotal = Object.values(draft.targets)
    .filter((value) => value !== '')
    .reduce((sum, value) => sum + Number(value), 0)

  return (
    <>
      <h2>Récapitulatif</h2>

      <div className="table-scroll">
        <table>
          <tbody>
            <tr>
              <td className="muted">Nom</td>
              <td>{draft.name}</td>
            </tr>
            <tr>
              <td className="muted">Type</td>
              <td>{type?.label ?? '—'}</td>
            </tr>
            <tr>
              <td className="muted">Cible client</td>
              <td>
                {CLIENT_TARGETS.find((t) => t.value === draft.client_target)?.label ?? '—'}
              </td>
            </tr>
            <tr>
              <td className="muted">Période</td>
              <td>
                {formatDate(draft.starts_on || null)} → {formatDate(draft.ends_on || null)}
              </td>
            </tr>
            <tr>
              <td className="muted">Périmètre</td>
              <td>
                {draft.scope === 'RESEAU'
                  ? 'Réseau'
                  : chosenShops.map((shop) => shop.name).join(', ') || '—'}
              </td>
            </tr>
            <tr>
              <td className="muted">Budget</td>
              <td>{formatEur(Number(draft.budget_amount || 0))}</td>
            </tr>
            <tr>
              <td className="muted">Objectifs</td>
              <td>{targetTotal === 0 ? 'Aucun' : formatEur(targetTotal)}</td>
            </tr>
            <tr>
              <td className="muted">Canaux</td>
              <td>{channelCount === 0 ? 'Aucun' : `${channelCount} activé(s)`}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="filters__row">
        <label className="field">
          État à la création
          <select
            value={draft.status_code}
            onChange={(e) => patch({ status_code: e.target.value })}
          >
            {refs.campaignStatuses.map((status) => (
              <option key={status.code} value={status.code}>
                {status.label}
              </option>
            ))}
          </select>
        </label>

        {/* Sans cible professionnelle, il n'y a pas de lead à générer. */}
        {draft.client_target !== 'b2c' ? (
          <label className="field">
            <input
              type="checkbox"
              checked={draft.create_crm_leads}
              onChange={(e) => patch({ create_crm_leads: e.target.checked })}
            />
            Générer les leads B2B à partir des secteurs
          </label>
        ) : null}
      </div>
    </>
  )
}
