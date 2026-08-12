import { useState } from 'react'
import { module as api } from '../../lib/api'
import { useAsync, formatDate, formatEur } from '../../lib/useAsync'
import type { CampaignDraft, ClientTarget, ImageFit, OfferItem, References } from '../../lib/api/module'
import type { Role } from '../../lib/navigation'
import { describeError } from '../../state/auth'
import ObjectivesStep from './ObjectivesStep'
import PricingStep from './PricingStep'
import ProspectList from './ProspectList'
import RangeCalendar from './RangeCalendar'

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

interface PosQuestion {
  label: string
  answer_type: string
  options: string
  is_required: boolean
}

interface RetroStep {
  label: string
  days_before_launch: number
  position_id: number | null
}

/**
 * Élément de l'offre : une référence choisie au catalogue repris de l'ERP
 * (`offer_item_id` renseigné), ou une saisie libre pour ce que le catalogue
 * n'a pas (`offer_item_id` nul, le libellé reste éditable).
 */
interface OfferElement {
  offer_item_id: number | null
  label: string

  /**
   * Famille de catalogue : `produit`, `saison`… Une gamme entre dans l'offre
   * comme un produit, mais elle n'a ni prix ni volume — l'étape « Prix » ne
   * doit donc pas lui demander de marge. Vide pour une saisie libre, qui n'est
   * dans aucun catalogue.
   */
  category: string

  /**
   * Promotion posée à l'étape « Prix ». Vide = ce produit n'est pas en
   * promotion, ce qui est le cas par défaut : entrer dans l'offre ne veut pas
   * dire être bradé.
   *
   * Les nombres restent des chaînes tant qu'on tape, comme partout ailleurs
   * dans le brouillon.
   */
  mechanic_type: MechanicCode | ''
  discount_pct: string
  fixed_price: string
  buy_qty: string
  get_qty: string
  /** Prix TTC de référence, figé à la saisie plutôt que relu du catalogue. */
  baseline_price: string
  /** Taux de marge du produit. Vide = suit le taux réseau. */
  margin_pct: string
  /**
   * Objectif réseau de pièces sur ce produit, posé à l'étape « Objectifs de
   * vente ». Vide = aucun objectif sur ce produit : la boutique répond alors
   * du total, sans qu'on lui dise de quoi il est fait.
   */
  target_pieces: string
}

/** Codes de `mar_promotion_mechanic`. */
export type MechanicCode =
  | 'PERCENT'
  | 'CROSSED_PRICE'
  | 'BUY_X_GET_Y'
  | 'BUNDLE_FIXED'
  | 'FREE_DELIVERY'

/** Ligne d'offre neuve : dans l'offre, hors promotion. */
export function blankPricing(): Omit<OfferElement, 'offer_item_id' | 'label' | 'category'> {
  return {
    mechanic_type: '',
    discount_pct: '',
    fixed_price: '',
    buy_qty: '',
    get_qty: '',
    baseline_price: '',
    margin_pct: '',
    target_pieces: '',
  }
}

/** Brouillon en cours de saisie. Les nombres restent des chaînes tant qu'on tape. */
export interface Draft {
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
  offer_items: OfferElement[]

  // 3 — Objectifs (pièces par boutique ; la période n'est qu'une aide d'analyse)
  shop_objectives: Record<number, string>
  analysis_from: string
  analysis_to: string
  analysis_compare: boolean
  /** Progression par produit, en %. Vide = suit sa famille. */
  product_growth: Record<number, string>
  /**
   * Progression par famille de catalogue — « Cougnou », « Bûche » —, en %.
   * Vide = suit la progression générale. Trois niveaux plutôt que deux :
   * régler sept produits un par un pour la même décision est un travail que
   * la famille fait en une fois.
   */
  family_growth: Record<string, string>

  /**
   * Challenge attaché aux objectifs — facultatif : sans lui, chaque magasin
   * ne joue que contre sa propre cible.
   */
  // 3 — Prix
  /** Taux de marge appliqué aux produits qui n'ont pas le leur, en %. */
  margin_pct_default: string
  /** Plafond de pièces en promotion par ticket. Vide = sans limite. */
  max_qty_per_ticket: string
  promo_cumulative: boolean

  challenge_enabled: boolean
  challenge_metric: 'attainment' | 'pieces' | 'growth'
  /** Seuil de participation général, en % de l'objectif de chaque magasin. */
  challenge_trigger_pct: string
  /**
   * Seuil propre à un magasin. Vide = il suit le seuil général — même idiome
   * que la progression par produit, pour qu'il n'y ait qu'une règle à retenir.
   */
  shop_triggers: Record<number, string>
  /** Dotation de chaque rang, en clair. L'index vaut le rang. */
  challenge_prizes: string[]

  // 5 — Budget & leviers
  budget_amount: string
  objective_coef_pct: string
  targets: Record<number, string>

  // 4 — Communication
  channels: Record<number, { budget: string; agencyId: number | null }>
  uniform_ids: number[]
  b2b_webshop_enabled: boolean
  b2b_option_ids: number[]
  pos_survey_enabled: boolean
  pos_questions: PosQuestion[]
  image_url: string
  focal_point_y: number
  /** Rempli et recoupé au point focal, ou contenu entier dans le cadre. */
  image_fit: ImageFit
  format_ids: number[]

  // 5 — Planning
  retro: RetroStep[]

  // 6 / 7
  status_code: string
  create_crm_leads: boolean
}

/** `AAAA-MM-JJ` local — les bornes de la période d'analyse des objectifs. */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function today(): string {
  return isoDate(new Date())
}

