import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync, formatDate, formatEur } from '../../lib/useAsync'
import type { CampaignDraft, ClientTarget, References } from '../../lib/api/module'
import type { Role } from '../../lib/navigation'
import { describeError } from '../../state/auth'

/**
 * Assistant de création de campagne, en sept étapes.
 *
 * Le découpage suit celui de la maquette de référence
 * (design_handoff_marketing_franchise/design/Reseau.dc.html) : cadrage, offre,
 * objectifs, communication, planning, validation, leads. Ce n'est pas un ordre
 * arbitraire — chaque étape a besoin de la précédente : on ne brieffe pas une
 * agence sans savoir ce qu'on vend, on ne planifie pas sans date de lancement.
 *
 * Le brouillon vit ici et n'est envoyé qu'à la dernière étape : le serveur écrit
 * la campagne et l'ensemble de ses rattachements dans une seule transaction.
 * Enregistrer étape par étape aurait laissé des campagnes à moitié montées dès
 * la première interruption.
 *
 * Chaque étape déclare ce qui lui manque plutôt que de bloquer sans dire quoi :
 * une flèche grisée sans explication est la première cause d'abandon.
 */

interface RetroStep {
  label: string
  days_before_launch: number
  position_id: number | null
}

/** Brouillon en cours de saisie. Les nombres restent des chaînes tant qu'on tape. */
interface Draft {
  // 1 — Type & cadrage
  name: string
  starts_on: string
  ends_on: string
  type_id: number | null
  scope: 'RESEAU' | 'LOCALE'
  shop_ids: number[]
  tone: string
  client_target: ClientTarget
  sector_ids: number[]
  agency_ask_ids: number[]
  agency_note: string

  // 2 — Offre
  offer_template_id: number | null
  offer_title: string
  offer_mechanic: string
  offer_items: string[]
  offer_from: string
  offer_to: string
  offer_all_day: boolean
  offer_hour_from: string
  offer_hour_to: string

  // 3 — Objectifs & budget
  budget_amount: string
  objective_coef_pct: string
  targets: Record<number, string>

  // 4 — Communication
  channels: Record<number, { budget: string; agencyId: number | null }>
  uniform_ids: number[]
  b2b_webshop_enabled: boolean
  b2b_option_ids: number[]
  image_url: string
  focal_point_y: number
  format_ids: number[]

  // 5 — Planning
  retro: RetroStep[]

  // 6 / 7
  status_code: string
  create_crm_leads: boolean
}

function emptyDraft(refs: References, role: Role): Draft {
  return {
    name: '',
    starts_on: '',
    ends_on: '',
    type_id: null,
    // Un franchisé ne crée que des campagnes locales : le serveur le lui
    // imposerait de toute façon en refusant les boutiques hors périmètre.
    scope: role === 'FRANCHISEE' ? 'LOCALE' : 'RESEAU',
    shop_ids: [],
    tone: '',
    client_target: 'b2c',
    sector_ids: [],
    agency_ask_ids: [],
    agency_note: '',

    offer_template_id: null,
    offer_title: '',
    offer_mechanic: '',
    offer_items: [],
    offer_from: '',
    offer_to: '',
    offer_all_day: true,
    offer_hour_from: '',
    offer_hour_to: '',

    budget_amount: '',
    objective_coef_pct: '',
    targets: {},

    channels: {},
    uniform_ids: [],
    b2b_webshop_enabled: false,
    b2b_option_ids: [],
    image_url: '',
    focal_point_y: 50,
    format_ids: refs.formats.map((format) => format.id),

    // Le rétroplanning type vient de la base et reste modifiable : ce sont des
    // délais de métier, pas une règle.
    retro: refs.retroplanningDefaults.map((step) => ({
      label: step.label,
      days_before_launch: step.days_before_launch,
      position_id: step.position_id,
    })),

    status_code: 'draft',
    create_crm_leads: false,
  }
}

interface Step {
  key: string
  label: string
  /** Ce qui manque pour passer à la suite. `null` = étape complète. */
  blocking: (draft: Draft) => string | null
}