function monthStart(): string {
  const now = new Date()

  return isoDate(new Date(now.getFullYear(), now.getMonth(), 1))
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

    shop_objectives: {},
    // Période d'analyse par défaut : le mois en cours.
    analysis_from: monthStart(),
    analysis_to: today(),
    analysis_compare: false,
    product_growth: {},
    family_growth: {},

    margin_pct_default: '68',
    max_qty_per_ticket: '',
    promo_cumulative: false,

    challenge_enabled: false,
    challenge_metric: 'attainment',
    challenge_trigger_pct: '100',
    shop_triggers: {},
    challenge_prizes: ['', '', ''],

    budget_amount: '',
    objective_coef_pct: '',
    targets: {},

    channels: {},
    uniform_ids: [],
    b2b_webshop_enabled: false,
    b2b_option_ids: [],
    pos_survey_enabled: false,
    pos_questions: [],
    image_url: '',
    focal_point_y: 50,
    image_fit: 'cover',
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
    // L'offre reste facultative — toutes les campagnes n'en portent pas — et
    // n'a plus rien à valider : la composition est libre, l'horaire a disparu.
    blocking: () => null,
  },
  {
    key: 'objectives',
    label: 'Objectifs de vente',
    // Jamais bloquante : les objectifs éclairent, ils n'obligent pas. Une
    // campagne sans objectif de pièces reste légitime (offre facultative,
    // budget facultatif — même logique), et la saisie ne laisse passer que
    // des entiers positifs, il n'y a donc rien d'invalide à retenir.
    blocking: () => null,
  },
  {
    // Le prix vient après les objectifs, et non l'inverse : une remise se juge
    // au volume qu'elle doit faire vendre pour se payer, et ce volume est
    // justement ce que l'étape précédente vient de fixer.
    key: 'pricing',
    label: 'Prix',
    blocking: (d) => {
      const casse = d.offer_items.find(
        (item) =>
          item.category === 'produit'
          && item.mechanic_type === 'PERCENT'
          && item.discount_pct.trim() !== ''
          && item.margin_pct.trim() !== ''
          && Number(item.discount_pct) >= Number(item.margin_pct),
      )

      return casse === undefined
        ? null
        : `« ${casse.label} » : une remise de ${casse.discount_pct} % sur une marge de `
          + `${casse.margin_pct} % détruit la marge — aucun volume ne la compense.`
    },
  },
  {
    key: 'budget',
    label: 'Budget & leviers',
    blocking: (d) =>
      d.budget_amount !== '' && Number(d.budget_amount) < 0
        ? 'Le budget ne peut pas être négatif.'
        : null,
  },
  {
    key: 'communication',
    label: 'Communication',
    blocking: (d) => {
      if (d.image_url.trim() !== '' && d.format_ids.length === 0) {
        return 'Choisissez au moins un format à décliner, ou retirez le visuel.'
      }
      // Un questionnaire activé sans question demanderait à la caisse de poser
      // le vide — et l'équipe s'en apercevrait devant le client.
      if (d.pos_survey_enabled && d.pos_questions.every((q) => q.label.trim() === '')) {
        return 'Le questionnaire en caisse est activé : écrivez au moins une question.'
      }
      if (
        d.pos_survey_enabled &&
        d.pos_questions.some((q) => q.answer_type === 'choice' && q.options.trim() === '')
      ) {
        return 'Une question à choix a besoin de ses propositions, une par ligne.'
      }
      return null
    },
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
  campaignId,
  onCreated,
  onCancel,
}: {
  refs: References
  role: Role
  /**
   * Marque courante, telle que la désigne le périmètre lu dans l'adresse.
   * `'all'` — le cas ordinaire d'un réseau mono-enseigne — laisse le serveur la
   * résoudre : dans un back-office, la marque est connue, elle ne se saisit pas.
   */
  brandId: number | 'all'
  /** Brouillon repris. `null` pour une campagne neuve. */
  campaignId: number | null
  onCreated: (campaignId: number) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(refs, role))
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Identifiant de la campagne en base. Posé dès le premier enregistrement,
  // c'est lui qui distingue une création d'une reprise — l'assistant n'a pas à
  // le savoir autrement.
  const [savedId, setSavedId] = useState<number | null>(campaignId)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const shops = useAsync(() => api.listShops(), [])
  const agencies = useAsync(() => api.listAgencies(), [])

  // Reprise : le brouillon est relu une fois, et l'assistant s'ouvre là où il
  // s'était arrêté. Repartir de l'étape 1 ferait retraverser ce qui est fait.
  const loaded = useAsync(
    async () => (campaignId === null ? null : await api.getCampaignDraft(campaignId)),
    [campaignId],
  )

  const [restored, setRestored] = useState(campaignId === null)

  if (!restored && loaded.data) {
    const next = fromState(loaded.data, refs, role)
    setDraft(next)
    setStep(resumeStep(loaded.data.draft_step ?? null, next))
    setRestored(true)
  }

  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }))
  const blocking = STEPS[step].blocking(draft)

  /**
   * Écrit le brouillon en base.
   *
   * Le premier appel crée la campagne, les suivants la réécrivent. Sans cela,
   * le brouillon ne vivrait que dans cet onglet : fermer la fenêtre effacerait
   * une demi-heure de saisie, et « reprendre » n'aurait rien à reprendre.
   */
  async function save(): Promise<number | null> {
    setSaving(true)
    setFailure(null)

    try {
      const payload = toPayload(draft, brandId, STEPS[step].key)

      if (savedId === null) {
        const { inserted_id } = await api.createCampaign({ ...payload, status_code: 'draft' })
        setSavedId(inserted_id)
        setSavedAt(new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }))

        return inserted_id
      }

      await api.replaceCampaignDraft(savedId, { ...payload, status_code: 'draft' })
      setSavedAt(new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }))

      return savedId
    } catch (cause: unknown) {
      setFailure(describeError(cause))

      return null
    } finally {
      setSaving(false)
    }
  }

  async function nextStep() {
    // L'enregistrement précède l'avancée : si l'écriture échoue, on reste sur
    // l'étape dont le contenu vient d'être refusé, pas sur la suivante.
    if ((await save()) === null) {
      return
    }

    setStep(step + 1)
  }

  async function saveAndLeave() {
    if ((await save()) !== null) {
      onCancel()
    }
  }

  async function submit() {
    setSubmitting(true)
    setFailure(null)

    try {
      const id = await save()
      if (id === null) {
        setSubmitting(false)

        return
      }

      // Le statut retenu à l'étape « Récap » n'est posé qu'ici : jusque-là, la
      // campagne reste un brouillon, quelle que soit la case cochée.
      if (draft.status_code !== 'draft') {
        await api.updateCampaign(id, { status_code: draft.status_code })
      }

      if (draft.create_crm_leads) {
        await api.generateLeads(id)
      }

      onCreated(id)
    } catch (cause: unknown) {
      setFailure(describeError(cause))
      setSubmitting(false)
    }
  }

  const shared = { draft, patch, refs }

  // Les étapes se désignent par leur clé et non par leur rang : insérer une
  // étape au milieu décalait tous les numéros, et le rendu affichait l'écran
  // du voisin sans qu'aucun type ne s'en plaigne.
  const here = STEPS[step].key

  return (
    <>
      <button type="button" className="filter back" onClick={onCancel}>
        ← Annuler
      </button>

      {/* Le fil est une carte de ce qui reste, pas seulement un compteur : une
          étape complète est atteignable même si elle est devant, ce qui permet
          de revenir sur le budget d'un brouillon repris sans retraverser six
          écrans. Une étape incomplète placée avant reste barrée — la suivante
          en dépend. */}
      <ol className="wizard__steps">
        {STEPS.map((entry, index) => {
          const done = STEPS[index].blocking(draft) === null
          const reachable = index <= step || STEPS.slice(0, index).every((s) => s.blocking(draft) === null)

          return (
            <li
              key={entry.key}
              className={
                'wizard__step' +
                (index === step ? ' is-on' : '') +
                (index !== step && done ? ' is-done' : '')
              }
            >
              <button
                type="button"
                onClick={() => reachable && setStep(index)}
                disabled={!reachable}
                title={reachable ? undefined : 'Une étape précédente est incomplète.'}
              >
                <span className="wizard__num">{index !== step && done ? '✓' : index + 1}</span>
                {entry.label}
              </button>
            </li>
          )
        })}
      </ol>

      {/* Le récapitulatif suit dès la deuxième étape : il évite de revenir en
          arrière pour vérifier un choix, et rend visible ce qui est acquis. */}
      {step > 0 ? <RunningRecap {...shared} shops={shops.data ?? []} /> : null}

      <div className="wizard-layout">
      <section className="card wizard-card">
        {here === 'framing' ? <FramingStep {...shared} role={role} shops={shops.data ?? []} /> : null}
        {here === 'offer' ? <OfferStep {...shared} /> : null}
        {here === 'objectives' ? <ObjectivesStep {...shared} /> : null}
        {here === 'pricing' ? <PricingStep {...shared} /> : null}
        {here === 'budget' ? <BudgetStep {...shared} /> : null}
        {here === 'communication' ? <CommunicationStep {...shared} agencies={agencies.data ?? []} /> : null}
        {here === 'planning' ? <PlanningStep {...shared} /> : null}
        {here === 'review' ? <ReviewStep {...shared} shops={shops.data ?? []} /> : null}
        {here === 'leads' ? <LeadsStep {...shared} /> : null}
      </section>

      </div>

      {blocking ? <p className="muted wizard__hint">{blocking}</p> : null}
      {failure ? <p className="error">{failure}</p> : null}

      {/* Classe propre, et non la rangée de filtres générique : ces deux-là
          sont des actions, pas des pastilles. Elles héritaient d'un écart de
          8 px et démarraient au ras du bord bas de la carte — « Précédent » et
          « Étape suivante » se touchaient presque, et rien ne séparait la
          décision du formulaire qui la précède. */}
      <div className="wizard-actions">
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
            onClick={nextStep}
            disabled={blocking !== null || saving}
          >
            {saving ? 'Enregistrement…' : 'Étape suivante'}
          </button>
        ) : (
          <button type="button" className="filter is-on" onClick={submit} disabled={submitting}>
            {submitting ? 'Création…' : 'Lancer la campagne'}
          </button>
        )}

        {/* Quitter en cours de route devient normal plutôt qu'accidentel : le
            brouillon est en base, on le retrouve dans la liste. */}
        <button
          type="button"
          className="filter"
          onClick={saveAndLeave}
          disabled={saving || blocking !== null}
          title={blocking ?? 'Enregistrer le brouillon et revenir à la liste'}
        >
          Enregistrer et quitter
        </button>

        {savedAt !== null ? (
          <span className="muted wizard-actions__saved">Brouillon enregistré à {savedAt}</span>
        ) : null}
      </div>
    </>
  )
}