const STEPS: Step[] = [
  {
    key: 'framing',
    label: 'Type & cadrage',
    blocking: (d) => {
      if (d.type_id === null) return 'Choisissez un type de campagne.'
      if (d.name.trim() === '') return 'Donnez un nom à la campagne.'
      if (d.starts_on !== '' && d.ends_on !== '' && d.ends_on < d.starts_on) {
        return 'La date de fin précède la date de début.'
      }
      if (d.scope === 'LOCALE' && d.shop_ids.length === 0) {
        return 'Une campagne locale doit désigner au moins une boutique.'
      }
      return null
    },
  },
  {
    key: 'offer',
    label: 'Offre',
    blocking: (d) => {
      // L'offre reste facultative — toutes les campagnes n'en portent pas —
      // mais une fenêtre à l'envers ou un horaire incomplet sont des erreurs.
      if (d.offer_from !== '' && d.offer_to !== '' && d.offer_to < d.offer_from) {
        return 'La fin de l’offre précède son début.'
      }
      if (!d.offer_all_day && (d.offer_hour_from === '' || d.offer_hour_to === '')) {
        return 'Précisez la plage horaire, ou revenez sur « toute la journée ».'
      }
      if (d.offer_items.some((item) => item.trim() !== '') && d.offer_title.trim() === '') {
        return 'Nommez l’offre pour pouvoir lui rattacher des éléments.'
      }
      return null
    },
  },
  {
    key: 'budget',
    label: 'Objectifs & budget',
    blocking: (d) =>
      d.budget_amount !== '' && Number(d.budget_amount) < 0
        ? 'Le budget ne peut pas être négatif.'
        : null,
  },
  {
    key: 'communication',
    label: 'Communication',
    blocking: (d) =>
      d.image_url.trim() !== '' && d.format_ids.length === 0
        ? 'Choisissez au moins un format à décliner, ou retirez le visuel.'
        : null,
  },
  {
    key: 'planning',
    label: 'Planning',
    blocking: (d) =>
      d.retro.some((step) => step.label.trim() === '')
        ? 'Un jalon sans intitulé ne veut rien dire : nommez-le ou retirez-le.'
        : null,
  },
  { key: 'review', label: 'Récap & validation', blocking: () => null },
  { key: 'leads', label: 'Leads CRM', blocking: () => null },
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
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(refs, role))
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

  const shared = { draft, patch, refs }

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

      {/* Le récapitulatif suit dès la deuxième étape : il évite de revenir en
          arrière pour vérifier un choix, et rend visible ce qui est acquis. */}
      {step > 0 ? <RunningRecap {...shared} shops={shops.data ?? []} /> : null}

      <section className="card">
        {step === 0 ? <FramingStep {...shared} role={role} shops={shops.data ?? []} /> : null}
        {step === 1 ? <OfferStep {...shared} /> : null}
        {step === 2 ? <BudgetStep {...shared} /> : null}
        {step === 3 ? <CommunicationStep {...shared} agencies={agencies.data ?? []} /> : null}
        {step === 4 ? <PlanningStep {...shared} /> : null}
        {step === 5 ? <ReviewStep {...shared} shops={shops.data ?? []} /> : null}
        {step === 6 ? <LeadsStep {...shared} /> : null}
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
            Étape suivante
          </button>
        ) : (
          <button type="button" className="filter is-on" onClick={submit} disabled={submitting}>
            {submitting ? 'Création…' : 'Lancer la campagne'}
          </button>
        )}
      </div>
    </>
  )
}