/** Brouillon → corps de requête. Les champs vides deviennent `null`, pas `""`. */
/**
 * Brouillon relu → état de l'assistant.
 *
 * L'inverse de `toPayload`. Les deux se lisent côte à côte, et c'est voulu :
 * un champ ajouté d'un seul côté se voit tout de suite, là où deux fichiers
 * séparés auraient laissé la reprise perdre en silence ce que la création
 * savait écrire.
 */
function fromState(state: api.CampaignDraftState, refs: References, role: Role): Draft {
  const base = emptyDraft(refs, role)

  const channels: Draft['channels'] = {}
  for (const channel of state.channels) {
    channels[channel.channel_id] = {
      budget: channel.budget_amount === null ? '' : String(channel.budget_amount),
      agencyId: channel.agency_id,
    }
  }

  const targets: Draft['targets'] = {}
  for (const target of state.lever_targets) {
    targets[target.lever_id] = target.target_value === null ? '' : String(target.target_value)
  }

  return {
    ...base,
    name: state.name ?? '',
    starts_on: state.starts_on ?? '',
    ends_on: state.ends_on ?? '',
    type_id: state.type_id ?? null,
    scope: state.scope ?? base.scope,
    shop_ids: state.shop_ids,
    tone: state.tone ?? '',
    client_target: state.client_target ?? base.client_target,
    sector_ids: state.sector_ids,
    agency_ask_ids: state.agency_ask_ids,
    agency_note: state.agency_note ?? '',

    offer_template_id: state.offer?.template_id ?? null,
    offer_title: state.offer?.title ?? '',
    offer_mechanic: state.offer?.mechanic_text ?? '',
    offer_items: (state.offer?.items ?? []).map((item) => ({
      offer_item_id: item.offer_item_id ?? null,
      label: item.label,
      category: item.category ?? '',
      mechanic_type: (item.mechanic_type ?? '') as MechanicCode | '',
      discount_pct: numberOrBlank(item.discount_pct),
      fixed_price: numberOrBlank(item.fixed_price),
      buy_qty: numberOrBlank(item.buy_qty),
      get_qty: numberOrBlank(item.get_qty),
      baseline_price: numberOrBlank(item.baseline_price),
      margin_pct: numberOrBlank(item.margin_pct),
      target_pieces: numberOrBlank(item.target_pieces),
    })),

    shop_objectives: Object.fromEntries(
      (state.shop_targets ?? []).map((target) => [target.shop_id, String(target.target_pieces)]),
    ),
    analysis_from: base.analysis_from,
    analysis_to: base.analysis_to,
    analysis_compare: base.analysis_compare,
    // Aides au calcul, pas des données de campagne : elles ne se relisent pas.
    product_growth: {},
    family_growth: {},

    margin_pct_default: numberOrBlank(state.margin_pct_default) || '68',
    max_qty_per_ticket: numberOrBlank(state.offer?.max_qty_per_ticket),
    promo_cumulative: state.offer?.is_cumulative ?? false,

    challenge_enabled: state.challenge_enabled ?? false,
    challenge_metric: state.challenge_metric ?? 'attainment',
    challenge_trigger_pct:
      state.challenge_trigger_pct === undefined || state.challenge_trigger_pct === null
        ? '100'
        : String(Number(state.challenge_trigger_pct)),
    shop_triggers: Object.fromEntries(
      (state.shop_targets ?? [])
        .filter((target) => target.challenge_trigger_pct !== null
          && target.challenge_trigger_pct !== undefined)
        .map((target) => [target.shop_id, String(Number(target.challenge_trigger_pct))]),
    ),
    // Trois rangs toujours présents à l'écran : un prix relu sur deux rangs ne
    // doit pas faire disparaître le champ du troisième.
    challenge_prizes: [0, 1, 2].map(
      (rank) => (state.challenge_prizes ?? []).find((prize) => prize.rank_position === rank + 1)?.label ?? '',
    ),

    budget_amount: state.budget_amount === undefined || state.budget_amount === null
      ? ''
      : String(state.budget_amount),
    objective_coef_pct: state.objective_coef_pct === undefined || state.objective_coef_pct === null
      ? ''
      : String(state.objective_coef_pct),
    targets,

    channels,
    uniform_ids: state.uniform_ids,
    b2b_webshop_enabled: state.b2b_webshop_enabled ?? false,
    b2b_option_ids: state.b2b_option_ids,
    pos_survey_enabled: state.pos_survey_enabled ?? false,
    pos_questions: (state.pos_questions ?? []).map((question) => ({
      label: question.label,
      answer_type: question.answer_type,
      options: question.options ?? '',
      is_required: question.is_required ?? false,
    })),
    image_url: state.image_url ?? '',
    focal_point_y: state.focal_point_y ?? 50,
    image_fit: state.image_fit ?? 'cover',
    // Le rétroplanning enregistré remplace le modèle : reprendre un brouillon
    // ne doit pas y réinjecter les jalons types qu'on venait d'en retirer.
    format_ids: state.format_ids.length > 0 ? state.format_ids : base.format_ids,
    retro: state.retroplanning.length > 0
      ? state.retroplanning.map((step) => ({
          label: step.label,
          days_before_launch: step.days_before_launch,
          position_id: step.position_id,
        }))
      : base.retro,

    status_code: state.status_code ?? 'draft',
    create_crm_leads: state.create_crm_leads ?? false,
  }
}

/**
 * Étape sur laquelle rouvrir un brouillon.
 *
 * D'abord celle qu'on a quittée : c'est la seule qui soit juste. La déduire de
 * ce qui manque paraissait élégant et ne marche pas — l'offre, le budget et la
 * communication sont facultatifs, donc un brouillon laissé à l'étape 2 n'a rien
 * d'« incomplet » et rouvrait au récapitulatif, c'est-à-dire à la fin d'un
 * travail qu'on venait de commencer.
 *
 * La déduction ne sert plus que de repli, pour les brouillons créés avant que
 * l'étape ne soit enregistrée, et pour une clé devenue inconnue après un
 * remaniement de l'assistant.
 */
function resumeStep(key: string | null, draft: Draft): number {
  const saved = key === null ? -1 : STEPS.findIndex((entry) => entry.key === key)
  if (saved !== -1) {
    return saved
  }

  const incomplete = STEPS.findIndex((entry) => entry.blocking(draft) !== null)

  return incomplete === -1 ? STEPS.length - 2 : incomplete
}

/**
 * Nombre relu depuis l'API, rendu à la forme du brouillon.
 *
 * MySQL rend un DECIMAL comme chaîne (« 68.00 ») : le réafficher tel quel
 * mettrait « 68.00 » dans un champ où l'on avait tapé « 68 », et la première
 * sauvegarde suivante renverrait cette forme au serveur.
 */
function numberOrBlank(value: number | string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '' : String(Number(value))
}