/** Brouillon → corps de requête. Les champs vides deviennent `null`, pas `""`. */
function toPayload(draft: Draft, brandId: number | 'all'): CampaignDraft {
  const items = draft.offer_items.map((item) => item.trim()).filter((item) => item !== '')

  return {
    // Omise quand le sélecteur est sur « toutes marques » : le serveur la
    // déduit, et refuse explicitement si plusieurs enseignes sont actives.
    brand_id: brandId === 'all' ? null : brandId,
    name: draft.name.trim(),
    type_id: draft.type_id,
    scope: draft.scope,
    client_target: draft.client_target,
    tone: draft.tone || null,
    status_code: draft.status_code,
    starts_on: draft.starts_on || null,
    ends_on: draft.ends_on || null,
    budget_amount: draft.budget_amount === '' ? 0 : Number(draft.budget_amount),
    objective_coef_pct: draft.objective_coef_pct === '' ? null : Number(draft.objective_coef_pct),
    agency_note: draft.agency_note.trim() || null,
    b2b_webshop_enabled: draft.b2b_webshop_enabled,
    image_url: draft.image_url.trim() || null,
    focal_point_y: draft.image_url.trim() === '' ? null : draft.focal_point_y,
    create_crm_leads: draft.create_crm_leads,

    shop_ids: draft.scope === 'LOCALE' ? draft.shop_ids : [],
    // Les secteurs ne concernent qu'une cible professionnelle : les envoyer
    // pour une campagne B2C peuplerait un entonnoir que rien n'alimente.
    sector_ids: draft.client_target === 'b2c' ? [] : draft.sector_ids,
    agency_ask_ids: draft.agency_ask_ids,
    b2b_option_ids: draft.b2b_webshop_enabled ? draft.b2b_option_ids : [],
    uniform_ids: draft.uniform_ids,
    format_ids: draft.image_url.trim() === '' ? [] : draft.format_ids,

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
    retroplanning: draft.retro
      .filter((entry) => entry.label.trim() !== '')
      .map((entry) => ({
        label: entry.label.trim(),
        days_before_launch: entry.days_before_launch,
        position_id: entry.position_id,
      })),
    offer:
      draft.offer_title.trim() === ''
        ? undefined
        : {
            title: draft.offer_title.trim(),
            template_id: draft.offer_template_id,
            mechanic_text: draft.offer_mechanic.trim() || null,
            starts_on: draft.offer_from || null,
            ends_on: draft.offer_to || null,
            all_day: draft.offer_all_day,
            hour_from: draft.offer_all_day ? null : draft.offer_hour_from || null,
            hour_to: draft.offer_all_day ? null : draft.offer_hour_to || null,
            items,
          },
  }
}

// ---------------------------------------------------------------------------
// Communs
// ---------------------------------------------------------------------------

type StepProps = {
  draft: Draft
  patch: (change: Partial<Draft>) => void
  refs: References
}

/** Cibles client, telles que la maquette les propose. */
const CLIENT_TARGETS: Array<{ value: ClientTarget; label: string }> = [
  { value: 'b2c', label: 'B2C — particuliers' },
  { value: 'b2b', label: 'B2B — professionnels' },
  { value: 'mixte', label: 'Mixte B2C + B2B' },
]

/** Bascule un identifiant dans une liste. Le geste revient à chaque étape. */
function toggle(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]
}