function toPayload(draft: Draft, brandId: number | 'all', stepKey?: string): CampaignDraft {
  // Un champ vide voyage en `null` : « pas de remise » et « remise de 0 % »
  // sont deux choses différentes, et seule la seconde se saisit.
  const num = (value: string): number | null => (value.trim() === '' ? null : Number(value.trim()))

  const items = draft.offer_items
    .map((item) => ({
      label: item.label.trim(),
      offer_item_id: item.offer_item_id,
      mechanic_type: item.mechanic_type || null,
      discount_pct: num(item.discount_pct),
      fixed_price: num(item.fixed_price),
      buy_qty: num(item.buy_qty),
      get_qty: num(item.get_qty),
      baseline_price: num(item.baseline_price),
      margin_pct: num(item.margin_pct),
      target_pieces: num(item.target_pieces),
    }))
    .filter((item) => item.label !== '')

  return {
    // Omise quand le sélecteur est sur « toutes marques » : le serveur la
    // déduit, et refuse explicitement si plusieurs enseignes sont actives.
    brand_id: brandId === 'all' ? null : brandId,
    name: draft.name.trim(),
    // L'étape où l'on s'arrête voyage avec le brouillon. La déduire de ce qui
    // manque ne marche pas : l'offre, le budget et la communication sont
    // facultatifs, donc un brouillon quitté à l'étape 2 n'a rien d'incomplet
    // et se rouvrait au récapitulatif — à la fin d'un travail à peine commencé.
    draft_step: stepKey ?? null,
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
    image_fit: draft.image_fit,
    create_crm_leads: draft.create_crm_leads,
    margin_pct_default: draft.margin_pct_default.trim() === ''
      ? null
      : Number(draft.margin_pct_default.trim()),

    shop_ids: draft.scope === 'LOCALE' ? draft.shop_ids : [],
    // Seuls les objectifs réellement posés voyagent : zéro ou vide = aucun.
    shop_targets: Object.entries(draft.shop_objectives)
      .map(([shopId, value]) => ({
        shop_id: Number(shopId),
        target_pieces: Number(value),
        // Le seuil voyage avec l'objectif du même magasin : les deux vivent sur
        // la même ligne en base, les séparer ici obligerait à les recoller là-bas.
        challenge_trigger_pct: draft.shop_triggers[Number(shopId)]?.trim() || null,
      }))
      .filter(
        (target) => Number.isInteger(target.target_pieces) && target.target_pieces > 0,
      ),

    challenge_enabled: draft.challenge_enabled,
    // Sans challenge, on n'envoie ni critère ni seuil : les colonnes restent
    // nulles et rien n'a besoin d'être nettoyé le jour où on le rallume.
    challenge_metric: draft.challenge_enabled ? draft.challenge_metric : null,
    challenge_trigger_pct: draft.challenge_enabled
      ? (draft.challenge_trigger_pct.trim() || null)
      : null,
    challenge_prizes: draft.challenge_enabled
      ? draft.challenge_prizes.map((label) => ({ label: label.trim() }))
      : [],
    // Les secteurs ne concernent qu'une cible professionnelle : les envoyer
    // pour une campagne B2C peuplerait un entonnoir que rien n'alimente.
    sector_ids: draft.client_target === 'b2c' ? [] : draft.sector_ids,
    agency_ask_ids: draft.agency_ask_ids,
    b2b_option_ids: draft.b2b_webshop_enabled ? draft.b2b_option_ids : [],
    pos_survey_enabled: draft.pos_survey_enabled,
    pos_questions: draft.pos_survey_enabled
      ? draft.pos_questions
          .filter((question) => question.label.trim() !== '')
          .map((question) => ({
            label: question.label.trim(),
            answer_type: question.answer_type,
            options: question.answer_type === 'choice' ? question.options.trim() : null,
            is_required: question.is_required,
          }))
      : [],
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
      items.length === 0
        ? undefined
        : {
            // Le titre n'est plus saisi : il suit la gamme choisie à l'étape 2,
            // à défaut le nom de la campagne.
            title: draft.offer_title.trim() || `Offre ${draft.name.trim()}`,
            template_id: draft.offer_template_id,
            mechanic_text: draft.offer_mechanic.trim() || null,
            // L'offre court sur la période de la campagne. Elle avait sa
            // propre fenêtre — utile en théorie, saisie deux fois en
            // pratique, et deux dates qu'on ressaisit finissent par
            // diverger sans que personne ne sache laquelle fait foi.
            starts_on: draft.starts_on || null,
            ends_on: draft.ends_on || null,
            // L'horaire n'est plus saisi : une offre court toute la journée.
            all_day: true,
            hour_from: null,
            hour_to: null,
            max_qty_per_ticket: draft.max_qty_per_ticket.trim() === ''
              ? null
              : Number(draft.max_qty_per_ticket.trim()),
            is_cumulative: draft.promo_cumulative,
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
          title={item.hint ?? item.label}
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
          {/* Le nom entier reste accessible : tronquer à l'affichage ne doit
              pas revenir à le cacher. */}
          <strong title={value}>{value}</strong>
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
  // Vrai quand tous les secteurs sont retenus. Comparé sur le nombre, les
  // identifiants venant de la même liste : un secteur désactivé entre-temps
  // côté ERP ne doit pas laisser le bouton allumé pour toujours.
  const allSectors =
    refs.b2bSectors.length > 0 &&
    refs.b2bSectors.every((sector) => draft.sector_ids.includes(sector.id))

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  /** Envoie le fichier choisi, puis retient l'adresse rendue par le serveur. */
  async function sendVisual(file: File): Promise<void> {
    setUploading(true)
    setUploadError(null)
    setUploadNote(null)

    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Fichier illisible.'))
        reader.readAsDataURL(file)
      })

      const image = await api.uploadImage(content)

      // `BASE_URL` porte le sous-répertoire d'installation : le chemin rendu
      // par le serveur est relatif à la racine de l'application, pas à celle
      // du domaine.
      patch({ image_url: `${import.meta.env.BASE_URL}${image.path}` })

      // Ce que le serveur a fait de l'image se dit : une réduction silencieuse
      // ferait douter du fichier envoyé le jour où l'imprimeur pose la question.
      const size =
        image.width !== null && image.height !== null ? `${image.width} × ${image.height} px` : ''

      if (image.resized && image.original_width !== null) {
        setUploadNote(
          `Réduite de ${image.original_width} × ${image.original_height} px à ${size} — le maximum` +
            ' utile à 300 dpi pour un 100 × 150 mm avec 3 mm de fond perdu.',
        )
      } else if (image.below_print) {
        setUploadNote(
          `${size} : en dessous de 1 182 × 1 772 px, l’impression à 300 dpi manquera de netteté.` +
            ' Le visuel reste utilisable à l’écran.',
        )
      } else if (size !== '') {
        setUploadNote(`${size} — bon pour l’impression à 300 dpi.`)
      }
    } catch (cause: unknown) {
      setUploadError(describeError(cause))
    } finally {
      setUploading(false)
    }
  }

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

      {/* Le nom occupe toute la largeur : c'est la ligne qu'on relira dans les
          listes, les calendriers et les briefs, et il fallait la composer dans
          un champ deux fois plus court qu'elle. */}
      <label className="field field--block">
        Nom
        <input
          type="text"
          className="input--title"
          value={draft.name}
          placeholder="Barbecue été — opération terrasse"
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>

      <RangeCalendar
        from={draft.starts_on}
        to={draft.ends_on}
        onChange={(range) => patch(range)}
      />

      {/* Le visuel appartient à l'identité, au même titre que le nom : c'est
          lui qu'on reconnaît dans la liste et le calendrier avant d'avoir lu
          la ligne. Il se choisit donc ici ; ses déclinaisons par format
          restent à l'étape « Communication », qui les produit. */}
      <div className="visual-source">
        <label className="field field--grow">
          Photo ou illustration — adresse
          <input
            type="url"
            value={draft.image_url}
            placeholder="https://…"
            onChange={(e) => patch({ image_url: e.target.value })}
          />
        </label>

        {/* Le fichier passe par le même champ : une fois écrit sur le serveur,
            c'est son adresse qui est enregistrée avec la campagne. Rien de
            particulier à relire ensuite — un visuel envoyé et un visuel lié
            se comportent pareil. */}
        <label className={uploading ? 'filter is-busy' : 'filter'}>
          {uploading ? 'Envoi…' : 'Envoyer un fichier'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            disabled={uploading}
            className="visual-source__file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Le champ est vidé aussitôt : sans cela, renvoyer le même
              // fichier après une erreur ne déclencherait aucun événement.
              e.target.value = ''
              if (file) void sendVisual(file)
            }}
          />
        </label>
      </div>

      {uploadError !== null ? <p className="error">{uploadError}</p> : null}
      {uploadNote !== null ? <p className="muted">{uploadNote}</p> : null}

      {draft.image_url.trim() === '' ? (
        <p className="muted">
          Facultative. Envoyez un fichier depuis votre poste — PNG, JPEG, GIF, WebP ou AVIF,
          3 Mo au plus — ou collez l’adresse d’une image déjà en ligne. Une image plus grande
          que le format d’impression (1 252 × 1 843 px, soit 100 × 150 mm à 300 dpi avec 3 mm de
          fond perdu) est réduite automatiquement. Elle se déclinera ensuite dans les formats
          d’affichage à l’étape « Communication ».
        </p>
      ) : (
        <div className="visual-pick">
          <span className="visual-pick__frame">
            <img
              className={draft.image_fit === 'contain' ? 'is-contain' : undefined}
              src={draft.image_url}
              alt=""
              style={
                draft.image_fit === 'cover'
                  ? { objectPosition: `50% ${draft.focal_point_y}%` }
                  : undefined
              }
            />
          </span>
          <div className="visual-pick__setting">
            {/* Deux façons d'occuper un format : le remplir, ou y tenir. Une
                photo se recoupe sans dommage ; une affiche déjà composée, avec
                son texte au bord, perd son message dès qu'on la rogne. */}
            <span className="section-label">Cadrage</span>
            <div className="filters__row">
              <button
                type="button"
                className={`choice-pill${draft.image_fit === 'cover' ? ' is-on' : ''}`}
                aria-pressed={draft.image_fit === 'cover'}
                onClick={() => patch({ image_fit: 'cover' })}
              >
                Remplir le cadre
              </button>
              <button
                type="button"
                className={`choice-pill${draft.image_fit === 'contain' ? ' is-on' : ''}`}
                aria-pressed={draft.image_fit === 'contain'}
                onClick={() => patch({ image_fit: 'contain' })}
              >
                Image entière
              </button>
            </div>

            {draft.image_fit === 'cover' ? (
              <>
                <label className="field field--grow">
                  Point focal vertical — {Math.round(draft.focal_point_y)} %
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft.focal_point_y}
                    onChange={(e) => patch({ focal_point_y: Number(e.target.value) })}
                  />
                </label>
                <p className="muted">
                  L’image remplit chaque format et déborde ; le point focal décide de ce qui
                  reste dans le cadre en bandeau ou en carré. Rien ne s’affiche ? L’adresse ne
                  pointe pas sur une image.
                </p>
              </>
            ) : (
              <p className="muted">
                L’image tient entière dans chaque format, marges comprises — rien n’est rogné.
                Le point focal n’a plus d’objet.
              </p>
            )}
          </div>
        </div>
      )}

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
          {/* Le nombre affiché est celui des comptes réellement présents dans le
              vivier, et non un objectif de démarchage : c'est lui qui décide si
              cocher ce secteur produira des leads.

              « Tous » d'abord, dans la même rangée que les secteurs : viser
              l'ensemble du vivier est un cas courant, et le faire à la main
              demandait autant de clics qu'il y a de types de compte. Le bouton
              bascule dans les deux sens — c'est aussi le moyen de tout décocher
              sans reprendre chaque pastille. */}
          <div className="filters__row">
            <button
              type="button"
              className={`filter${allSectors ? ' is-on' : ''}`}
              onClick={() =>
                patch({ sector_ids: allSectors ? [] : refs.b2bSectors.map((s) => s.id) })
              }
              title={
                allSectors
                  ? 'Retirer tous les secteurs'
                  : `Viser les ${refs.b2bSectors.length} secteurs du vivier`
              }
            >
              Tous
            </button>
            {refs.b2bSectors.map((sector) => (
              <button
                key={sector.id}
                type="button"
                className={`filter${draft.sector_ids.includes(sector.id) ? ' is-on' : ''}`}
                onClick={() => patch({ sector_ids: toggle(draft.sector_ids, sector.id) })}
                title={`${sector.available_count} compte${sector.available_count > 1 ? 's' : ''} dans le vivier`}
              >
                {sector.label} · {sector.available_count}
              </button>
            ))}
          </div>

          {/* Les comptes suivent les secteurs, dans le fil du formulaire : ils
              répondent à la question que les pastilles posent — qui va-t-on
              réellement démarcher, et depuis quelle boutique. */}
          <h3 className="section-label">Comptes visés</h3>
          <ProspectList sectorIds={draft.sector_ids} />
        </>
      ) : null}

    </>
  )
}

// ---------------------------------------------------------------------------
// 2 — Offre
// ---------------------------------------------------------------------------

/** Libellé court d'une gamme : sans emoji de tête, préfixes ni parenthèses. */
function seasonLabel(name: string): string {
  const cleaned = name
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^Icône\s*[-–]\s*/iu, '')
    .replace(/^Gamme\s+/iu, '')
    .replace(/\s*\(.*\)\s*$/u, '')
    .split(/\s+[–—]\s+/u)[0]
    .trim()

  if (/^B[.\s-]*2[.\s-]*B[.\s-]*$/iu.test(cleaned)) return 'B2B'

  return cleaned || name
}

/** Forme comparable d'un libellé : minuscule, sans accent ni ponctuation. */
function compact(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Illustration d'une gamme, reconnue au mot-clé de son nom. */
function seasonImage(name: string): string | null {
  const flat = compact(name)
  const match = (
    [
      ['printan', 'printemps'],
      ['estival', 'ete'],
      ['automn', 'automne'],
      ['hivern', 'hiver'],
      ['noel', 'noel'],
      ['nicolas', 'saint-nicolas'],
      ['epiphanie', 'epiphanie'],
      ['mere', 'fete-des-meres'],
      ['pascal', 'paques'],
      ['paque', 'paques'],
      ['valentin', 'saint-valentin'],
      ['chandeleur', 'chandeleur'],
      ['glace', 'glace'],
      ['b2b', 'b2b'],
      ['standard', 'standard'],
    ] as const
  ).find(([key]) => flat.includes(key))

  return match ? `${import.meta.env.BASE_URL}img/seasons/${match[1]}.png` : null
}

/** Illustration d'une famille de produits, même principe. */
function familyImage(family: string): string | null {
  const flat = compact(family)
  const match = (
    [
      ['tarte', 'sweet-tart-small'],
      ['patisserie', 'cake-slice'],
      ['viennoiserie', 'croissant'],
      ['pain', 'bread-1'],
      ['boulangerie', 'rolls'],
      ['salade', 'salads'],
      ['plat', 'salads'],
      ['traiteur', 'salads'],
      ['biscuit', 'cookies'],
      ['cookie', 'cookies'],
      ['quiche', 'savoury-tart'],
      ['snack', 'savoury-tart'],
    ] as const
  ).find(([key]) => flat.includes(key))

  return match ? `${import.meta.env.BASE_URL}img/${match[1]}.png` : null
}

function OfferStep({ draft, patch }: StepProps) {
  // Le catalogue repris de l'ERP (`mar_offer_item`) : gammes saisonnières et
  // produits avec leur famille. Vide tant que la reprise n'a pas tourné —
  // l'écran le dit plutôt que de laisser trois colonnes muettes.
  const catalog = useAsync(() => api.listOfferItems(), [])

  const catalogItems = catalog.data ?? []
  const seasons = catalogItems.filter((item) => item.category === 'saison')
  const products = catalogItems.filter((item) => item.category === 'produit')
  const seasonIds = new Set(seasons.map((item) => item.id))
  const productById = new Map(products.map((item) => [item.id, item]))

  const familyOf = (item: OfferItem): string => item.detail ?? 'Autres'

  const chosenSeasonId =
    draft.offer_items.find(
      (element) => element.offer_item_id !== null && seasonIds.has(element.offer_item_id),
    )?.offer_item_id ?? null
  const chosenSeason = seasons.find((item) => item.id === chosenSeasonId) ?? null

  // La gamme choisie filtre tout le reste : seuls ses produits — donc leurs
  // familles — restent proposés. Sans gamme, tout le catalogue est là.
  const inSeason = (item: OfferItem): boolean =>
    chosenSeasonId === null || item.season_ids.includes(chosenSeasonId)
  const seasonProducts = products.filter(inSeason)

  // Familles disponibles avec leur effectif, dans l'ordre servi (famille, nom).
  const families: Array<{ name: string; count: number }> = []
  for (const product of seasonProducts) {
    const name = familyOf(product)
    const entry = families.find((candidate) => candidate.name === name)
    if (entry) entry.count++
    else families.push({ name, count: 1 })
  }

  const checkedIds = new Set(
    draft.offer_items
      .map((element) => element.offer_item_id)
      .filter((id): id is number => id !== null && productById.has(id)),
  )

  // Une famille est active dès qu'un de ses produits est coché : la cocher
  // présélectionne tout, la décocher retire tout — et la reprise d'un
  // brouillon retrouve cet état sans rien stocker de plus.
  const activeFamilies = new Set(
    [...checkedIds].map((id) => familyOf(productById.get(id) as OfferItem)),
  )
  const visibleProducts = seasonProducts.filter((item) => activeFamilies.has(familyOf(item)))

  const pickSeason = (item: OfferItem) => {
    const wasActive = chosenSeasonId === item.id
    const nextSeasonId = wasActive ? null : item.id
    // Changer de gamme écarte les produits cochés qui n'y vivent pas : une
    // offre estivale ne vend pas la bûche de Noël restée cochée.
    const keep = draft.offer_items.filter((element) => {
      if (element.offer_item_id === null) return true
      if (seasonIds.has(element.offer_item_id)) return false
      const product = productById.get(element.offer_item_id)
      if (product === undefined) return true
      return nextSeasonId === null || product.season_ids.includes(nextSeasonId)
    })
    patch({
      offer_items:
        nextSeasonId === null
          ? keep
          : [...keep, { offer_item_id: item.id, label: `Gamme ${seasonLabel(item.name)}`, category: 'saison', ...blankPricing() }],
      // Le titre de l'offre suit la gamme : il n'est plus saisi à la main.
      offer_title: nextSeasonId === null ? '' : `Offre ${seasonLabel(item.name)}`,
    })
  }

  const toggleFamily = (name: string) => {
    const familyProducts = seasonProducts.filter((item) => familyOf(item) === name)
    const ids = new Set(familyProducts.map((item) => item.id))
    const others = draft.offer_items.filter(
      (element) => element.offer_item_id === null || !ids.has(element.offer_item_id),
    )
    patch({
      offer_items: activeFamilies.has(name)
        ? others
        : [
            ...others,
            ...familyProducts.map((item) => ({ offer_item_id: item.id, label: item.name, category: 'produit', ...blankPricing() })),
          ],
    })
  }

  const toggleProduct = (item: OfferItem) => {
    patch({
      offer_items: checkedIds.has(item.id)
        ? draft.offer_items.filter((element) => element.offer_item_id !== item.id)
        : [...draft.offer_items, { offer_item_id: item.id, label: item.name, category: 'produit', ...blankPricing() }],
    })
  }

  const selectAllVisible = () => {
    const additions = visibleProducts
      .filter((item) => !checkedIds.has(item.id))
      .map((item) => ({ offer_item_id: item.id, label: item.name, category: 'produit', ...blankPricing() }))
    if (additions.length > 0) patch({ offer_items: [...draft.offer_items, ...additions] })
  }

  const resetOffer = () =>
    patch({ offer_items: [], offer_title: '', offer_template_id: null, offer_mechanic: '' })

  return (
    <>
      <h2>Offre</h2>
      <p className="muted">
        Facultative : toutes les campagnes n’en portent pas. Composez-la comme en boutique —
        saison, catégories, produits ; elle court sur la période fixée à l’étape 1.
      </p>

      {catalog.error ? <p className="error">Catalogue indisponible : {catalog.error}</p> : null}
      {!catalog.loading && !catalog.error && products.length === 0 ? (
        <p className="muted">
          Le catalogue est vide : lancez la reprise ERP depuis l’écran du vivier B2B pour
          composer l’offre sur les vraies gammes et les vrais produits.
        </p>
      ) : null}

      <div className="offer-compose">
        <section className="offer-col">
          <h3 className="section-label">1 · Saison</h3>
          {/* Même tuile qu'à la colonne des catégories : choisir une gamme et
              choisir une famille sont le même geste, et deux formes pour un
              même geste font hésiter. Les pastilles empilaient en outre dix
              lignes en regard de deux colonnes. */}
          <div className="season-tiles">
            {seasons.map((item) => {
              const active = chosenSeasonId === item.id
              const image = seasonImage(item.name)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`catalog-tile${active ? ' is-on' : ''}`}
                  aria-pressed={active}
                  title={item.name}
                  onClick={() => pickSeason(item)}
                >
                  {active ? <span className="catalog-tile__badge">✓</span> : null}
                  {image !== null ? (
                    <img src={image} alt="" />
                  ) : (
                    <span className="catalog-tile__letter" aria-hidden="true">
                      {seasonLabel(item.name).charAt(0)}
                    </span>
                  )}
                  <strong>{seasonLabel(item.name)}</strong>
                </button>
              )
            })}
          </div>
        </section>

        <section className="offer-col">
          <h3 className="section-label">
            2 · Catégories
            {activeFamilies.size > 0 ? (
              <span className="muted"> ({activeFamilies.size} sélectionnées)</span>
            ) : null}
          </h3>
          {families.length === 0 && !catalog.loading ? (
            <p className="muted">
              {chosenSeason !== null
                ? 'Aucun produit rattaché à cette gamme.'
                : 'Le catalogue est vide.'}
            </p>
          ) : null}
          <div className="family-tiles">
            {families.map(({ name, count }) => {
              const active = activeFamilies.has(name)
              const image = familyImage(name)
              return (
                <button
                  key={name}
                  type="button"
                  className={`catalog-tile${active ? ' is-on' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggleFamily(name)}
                >
                  {active ? <span className="catalog-tile__badge">✓</span> : null}
                  {image !== null ? (
                    <img src={image} alt="" />
                  ) : (
                    <span className="catalog-tile__letter" aria-hidden="true">
                      {name.charAt(0)}
                    </span>
                  )}
                  <strong>{name}</strong>
                  <span className="muted">
                    {count} produit{count > 1 ? 's' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="offer-col">
          <h3 className="section-label">
            3 · Produits
            {checkedIds.size > 0 ? (
              <span className="muted"> ({checkedIds.size} sélectionnés)</span>
            ) : null}
            {visibleProducts.length > 0 ? (
              <button type="button" className="offer-selectall" onClick={selectAllVisible}>
                Tout sélectionner
              </button>
            ) : null}
          </h3>
          {visibleProducts.length === 0 ? (
            <p className="muted">Cochez une catégorie pour lister ses produits.</p>
          ) : (
            <div className="product-rows">
              {visibleProducts.map((item) => {
                const checked = checkedIds.has(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="product-row"
                    aria-pressed={checked}
                    onClick={() => toggleProduct(item)}
                  >
                    <span className={`product-row__box${checked ? ' is-on' : ''}`} />
                    {item.name}
                    <span className="muted product-row__family">{familyOf(item)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <div className="offer-summary">
        <strong>Votre offre :</strong>
        <span>
          {chosenSeason !== null ? seasonLabel(chosenSeason.name) : 'aucune saison'}
          {' · '}
          {activeFamilies.size} catégorie{activeFamilies.size > 1 ? 's' : ''}
          {' · '}
          {checkedIds.size} produit{checkedIds.size > 1 ? 's' : ''}
        </span>
        <button type="button" className="filter offer-summary__reset" onClick={resetOffer}>
          Réinitialiser
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 5 — Budget & leviers
// ---------------------------------------------------------------------------

function BudgetStep({ refs, draft, patch }: StepProps) {
  return (
    <>
      <h2>Budget & leviers</h2>
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

      {/* Le ton rejoint la communication, comme le brief d'agence : l'étape 1
          décide ce que la campagne est, celle-ci comment elle parle. « Festif »
          ou « Premium » n'engage ni le périmètre ni la cible — cela engage la
          création, qui se décide ici, à côté de ceux qui la produiront. */}
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

      {/* L'agence était à l'étape « Type & cadrage », entre la cible client et
          la portée. On y décide ce que la campagne est ; ce qu'on demande à
          l'agence relève de la manière dont on la fera savoir. Le bloc rejoint
          donc les canaux, où le prestataire de chacun se choisit déjà. */}
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

      <h3 className="section-label">Questionnaire en caisse</h3>
      <p className="muted">
        Quelques questions posées au client au moment de payer. C’est souvent la seule mesure
        dont dispose une opération sans bon ni canal digital traçable : sans elle, on sait ce
        qu’on a vendu, pas pourquoi.
      </p>
      <div className="filters__row">
        <button
          type="button"
          className={`choice-pill${!draft.pos_survey_enabled ? ' is-on' : ''}`}
          onClick={() => patch({ pos_survey_enabled: false })}
        >
          Pas de questionnaire
        </button>
        <button
          type="button"
          className={`choice-pill${draft.pos_survey_enabled ? ' is-on' : ''}`}
          onClick={() =>
            patch({
              pos_survey_enabled: true,
              // Une première question d'emblée : un questionnaire vide oblige
              // à deviner qu'il faut encore cliquer quelque part.
              pos_questions: draft.pos_questions.length > 0
                ? draft.pos_questions
                : [{ label: '', answer_type: 'yes_no', options: '', is_required: false }],
            })
          }
        >
          Poser des questions
        </button>
      </div>

      {draft.pos_survey_enabled ? (
        <>
          <ul className="question-list">
            {draft.pos_questions.map((question, index) => {
              const update = (change: Partial<PosQuestion>) => {
                const questions = [...draft.pos_questions]
                questions[index] = { ...questions[index], ...change }
                patch({ pos_questions: questions })
              }

              return (
                <li key={index}>
                  <div className="question-list__row">
                    <input
                      type="text"
                      className="input--grow"
                      value={question.label}
                      placeholder="Comment avez-vous connu l’offre ?"
                      onChange={(e) => update({ label: e.target.value })}
                    />
                    <select
                      value={question.answer_type}
                      onChange={(e) => update({ answer_type: e.target.value })}
                    >
                      {refs.posAnswerTypes.map((type) => (
                        <option key={type.code} value={type.code} title={type.hint ?? undefined}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                    <label className="field">
                      <input
                        type="checkbox"
                        checked={question.is_required}
                        onChange={(e) => update({ is_required: e.target.checked })}
                      />
                      Obligatoire
                    </label>
                    <button
                      type="button"
                      className="filter"
                      onClick={() =>
                        patch({
                          pos_questions: draft.pos_questions.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Retirer
                    </button>
                  </div>

                  {question.answer_type === 'choice' ? (
                    <label className="field field--block">
                      Propositions, une par ligne
                      <textarea
                        rows={3}
                        value={question.options}
                        placeholder={'Affiche en vitrine\nRéseaux sociaux\nBouche-à-oreille'}
                        onChange={(e) => update({ options: e.target.value })}
                      />
                    </label>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <button
            type="button"
            className="filter"
            onClick={() =>
              patch({
                pos_questions: [
                  ...draft.pos_questions,
                  { label: '', answer_type: 'yes_no', options: '', is_required: false },
                ],
              })
            }
          >
            + Ajouter une question
          </button>
          <p className="muted wizard__hint">
            Trois questions au maximum tiennent en caisse sans allonger la file. Au-delà, le
            vendeur abrège, et la réponse ne vaut plus rien.
          </p>
        </>
      ) : null}

      <h3 className="section-label">Déclinaisons du visuel</h3>

      {draft.image_url.trim() === '' ? (
        <p className="muted">
          Aucun visuel : la photo ou l’illustration de la campagne se choisit à l’étape « Type &
          cadrage », avec son cadrage. Les formats se déclinent ensuite ici.
        </p>
      ) : (
        <>
          <p className="muted">
            Un seul visuel, décliné par format selon le cadrage réglé à l’étape « Type &
            cadrage » —{' '}
            {draft.image_fit === 'cover'
              ? 'rempli et recoupé au point focal'
              : 'contenu entier, marges comprises'}
            . Retirez un format que vous ne produirez pas.
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
                      {/* Le format montre le cadrage retenu à l'étape 1 :
                          c'est là qu'on voit ce qu'une bannière très large
                          fait perdre à une image qu'on remplit. */}
                      <img
                        className={draft.image_fit === 'contain' ? 'is-contain' : undefined}
                        src={draft.image_url}
                        alt=""
                        style={
                          draft.image_fit === 'cover'
                            ? { objectPosition: `50% ${draft.focal_point_y}%` }
                            : undefined
                        }
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
      )}
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
  const items = draft.offer_items.filter((item) => item.label.trim() !== '')

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
      items.length === 0
        ? 'Aucune'
        : `${draft.offer_title.trim() || `Offre ${draft.name.trim()}`} · ${items.length} élément${items.length > 1 ? 's' : ''}`,
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
    [
      'Questionnaire caisse',
      draft.pos_survey_enabled
        ? `${draft.pos_questions.filter((q) => q.label.trim() !== '').length} question(s)`
        : 'Aucun',
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

/**
 * Dernière étape : la génération des leads.
 *
 * L'effectif affiché vient du vivier réel, pas du chiffre de cadrage porté par
 * le secteur. Les deux sont montrés côte à côte : promettre 184 comptes quand
 * le vivier en contient douze produit un entonnoir qui ne se remplira jamais,
 * et personne ne saura pourquoi.
 */
function LeadsStep({ draft, patch }: StepProps) {
  const availability = useAsync(() => api.getSectorAvailability(), [])

  // Le total vient de la base et non de la somme des lignes : un compte relevant
  // de deux secteurs cochés y figure deux fois, et ne produira qu'un lead.
  // Le crochet est appelé avant la sortie B2C — un rendu qui en appelle moins
  // que le précédent casse l'ordre des crochets de React.
  const distinct = useAsync(
    () => api.countProspects(draft.sector_ids),
    [draft.sector_ids.join(',')],
  )

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

  const rows = (availability.data ?? []).filter((sector) => draft.sector_ids.includes(sector.id))
  const available = distinct.data?.total ?? 0
  const summed = rows.reduce((sum, sector) => sum + sector.available, 0)
  const estimated = rows.reduce((sum, sector) => sum + sector.estimated_leads_count, 0)

  // Les secteurs repris de l'ERP n'ont pas de chiffre de cadrage : c'est une
  // intention de démarchage, que l'ERP n'a aucune raison de porter. Une colonne
  // entière de zéros n'apprend rien — elle est retirée quand elle est vide.
  const framed = rows.some((sector) => sector.estimated_leads_count > 0)

  return (
    <>
      <h2>Leads CRM</h2>
      <p className="muted">
        Les comptes du vivier B2B correspondant aux secteurs retenus sont distribués aux
        boutiques de la campagne, à l’état « à appeler ». Ils apparaissent ensuite dans son suivi.
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

      {(availability.error ?? distinct.error) ? (
        <p className="error">{availability.error ?? distinct.error}</p>
      ) : null}
      {availability.loading || distinct.loading ? (
        <p className="muted">Lecture du vivier…</p>
      ) : null}

      {draft.sector_ids.length === 0 ? (
        <p className="muted wizard__hint">
          Aucun secteur retenu à l’étape 1 : rien ne serait généré.
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Secteur</th>
                  {framed ? <th className="num">Cadrage</th> : null}
                  <th className="num">Dans le vivier</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((sector) => (
                  <tr key={sector.id}>
                    <td>{sector.label}</td>
                    {framed ? (
                      <td className="num muted">{sector.estimated_leads_count}</td>
                    ) : null}
                    <td className="num">{sector.available}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="ledger__total">
                  <td>Total</td>
                  {framed ? <td className="num muted">{estimated}</td> : null}
                  <td className="num">{available}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Le total est inférieur à la somme des lignes dès qu'un compte
              relève de deux secteurs cochés. Sans un mot, cela passe pour une
              erreur d'addition. */}
          {summed > available ? (
            <p className="muted wizard__hint">
              {summed - available} compte{summed - available > 1 ? 's' : ''} relève
              {summed - available > 1 ? 'nt' : ''} de plusieurs secteurs retenus : le total
              compte les comptes, pas les lignes. Chacun ne donnera qu’un seul lead.
            </p>
          ) : null}

          {!distinct.loading && available === 0 ? (
            <p className="muted wizard__hint">
              Le vivier ne contient aucun compte sur ces secteurs : la génération ne créera rien.
              Importez-le depuis <strong>Fidélité &amp; CRM</strong>, puis relancez la génération
              depuis le suivi de la campagne — elle ne crée que les comptes non encore rattachés.
            </p>
          ) : (
            <p className="muted wizard__hint">
              {available} compte{available > 1 ? 's' : ''} sera{available > 1 ? 'ont' : ''} créé
              {available > 1 ? 's' : ''}.
              {framed
                ? ` Le chiffre de cadrage (${estimated}) reste l’objectif de démarchage, pas ce qui est disponible.`
                : ''}
            </p>
          )}

          {/* Les comptes eux-mêmes, comme à l'étape 1 : on décide de générer en
              voyant qui sera appelé, et par quelle boutique. */}
          <h3 className="section-label">Comptes concernés</h3>
          <ProspectList sectorIds={draft.sector_ids} />
        </>
      )}
    </>
  )
}