function ChipList({
  items,
  selected,
  onToggle,
}: {
  items: Array<{ id: number; label: string; hint?: string }>
  selected: number[]
  onToggle: (id: number) => void
}) {
  return (
    <div className="filters__row">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`filter${selected.includes(item.id) ? ' is-on' : ''}`}
          onClick={() => onToggle(item.id)}
          title={item.hint}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** Ce qui est déjà décidé, rappelé en haut des étapes suivantes. */
function RunningRecap({
  draft,
  refs,
  shops,
}: StepProps & { shops: Array<{ id: number; name: string }> }) {
  const type = refs.campaignTypes.find((entry) => entry.id === draft.type_id)
  const tone = refs.tones.find((entry) => entry.code === draft.tone)
  const target = CLIENT_TARGETS.find((entry) => entry.value === draft.client_target)

  const entries: Array<[string, string]> = [
    ['Type', type?.label ?? '—'],
    ['Levier', type?.lever_label ?? '—'],
    [
      'Portée',
      draft.scope === 'RESEAU'
        ? 'Réseau'
        : shops
            .filter((shop) => draft.shop_ids.includes(shop.id))
            .map((shop) => shop.name)
            .join(', ') || '—',
    ],
    ['Ton', tone?.label ?? '—'],
    [
      'Cible',
      draft.client_target === 'b2c' || draft.sector_ids.length === 0
        ? (target?.label ?? '—')
        : `${target?.label} · ${draft.sector_ids.length} secteur${draft.sector_ids.length > 1 ? 's' : ''}`,
    ],
  ]

  if (draft.agency_ask_ids.length > 0) {
    entries.push([
      'Agence',
      `${draft.agency_ask_ids.length} demande${draft.agency_ask_ids.length > 1 ? 's' : ''}`,
    ])
  }

  return (
    <ul className="recap-strip">
      {entries.map(([key, value]) => (
        <li key={key}>
          <span className="muted">{key}</span>
          <strong>{value}</strong>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// 1 — Type & cadrage
// ---------------------------------------------------------------------------

function FramingStep({
  refs,
  role,
  shops,
  draft,
  patch,
}: StepProps & { role: Role; shops: Array<{ id: number; name: string; city: string | null }> }) {
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

      <h3 className="section-label">Identité & période</h3>
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
      </div>

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
        <p className="muted">Une boutique crée des campagnes locales : la portée est fixée.</p>
      )}

      {draft.scope === 'LOCALE' ? (
        shops.length === 0 ? (
          <p className="muted">Aucune boutique dans votre périmètre.</p>
        ) : (
          <>
            <ChipList
              items={shops.map((shop) => ({
                id: shop.id,
                label: shop.name,
                hint: shop.city ?? undefined,
              }))}
              selected={draft.shop_ids}
              onToggle={(id) => patch({ shop_ids: toggle(draft.shop_ids, id) })}
            />
            <p className="muted wizard__hint">
              {draft.shop_ids.length === 0
                ? 'Aucune boutique sélectionnée'
                : `${draft.shop_ids.length} boutique${draft.shop_ids.length > 1 ? 's' : ''} sélectionnée${draft.shop_ids.length > 1 ? 's' : ''}`}
            </p>
          </>
        )
      ) : null}

      <h3 className="section-label">Ton</h3>
      <ChipList
        items={refs.tones.map((tone) => ({ id: tone.id, label: tone.label }))}
        selected={refs.tones.filter((t) => t.code === draft.tone).map((t) => t.id)}
        onToggle={(id) => {
          const picked = refs.tones.find((tone) => tone.id === id)
          // Choix unique : recliquer sur le ton retenu le retire.
          patch({ tone: picked && picked.code !== draft.tone ? picked.code : '' })
        }}
      />

      <h3 className="section-label">Cible client</h3>
      <div className="choice-row">
        {CLIENT_TARGETS.map((target) => (
          <button
            key={target.value}
            type="button"
            className={`choice-pill${draft.client_target === target.value ? ' is-on' : ''}`}
            // Une campagne B2C n'a ni secteur ni lead : garder les choix
            // précédents laisserait un entonnoir que rien n'alimente.
            onClick={() =>
              patch({
                client_target: target.value,
                sector_ids: target.value === 'b2c' ? [] : draft.sector_ids,
                create_crm_leads: target.value === 'b2c' ? false : draft.create_crm_leads,
              })
            }
          >
            {target.label}
          </button>
        ))}
      </div>

      {draft.client_target !== 'b2c' ? (
        <>
          <h3 className="section-label">Secteurs visés</h3>
          <ChipList
            items={refs.b2bSectors.map((sector) => ({
              id: sector.id,
              label: `${sector.label} · ${sector.estimated_leads_count}`,
              hint: `${sector.estimated_leads_count} comptes estimés`,
            }))}
            selected={draft.sector_ids}
            onToggle={(id) => patch({ sector_ids: toggle(draft.sector_ids, id) })}
          />
          <p className="muted wizard__hint">
            {refs.b2bSectors
              .filter((sector) => draft.sector_ids.includes(sector.id))
              .reduce((sum, sector) => sum + sector.estimated_leads_count, 0)}{' '}
            comptes estimés sur les secteurs retenus
          </p>
        </>
      ) : null}

      <h3 className="section-label">Demandes à l’agence</h3>
      <ChipList
        items={refs.agencyAsks.map((ask) => ({ id: ask.id, label: ask.label }))}
        selected={draft.agency_ask_ids}
        onToggle={(id) => patch({ agency_ask_ids: toggle(draft.agency_ask_ids, id) })}
      />
      <label className="field field--block">
        Complément au brief
        <textarea
          rows={3}
          value={draft.agency_note}
          placeholder="Contexte, contraintes, références…"
          onChange={(e) => patch({ agency_note: e.target.value })}
        />
      </label>
    </>
  )
}

// ---------------------------------------------------------------------------
// 2 — Offre
// ---------------------------------------------------------------------------

function OfferStep({ refs, draft, patch }: StepProps) {
  const setItem = (index: number, value: string) => {
    const items = [...draft.offer_items]
    items[index] = value
    patch({ offer_items: items })
  }

  return (
    <>
      <h2>Offre</h2>
      <p className="muted">
        Facultative : toutes les campagnes n’en portent pas. Sa fenêtre est distincte de la
        période de campagne — une promotion peut ne courir que sur une partie de l’opération.
      </p>

      <h3 className="section-label">Modèle</h3>
      <div className="choice-row">
        {refs.offerTemplates.map((template) => (
          <button
            key={template.id}
            type="button"
            className={`choice-card${draft.offer_template_id === template.id ? ' is-on' : ''}`}
            onClick={() =>
              patch({
                offer_template_id: draft.offer_template_id === template.id ? null : template.id,
                offer_title: draft.offer_title === '' ? template.label : draft.offer_title,
              })
            }
          >
            <strong>{template.label}</strong>
            {template.description ? <span className="muted">{template.description}</span> : null}
          </button>
        ))}
      </div>

      <h3 className="section-label">Contenu</h3>
      <div className="filters__row">
        <label className="field">
          Intitulé
          <input
            type="text"
            value={draft.offer_title}
            placeholder="Menu Barbecue"
            onChange={(e) => patch({ offer_title: e.target.value })}
          />
        </label>
        <label className="field field--grow">
          Mécanique
          <input
            type="text"
            value={draft.offer_mechanic}
            placeholder="Plat + boisson + dessert à 12 €"
            onChange={(e) => patch({ offer_mechanic: e.target.value })}
          />
        </label>
      </div>

      {/* Le catalogue produit vient de l'ERP et n'est pas encore importé : les
          éléments se saisissent en clair, et se rattacheront à des références
          le jour où l'import existe (mar_campaign_offer_item.offer_item_id). */}
      <ul className="line-list">
        {draft.offer_items.map((item, index) => (
          <li key={index}>
            <input
              type="text"
              value={item}
              placeholder="Élément de l’offre"
              onChange={(e) => setItem(index, e.target.value)}
            />
            <button
              type="button"
              className="filter"
              onClick={() =>
                patch({ offer_items: draft.offer_items.filter((_, i) => i !== index) })
              }
            >
              Retirer
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="filter"
        onClick={() => patch({ offer_items: [...draft.offer_items, ''] })}
      >
        + Ajouter un élément
      </button>

      <h3 className="section-label">Fenêtre</h3>
      <div className="filters__row">
        <label className="field">
          Du
          <input
            type="date"
            value={draft.offer_from}
            onChange={(e) => patch({ offer_from: e.target.value })}
          />
        </label>
        <label className="field">
          Au
          <input
            type="date"
            value={draft.offer_to}
            onChange={(e) => patch({ offer_to: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="filter"
          onClick={() => patch({ offer_from: draft.starts_on, offer_to: draft.ends_on })}
          disabled={draft.starts_on === '' && draft.ends_on === ''}
        >
          Reprendre la période de campagne
        </button>
      </div>

      <h3 className="section-label">Horaire</h3>
      <div className="filters__row">
        <button
          type="button"
          className={`choice-pill${draft.offer_all_day ? ' is-on' : ''}`}
          onClick={() => patch({ offer_all_day: true })}
        >
          Toute la journée
        </button>
        <button
          type="button"
          className={`choice-pill${!draft.offer_all_day ? ' is-on' : ''}`}
          onClick={() => patch({ offer_all_day: false })}
        >
          Plage horaire
        </button>

        {!draft.offer_all_day ? (
          <>
            <label className="field">
              De
              <input
                type="time"
                value={draft.offer_hour_from}
                onChange={(e) => patch({ offer_hour_from: e.target.value })}
              />
            </label>
            <label className="field">
              À
              <input
                type="time"
                value={draft.offer_hour_to}
                onChange={(e) => patch({ offer_hour_to: e.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 3 — Objectifs & budget
// ---------------------------------------------------------------------------

function BudgetStep({ refs, draft, patch }: StepProps) {
  return (
    <>
      <h2>Objectifs & budget</h2>
      <p className="muted">
        L’engagé se remplit ensuite depuis le grand livre du fonds, il ne se saisit pas ici.
      </p>

      <div className="filters__row">
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
        <label className="field">
          Objectif — écart au N-1 (%)
          <input
            type="number"
            step={1}
            placeholder="12"
            value={draft.objective_coef_pct}
            onChange={(e) => patch({ objective_coef_pct: e.target.value })}
          />
        </label>
      </div>
      <p className="muted wizard__hint">
        {draft.objective_coef_pct === ''
          ? 'Aucun objectif d’écart : le suivi se fera sur les valeurs absolues ci-dessous.'
          : `Objectif : N-1 ${Number(draft.objective_coef_pct) < 0 ? '−' : '+'} ${Math.abs(Number(draft.objective_coef_pct))} %`}
      </p>

      <h3 className="section-label">Objectifs par levier</h3>
      <p className="muted">
        Facultatif. Les leviers renseignés alimentent le ROI mesuré ; ceux laissés vides ne
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

// ---------------------------------------------------------------------------
// 4 — Communication
// ---------------------------------------------------------------------------

function CommunicationStep({
  refs,
  draft,
  patch,
  agencies,
}: StepProps & { agencies: Array<{ id: number; name: string }> }) {
  const toggleChannel = (channelId: number) => {
    const next = { ...draft.channels }
    if (channelId in next) {
      delete next[channelId]
    } else {
      next[channelId] = { budget: '', agencyId: null }
    }
    patch({ channels: next })
  }

  const updateChannel = (
    channelId: number,
    change: Partial<{ budget: string; agencyId: number | null }>,
  ) =>
    patch({
      channels: { ...draft.channels, [channelId]: { ...draft.channels[channelId], ...change } },
    })

  const families: Array<{ key: 'PHYSIQUE' | 'DIGITAL'; label: string }> = [
    { key: 'PHYSIQUE', label: 'Supports physiques' },
    { key: 'DIGITAL', label: 'Canaux digitaux' },
  ]

  return (
    <>
      <h2>Communication</h2>
      <p className="muted">
        Les canaux activés ici alimentent les écrans « Pub physique » et « Pub digitale ».
      </p>

      {families.map((family) => (
        <div key={family.key}>
          <h3 className="section-label">{family.label}</h3>
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
                              onChange={() => toggleChannel(channel.id)}
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
                            onChange={(e) => updateChannel(channel.id, { budget: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            disabled={entry === undefined}
                            value={entry?.agencyId ?? ''}
                            onChange={(e) =>
                              updateChannel(channel.id, {
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

      <h3 className="section-label">Tenues & accessoires terrain</h3>
      <ChipList
        items={refs.uniforms.map((uniform) => ({
          id: uniform.id,
          label: uniform.name,
          hint: uniform.description ?? undefined,
        }))}
        selected={draft.uniform_ids}
        onToggle={(id) => patch({ uniform_ids: toggle(draft.uniform_ids, id) })}
      />

      {draft.client_target !== 'b2c' ? (
        <>
          <h3 className="section-label">Web-shop B2B</h3>
          <div className="filters__row">
            <button
              type="button"
              className={`choice-pill${!draft.b2b_webshop_enabled ? ' is-on' : ''}`}
              onClick={() => patch({ b2b_webshop_enabled: false })}
            >
              Standard
            </button>
            <button
              type="button"
              className={`choice-pill${draft.b2b_webshop_enabled ? ' is-on' : ''}`}
              onClick={() => patch({ b2b_webshop_enabled: true })}
            >
              Personnalisé
            </button>
          </div>

          {draft.b2b_webshop_enabled ? (
            <ul className="option-grid">
              {refs.b2bOptions.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className={`choice-card${draft.b2b_option_ids.includes(option.id) ? ' is-on' : ''}`}
                    onClick={() =>
                      patch({ b2b_option_ids: toggle(draft.b2b_option_ids, option.id) })
                    }
                  >
                    <strong>{option.label}</strong>
                    {option.description ? (
                      <span className="muted">{option.description}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <h3 className="section-label">Visuel & déclinaisons</h3>
      <div className="filters__row">
        <label className="field field--grow">
          Visuel (URL)
          <input
            type="url"
            value={draft.image_url}
            placeholder="https://…"
            onChange={(e) => patch({ image_url: e.target.value })}
          />
        </label>
      </div>

      {draft.image_url.trim() !== '' ? (
        <>
          <label className="field field--grow">
            Cadrage vertical — {Math.round(draft.focal_point_y)} %
            <input
              type="range"
              min={0}
              max={100}
              value={draft.focal_point_y}
              onChange={(e) => patch({ focal_point_y: Number(e.target.value) })}
            />
          </label>
          <p className="muted">
            Un seul visuel, recadré par format. Le point focal évite que le sujet sorte du cadre
            dans les formats les plus étroits.
          </p>

          <ul className="format-grid">
            {refs.formats.map((format) => {
              const on = draft.format_ids.includes(format.id)

              return (
                <li key={format.id}>
                  <button
                    type="button"
                    className={`format-card${on ? ' is-on' : ''}`}
                    onClick={() => patch({ format_ids: toggle(draft.format_ids, format.id) })}
                  >
                    <span
                      className="format-card__preview"
                      style={{ aspectRatio: `${format.width_px} / ${format.height_px}` }}
                    >
                      <img
                        src={draft.image_url}
                        alt=""
                        style={{ objectPosition: `50% ${draft.focal_point_y}%` }}
                      />
                    </span>
                    <strong>{format.name}</strong>
                    <span className="muted">
                      {format.width_px} × {format.height_px}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="muted wizard__hint">
            {draft.format_ids.length} format{draft.format_ids.length > 1 ? 's' : ''} à produire.
            Les déclinaisons sont créées en attente : rien n’est fabriqué maintenant.
          </p>
        </>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// 5 — Planning
// ---------------------------------------------------------------------------

/** Date de début moins `n` jours. `—` tant que la campagne n'a pas de départ. */
function dateMinusDays(startsOn: string, days: number): string {
  if (startsOn === '') return '—'

  const date = new Date(`${startsOn}T00:00:00`)
  date.setDate(date.getDate() - days)

  return formatDate(date.toISOString().slice(0, 10))
}

function PlanningStep({ refs, draft, patch }: StepProps) {
  const update = (index: number, change: Partial<RetroStep>) => {
    const retro = [...draft.retro]
    retro[index] = { ...retro[index], ...change }
    patch({ retro })
  }

  return (
    <>
      <h2>Rétroplanning</h2>
      <p className="muted">
        Les jalons sont comptés en jours avant le lancement. La date affichée se déduit de la
        date de début de campagne — elle bouge avec elle plutôt que d’être figée.
      </p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Jalon</th>
              <th className="num">J −</th>
              <th>Date</th>
              <th>Responsable</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.retro.map((step, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="text"
                    className="input--grow"
                    value={step.label}
                    onChange={(e) => update(index, { label: e.target.value })}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    value={step.days_before_launch}
                    onChange={(e) =>
                      update(index, { days_before_launch: Number(e.target.value) || 0 })
                    }
                  />
                </td>
                <td className="muted">{dateMinusDays(draft.starts_on, step.days_before_launch)}</td>
                <td>
                  <select
                    value={step.position_id ?? ''}
                    onChange={(e) =>
                      update(index, {
                        position_id: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">—</option>
                    {refs.positions.map((position) => (
                      <option key={position.id} value={position.id}>
                        {position.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="filter"
                    onClick={() => patch({ retro: draft.retro.filter((_, i) => i !== index) })}
                  >
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="filter"
        onClick={() =>
          patch({ retro: [...draft.retro, { label: '', days_before_launch: 0, position_id: null }] })
        }
      >
        + Ajouter un jalon
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// 6 — Récap & validation
// ---------------------------------------------------------------------------

function ReviewStep({
  refs,
  shops,
  draft,
  patch,
}: StepProps & { shops: Array<{ id: number; name: string }> }) {
  const type = refs.campaignTypes.find((entry) => entry.id === draft.type_id)
  const tone = refs.tones.find((entry) => entry.code === draft.tone)
  const chosenShops = shops.filter((shop) => draft.shop_ids.includes(shop.id))
  const channelCount = Object.keys(draft.channels).length
  const targetTotal = Object.values(draft.targets)
    .filter((value) => value !== '')
    .reduce((sum, value) => sum + Number(value), 0)
  const items = draft.offer_items.filter((item) => item.trim() !== '')

  const rows: Array<[string, string]> = [
    ['Nom', draft.name],
    ['Type', type?.label ?? '—'],
    ['Ton', tone?.label ?? '—'],
    ['Cible client', CLIENT_TARGETS.find((t) => t.value === draft.client_target)?.label ?? '—'],
    ['Période', `${formatDate(draft.starts_on || null)} → ${formatDate(draft.ends_on || null)}`],
    [
      'Portée',
      draft.scope === 'RESEAU'
        ? 'Réseau'
        : chosenShops.map((shop) => shop.name).join(', ') || '—',
    ],
    [
      'Offre',
      draft.offer_title.trim() === ''
        ? 'Aucune'
        : `${draft.offer_title} · ${items.length} élément${items.length > 1 ? 's' : ''}`,
    ],
    [
      'Fenêtre de l’offre',
      draft.offer_from === '' && draft.offer_to === ''
        ? '—'
        : `${formatDate(draft.offer_from || null)} → ${formatDate(draft.offer_to || null)}`,
    ],
    [
      'Horaire',
      draft.offer_all_day
        ? 'Toute la journée'
        : `${draft.offer_hour_from || '—'} – ${draft.offer_hour_to || '—'}`,
    ],
    ['Budget', formatEur(Number(draft.budget_amount || 0))],
    [
      'Objectif',
      draft.objective_coef_pct === ''
        ? targetTotal === 0
          ? 'Aucun'
          : formatEur(targetTotal)
        : `N-1 ${Number(draft.objective_coef_pct) < 0 ? '−' : '+'} ${Math.abs(Number(draft.objective_coef_pct))} %`,
    ],
    ['Canaux', channelCount === 0 ? 'Aucun' : `${channelCount} activé(s)`],
    ['Tenues', draft.uniform_ids.length === 0 ? '—' : `${draft.uniform_ids.length} élément(s)`],
    [
      'Web-shop B2B',
      draft.client_target === 'b2c'
        ? 'Sans objet'
        : draft.b2b_webshop_enabled
          ? `Personnalisé · ${draft.b2b_option_ids.length} option(s)`
          : 'Standard',
    ],
    [
      'Visuels',
      draft.image_url.trim() === ''
        ? 'Aucun'
        : `Photo commune · ${draft.format_ids.length} format(s)`,
    ],
    ['Rétroplanning', `${draft.retro.filter((s) => s.label.trim() !== '').length} étapes`],
    [
      'Demandes agence',
      draft.agency_ask_ids.length === 0 ? '—' : `${draft.agency_ask_ids.length} demande(s)`,
    ],
  ]

  return (
    <>
      <h2>Récapitulatif</h2>

      <div className="table-scroll">
        <table>
          <tbody>
            {rows.map(([key, value]) => (
              <tr key={key}>
                <td className="muted">{key}</td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-label">État à la création</h3>
      <div className="choice-row">
        {refs.campaignStatuses.map((status) => (
          <button
            key={status.code}
            type="button"
            className={`choice-pill${draft.status_code === status.code ? ' is-on' : ''}`}
            onClick={() => patch({ status_code: status.code })}
          >
            {status.label}
          </button>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 7 — Leads CRM
// ---------------------------------------------------------------------------

function LeadsStep({ refs, draft, patch }: StepProps) {
  if (draft.client_target === 'b2c') {
    return (
      <>
        <h2>Leads CRM</h2>
        <p className="muted">
          Campagne B2C : il n’y a pas de compte professionnel à démarcher, donc pas d’entonnoir
          de leads. Revenez à l’étape 1 pour changer la cible si ce n’est pas voulu.
        </p>
      </>
    )
  }

  const sectors = refs.b2bSectors.filter((sector) => draft.sector_ids.includes(sector.id))
  const estimated = sectors.reduce((sum, sector) => sum + sector.estimated_leads_count, 0)

  return (
    <>
      <h2>Leads CRM</h2>
      <p className="muted">
        Les comptes des secteurs retenus sont distribués aux boutiques référentes, à l’état
        « à appeler ». Ils apparaissent ensuite dans le suivi de la campagne.
      </p>

      <div className="filters__row">
        <button
          type="button"
          className={`choice-pill${draft.create_crm_leads ? ' is-on' : ''}`}
          onClick={() => patch({ create_crm_leads: true })}
        >
          Générer les leads
        </button>
        <button
          type="button"
          className={`choice-pill${!draft.create_crm_leads ? ' is-on' : ''}`}
          onClick={() => patch({ create_crm_leads: false })}
        >
          Ne pas générer
        </button>
      </div>

      {sectors.length === 0 ? (
        <p className="muted wizard__hint">
          Aucun secteur retenu à l’étape 1 : rien ne serait généré.
        </p>
      ) : (
        <>
          <ul className="chips">
            {sectors.map((sector) => (
              <li key={sector.id} className="chip chip--lever">
                {sector.label} · {sector.estimated_leads_count}
              </li>
            ))}
          </ul>
          <p className="muted wizard__hint">{estimated} comptes estimés au total.</p>
        </>
      )}
    </>
  )
}
