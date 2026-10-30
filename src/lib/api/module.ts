import { request as httpRequest } from './http'
import type { RequestOptions } from './http'
import type {
  AliasType,
  LangCode,
} from './types'

/**
 * Client du module marketing (tables `mar_`).
 *
 * À distinguer de `network.ts`, qui lit l'ERP : ici, c'est le module qui fait
 * foi. Les campagnes, l'offre, les fonds et les leads lui appartiennent ;
 * l'ERP n'est plus consulté que pour ce qu'il possède réellement (boutiques
 * d'origine, catalogue produit, statistiques de vente).
 */

/**
 * Préfixe des appels au module.
 *
 * L'application peut être servie sous un sous-répertoire (`/marketing`) : sans
 * ce préfixe, les appels partiraient à la racine du domaine et tomberaient à
 * côté. Vide en développement, où le proxy Vite sert `/api`.
 */
// « auto » : la racine d'API est le RÉPERTOIRE PARENT de la page, résolu à
// l'exécution. La page vit à /<install>/assistant/, l'API à
// /<install>/api/v1/marketing/… — le préfixe d'installation suit tout seul,
// qu'il soit /consulant_bo ou la racine du domaine. Un chemin relatif dans
// VITE_API_BASE ne suffit pas : buildUrl le préfixe de « / » et le navigateur
// normalise « /../ » en avalant le sous-répertoire.
const CONFIGURE = import.meta.env.VITE_API_BASE ?? ''
const API_ROOT = (CONFIGURE === 'auto'
  ? new URL('..', window.location.href).pathname.replace(/\/$/, '')
  : CONFIGURE
).replace(/\/+$/, '')

const BASE = `${API_ROOT}/api/v1/marketing`
// Le cockpit du BO, qui sert le KPI d'une période et les documents joints. Dans le BO, il est à côté de
// l'API du module (même racine) ; le Marketing, servi à part (/marketing), le trouve à VITE_COCKPIT_BASE
// (`/consulant_bo` sur le serveur, fixé au build).
const COCKPIT_ROOT = (import.meta.env.VITE_COCKPIT_BASE ?? API_ROOT).replace(/\/+$/, '')
// Le module Social & Ads (posts, publicités Meta), servi sous /marketing/social sur le même serveur.
const SOCIAL_ROOT = (import.meta.env.VITE_SOCIAL_BASE || '/marketing/social/').replace(/\/+$/, '')
// Son espace boutique, affiché dans la version franchisé.
const SOCIAL_FRANCHISE_ROOT = (import.meta.env.VITE_SOCIAL_FRANCHISEE_BASE || '/marketing/franchise/').replace(/\/+$/, '')
// La régie d'affichage des écrans des magasins (« Marketing en magasin »), servie à /signage sur le même serveur.
const SIGNAGE_ROOT = (import.meta.env.VITE_SIGNAGE_BASE || '/signage/').replace(/\/+$/, '')

/** Les racines que ce build appelle ou ouvre, telles que résolues : l'écran « Adresses et réglages » les montre. */
export const ROOTS = {
  /** L'API de ce module. */
  api: BASE,
  /** Le cockpit du BO (sans `/api/cockpit`). */
  cockpit: COCKPIT_ROOT,
  social: `${SOCIAL_ROOT}/`,
  socialFranchise: `${SOCIAL_FRANCHISE_ROOT}/`,
  signage: `${SIGNAGE_ROOT}/`,
}

/**
 * Le module est servi par l'application elle-même, pas derrière le proxy `/erp`
 * de l'ERP : on force donc une racine vide pour que le chemin parte de l'origine.
 */
function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return httpRequest<T>(path, { ...options, baseUrl: '' })
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * État d'authentification vu par le module.
 *
 * Le module est prévu pour être embarqué dans l'ERP, dont le middleware pose
 * l'identité. Le front ne peut pas deviner s'il l'est : il le demande.
 */
export interface Session {
  authenticated: boolean
  user_id?: number
  role?: string
  brand_id?: number | null
  shop_ids?: number[] | null
  login_hint?: string
  /** Identité de développement (MAR_DEV_AUTH) plutôt que celle de l'ERP. */
  dev_auth?: boolean
  /** Sans identité : le fichier de configuration du serveur a-t-il été trouvé. */
  config_found?: boolean
}

export function getSession(): Promise<Session> {
  return request<Session>(`${BASE}/session`)
}

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

export interface Lever {
  id: number
  code: string
  label: string
  color_hex: string
  sort_order: number
}

export interface CampaignStatus {
  code: string
  label: string
  text_hex: string
  bg_rgba: string
  sort_order: number
}

export interface CampaignType {
  id: number
  code: string
  label: string
  /** Ce que le type recouvre, en une phrase. Distinct du KPI attendu. */
  description: string | null
  /** Couleur de l'icône et de l'accent de la carte. */
  color_hex: string | null
  /** Entrée de la bibliothèque retenue ; `icon_path` en porte le tracé. */
  icon_key: string | null
  /** Formulation d'origine du handoff, conservée pour retrouver l'intention. */
  default_lever_code: string | null
  default_kpi_label: string | null
  icon_path: string | null
  lever_id: number | null
  /** Libellé de la pastille : celui du levier, ou la nuance propre au type. */
  lever_label: string | null
  lever_color_hex: string | null
}

/**
 * Cadrage du visuel dans un format : rempli et recoupé au point focal, ou
 * contenu entier avec ses marges.
 */
export type ImageFit = 'cover' | 'contain'

/** Cible client d'une campagne — pilote l'entonnoir de leads B2B. */
export type ClientTarget = 'b2c' | 'b2b' | 'mixte'

export interface LeadStatus {
  code: string
  label: string
  color_hex: string
  bg_hex: string
  border_hex: string
  sort_order: number
}

export interface B2bSector {
  id: number
  code: string
  label: string
  /** Intention de démarchage. Vaut 0 pour les secteurs repris de l'ERP. */
  estimated_leads_count: number
  /** Comptes réellement présents dans le vivier pour ce secteur. */
  available_count: number
}

export interface Format {
  id: number
  code: string
  name: string
  width_px: number
  height_px: number
  note: string | null
}

export interface Position {
  id: number
  code: string
  label: string
}

export interface Channel {
  id: number
  code: string
  label: string
  family: 'DIGITAL' | 'PHYSIQUE'
}

export interface Uniform {
  id: number
  code: string
  name: string
  description: string | null
  icon_path: string | null
}

export interface Tone {
  id: number
  code: string
  label: string
}

export interface AgencyAsk {
  id: number
  code: string
  label: string
}

export interface B2bOption {
  id: number
  code: string
  label: string
  description: string | null
}

/** Jalon type du rétroplanning, en jours avant le lancement. */
export interface RetroplanningDefault {
  id: number
  label: string
  days_before_launch: number
  position_id: number | null
  position_label: string | null
}

/**
 * Référentiel plat : un code stocké, un libellé affichable.
 *
 * Six ensembles partagent cette forme. Ils remplacent autant de tables de
 * correspondance écrites dans le front, où ajouter une valeur imposait un
 * déploiement alors que tout le reste du module se règle en base.
 */
export interface CodeLabel {
  code: string
  label: string
}

export interface OfferTemplate {
  id: number
  code: string
  label: string
  description: string | null
  items: Array<{ template_id: number; offer_item_id: number; quantity: number }>
}

/**
 * Tous les référentiels du module.
 *
 * Un seul appel plutôt que dix : ces tables tiennent en quelques dizaines de
 * lignes et l'application en a besoin dès le premier écran. C'est ce jeu qui
 * remplace les constantes que le prototype portait en dur — couleurs comprises.
 */
/**
 * Une action qu'une campagne peut suivre (référentiel, migration 036) : ce qu'elle
 * doit faire bouger, dans quelle unité, et où cela se lit. `cockpit_measure` dit la
 * mesure que le cockpit sait calculer en caisse ; `null` = hors caisse (webshop, CRM).
 */
export interface TrackingAction {
  id: number
  code: string
  label: string
  unit_label: string
  source_label: string
  cockpit_measure: 'trafic' | 'panier' | 'ca' | null
}

/** SHOP = jugée boutique par boutique ; NETWORK = sur le total du réseau. */
export type TrackingScope = 'SHOP' | 'NETWORK'
/** N1 = mêmes dates l'an dernier ; AVANT = même durée juste avant le lancement. */
export type TrackingBaseline = 'N1' | 'AVANT'

export interface References {
  /** Les actions qu'une campagne peut suivre, dans l'ordre de la liste. */
  trackingActions: TrackingAction[]
  levers: Lever[]
  campaignStatuses: CampaignStatus[]
  campaignTypes: CampaignType[]
  leadStatuses: LeadStatus[]
  b2bSectors: B2bSector[]
  formats: Format[]
  positions: Position[]
  channels: Channel[]
  uniforms: Uniform[]
  offerTemplates: OfferTemplate[]
  tones: Tone[]
  agencyAsks: AgencyAsk[]
  b2bOptions: B2bOption[]
  retroplanningDefaults: RetroplanningDefault[]
  clientTargets: CodeLabel[]
  costKinds: CodeLabel[]
  fundSources: CodeLabel[]
  reviewPlatforms: CodeLabel[]
  salesChannels: CodeLabel[]
  promotionMechanics: CodeLabel[]
  /** Formes de réponse acceptées par la caisse. */
  posAnswerTypes: Array<CodeLabel & { hint: string | null }>
  /** Palette par défaut d'une campagne — une seule source, côté serveur. */
  campaignColors: CampaignColors<string>
}

/**
 * Libellé d'un code, ou le code lui-même à défaut.
 *
 * Le repli n'est pas décoratif : une valeur venue d'un import et absente du
 * référentiel doit rester lisible plutôt que de laisser une case vide.
 */
export function labelOf(list: CodeLabel[], code: string | null | undefined): string {
  if (!code) return '—'

  return list.find((entry) => entry.code === code)?.label ?? code
}

export function getReferences(): Promise<References> {
  return request<References>(`${BASE}/references`)
}

export interface Brand {
  id: number
  code: string
  /** Identifiant de l'enseigne côté ERP : celui que porte `?brand=` dans l'adresse. */
  erp_brand_id: number | null
  name: string
  logo_url: string | null
}

export function listBrands(): Promise<Brand[]> {
  return request<Brand[]>(`${BASE}/brands`)
}

// ---------------------------------------------------------------------------
// Campagnes
// ---------------------------------------------------------------------------

export interface Campaign {
  id: number
  name: string
  scope: 'RESEAU' | 'LOCALE'
  client_target: ClientTarget
  status_code: string
  status_label: string
  status_text_hex: string
  status_bg_rgba: string
  starts_on: string | null
  ends_on: string | null
  budget_amount: number
  spent_amount: number
  image_url: string | null
  brand_name: string
  type_label: string | null
  type_code: string | null
  shops_count: number
  approval_status: string | null
  create_crm_leads: boolean
  parent_campaign_id: number | null
}

export interface CampaignFilters {
  status?: string
  scope?: 'RESEAU' | 'LOCALE'
  brand_id?: number
}

export function listCampaigns(filters: CampaignFilters = {}): Promise<Campaign[]> {
  return request<Campaign[]>(`${BASE}/campaigns`, { query: { ...filters } })
}

/**
 * Fiche complète : la campagne et tout ce que l'assistant a saisi.
 *
 * Ces champs existaient en base sans qu'aucun écran ne les relise. Une fiche
 * enregistrée et illisible ne vaut guère mieux qu'une fiche perdue.
 */
export interface CampaignDetail extends Campaign {
  type_id: number | null
  tone: string | null
  tone_label: string | null
  /** Le suivi, en clair : l'action, son unité, où elle se lit, et la mesure du cockpit s'il y en a une. */
  tracking_action_id?: number | null
  tracking_action_code?: string | null
  tracking_action_label?: string | null
  tracking_unit_label?: string | null
  tracking_source_label?: string | null
  tracking_cockpit_measure?: 'trafic' | 'panier' | 'ca' | null
  tracking_scope?: TrackingScope | null
  tracking_target?: number | null
  tracking_baseline?: TrackingBaseline | null
  objective_coef_pct: number | null
  agency_note: string | null
  b2b_webshop_enabled: number | boolean
  /** La campagne paraît-elle en vitrine de la boutique en ligne. */
  show_web_shop: number | boolean
  pos_survey_enabled: number | boolean
  pos_questions: Array<{
    id: number
    label: string
    answer_type: string
    answer_type_label: string | null
    options: string | null
    is_required: boolean
  }>
  agency_asks: string[]
  b2b_options: string[]
  uniforms: string[]
  // `id` et non `sector_id` : la route renvoie le secteur lui-même, comme
  // dans les référentiels. Le type annonçait `sector_id`, et rien ne le
  // contredisait à la compilation — c'est l'avertissement de clé React qui
  // l'a fait apparaître.
  sectors: Array<{ id: number; code: string; label: string; estimated_leads_count: number }>
  shops: Array<{ shop_id: number; shop_name: string; city: string | null }>
  levers: Array<{
    lever_id: number
    label: string
    color_hex: string
    target_value: number | null
    actual_value: number | null
    target_unit: string | null
  }>
  channels: Array<{
    label: string
    family: 'PHYSIQUE' | 'DIGITAL'
    budget_amount: number | null
    is_enabled: boolean
    agency_name: string | null
  }>
  assets: Array<{
    id: number
    file_url: string | null
    focal_point_y: number | null
    fit: ImageFit
    is_master: boolean
    renders_count: number
    /** Déclinaisons encore à produire. */
    pending_count: number
  }>
  retroplanning: Array<{
    id: number
    label: string
    days_before_launch: number
    position_label: string | null
    done_at: string | null
  }>
  offer: {
    title: string
    mechanic_text: string | null
    starts_on: string | null
    ends_on: string | null
    hour_from: string | null
    hour_to: string | null
    items: Array<{ label: string }>
  } | null
}

export function getCampaign(id: number): Promise<CampaignDetail> {
  return request(`${BASE}/campaigns/${id}`)
}

export interface Shop {
  id: number
  code: string
  name: string
  city: string | null
  brand_id: number | null
  brand_name: string | null
}

/** Déjà restreinte au périmètre de l'appelant par le serveur. */
export function listShops(): Promise<Shop[]> {
  return request<Shop[]>(`${BASE}/shops`)
}

/**
 * Création d'une campagne et de ses rattachements.
 *
 * Un seul appel, une seule transaction : boutiques, canaux et objectifs font
 * partie de la campagne. Les envoyer séparément laisserait, en cas d'échec, une
 * campagne budgétée mais sans périmètre.
 */
/** Une ligne d'offre : le produit, et la promotion qu'il porte s'il en porte une. */
export interface OfferItemPayload {
  label: string
  offer_item_id?: number | null
  /** Famille de catalogue relue avec l'élément : `produit`, `saison`… */
  category?: string | null
  mechanic_type?: string | null
  discount_pct?: number | string | null
  fixed_price?: number | string | null
  buy_qty?: number | string | null
  get_qty?: number | string | null
  /** Prix TTC de référence, figé au moment de la saisie. */
  baseline_price?: number | string | null
  /** Taux de marge du produit ; nul = suit le taux réseau. */
  margin_pct?: number | string | null
  /** Objectif réseau de pièces sur ce produit ; nul = aucun objectif posé. */
  target_pieces?: number | string | null
  /** La photo de ce produit part-elle dans le dossier d'impression. */
  show_photo?: boolean
  /** Photo propre à cette campagne ; nulle = celle du catalogue. */
  image_url?: string | null
}

export interface CampaignDraft {
  name: string
  /**
   * Facultatif : le back-office connaît sa marque. On ne l'envoie que si le
   * sélecteur de marque en désigne une, pour les réseaux multi-enseignes.
   */
  brand_id?: number | null
  type_id?: number | null
  scope?: 'RESEAU' | 'LOCALE'
  client_target?: ClientTarget
  status_code?: string
  /** Clé de l'étape où l'assistant a été quitté, pour y revenir. */
  draft_step?: string | null
  starts_on?: string | null
  ends_on?: string | null
  budget_amount?: number
  image_url?: string | null
  create_crm_leads?: boolean
  /** Ne viser que les comptes marqués « bureau à livrer ». */
  b2b_offices_only?: boolean
  /** Le suivi : l'action que la campagne doit faire bouger (null = aucune). */
  tracking_action_id?: number | null
  tracking_scope?: TrackingScope | null
  /** La cible, dans l'unité de l'action. */
  tracking_target?: number | null
  tracking_baseline?: TrackingBaseline | null
  tone?: string | null
  /** Objectif exprimé en écart au N-1 : « N-1 + 12 % ». */
  objective_coef_pct?: number | null
  agency_note?: string | null
  b2b_webshop_enabled?: boolean
  /** Absent = non publiée : montrer en vitrine se demande explicitement. */
  show_web_shop?: boolean
  /** Un questionnaire est-il posé en caisse pendant la campagne. */
  pos_survey_enabled?: boolean
  pos_questions?: Array<{
    label: string
    answer_type: string
    /** Propositions d'un choix, une par ligne. */
    options?: string | null
    is_required?: boolean
  }>
  /** Cadrage vertical du visuel, en pourcentage de la hauteur. */
  focal_point_y?: number | null
  /** Rempli et recoupé, ou contenu entier dans le cadre. */
  image_fit?: ImageFit
  shop_ids?: number[]
  /**
   * Objectifs de pièces par boutique (étape « Objectifs »), > 0 seulement.
   * `challenge_trigger_pct` nul = la boutique suit le seuil général.
   */
  shop_targets?: Array<{
    shop_id: number
    target_pieces: number
    challenge_trigger_pct?: number | string | null
  }>
  /**
   * Objectifs croisés boutique × produit — « ici, 900 cougnous ».
   *
   * Ce sont eux qui font foi : `shop_targets` en est la somme par boutique et
   * `offer.items[].target_pieces` la somme par produit. Une combinaison sans
   * objectif n'est pas envoyée, plutôt qu'envoyée à zéro.
   */
  shop_item_targets?: Array<{
    shop_id: number
    offer_item_id: number
    target_pieces: number
  }>
  /**
   * Palette de la campagne. `null` ou absent = la palette par défaut du module.
   *
   * Quatre couleurs parce qu'un imprimé en demande quatre : un aplat, un texte
   * lisible dessus, une dominante, un accent pour le prix.
   */
  color_primary_hex?: string | null
  color_secondary_hex?: string | null
  color_accent_hex?: string | null
  color_ink_hex?: string | null
  /** Challenge attaché aux objectifs — facultatif. */
  challenge_enabled?: boolean
  challenge_metric?: 'attainment' | 'pieces' | 'growth' | null
  /** Seuil de participation général, en % de l'objectif de chaque boutique. */
  challenge_trigger_pct?: number | string | null
  /** Dotation par rang. Le rang vient de la position, pas d'un champ. */
  challenge_prizes?: Array<{ label: string }>
  sector_ids?: number[]
  agency_ask_ids?: number[]
  b2b_option_ids?: number[]
  uniform_ids?: number[]
  format_ids?: number[]
  channels?: Array<{ channel_id: number; agency_id?: number | null; budget_amount?: number | null }>
  lever_targets?: Array<{ lever_id: number; target_value: number; target_unit?: string | null }>
  retroplanning?: Array<{ label: string; days_before_launch: number; position_id?: number | null }>
  offer?: {
    title: string
    template_id?: number | null
    mechanic_text?: string | null
    starts_on?: string | null
    ends_on?: string | null
    /** Sans contrainte horaire : les heures ne sont alors pas enregistrées. */
    all_day?: boolean
    hour_from?: string | null
    hour_to?: string | null
    /** Plafond de pièces en promotion par ticket ; nul = sans limite. */
    max_qty_per_ticket?: number | string | null
    /** La promotion se cumule avec les autres avantages. */
    is_cumulative?: boolean
    /**
     * Élément choisi au catalogue (libellé + référence) ou saisi en clair.
     * Le serveur accepte aussi la chaîne nue, forme historique des brouillons.
     *
     * Les champs de promotion viennent de l'étape « Prix » : nuls, le produit
     * est dans l'offre sans être bradé.
     */
    items?: Array<OfferItemPayload | string>
  }
  /** Taux de marge appliqué aux produits qui n'ont pas le leur, en %. */
  margin_pct_default?: number | string | null
}

export function createCampaign(
  draft: CampaignDraft,
): Promise<{ inserted_id: number; leads?: LeadGenerationReport }> {
  return request(`${BASE}/campaigns`, { method: 'POST', body: draft })
}

/**
 * Brouillon relu par identifiants, pour être repris dans l'assistant.
 *
 * Distinct de `getCampaign`, qui sert le suivi et rend des libellés : une
 * pastille se recoche avec un identifiant, pas avec « Horeca ».
 */
/** Les quatre rôles de la palette, dans l'ordre où l'écran les propose. */
export interface CampaignColors<T> {
  color_primary_hex: T
  color_secondary_hex: T
  color_accent_hex: T
  color_ink_hex: T
}

export interface CampaignDraftState
  extends Omit<CampaignDraft, 'lever_targets' | 'channels' | 'offer'> {
  id: number
  shop_ids: number[]
  shop_targets: Array<{
    shop_id: number
    target_pieces: number
    challenge_trigger_pct: number | string | null
  }>
  shop_item_targets: Array<{
    shop_id: number
    offer_item_id: number
    target_pieces: number
  }>
  /** Ce que la campagne a choisi — `null` pour ce qu'elle n'a pas choisi. */
  colors: CampaignColors<string | null>
  /** Ce qu'un support doit imprimer : le choix, sinon la valeur par défaut. */
  colors_effective: CampaignColors<string>
  /** Relu avec son rang : l'écran affiche trois rangs, la base peut en porter moins. */
  challenge_prizes: Array<{ rank_position: number; label: string }>
  sector_ids: number[]
  agency_ask_ids: number[]
  b2b_option_ids: number[]
  uniform_ids: number[]
  format_ids: number[]
  /**
   * `is_enabled` : le canal est VALIDÉ, pas seulement retenu. Ce sont les
   * canaux validés qui alimentent « Pub physique » et « Pub digitale ».
   */
  channels: Array<{
    channel_id: number
    agency_id: number | null
    budget_amount: number | null
    is_enabled?: boolean
  }>
  /** `target_value` peut être nul : un levier retenu sans chiffre est légitime. */
  lever_targets: Array<{ lever_id: number; target_value: number | null }>
  retroplanning: Array<{ label: string; days_before_launch: number; position_id: number | null }>
  offer: {
    title: string
    template_id: number | null
    mechanic_text: string | null
    hour_from: string | null
    hour_to: string | null
    max_qty_per_ticket: number | string | null
    is_cumulative: boolean
    items: OfferItemPayload[]
  } | null
}

export function getCampaignDraft(id: number): Promise<CampaignDraftState> {
  return request<CampaignDraftState>(`${BASE}/campaigns/${id}/draft`)
}

/** Remplace le brouillon en entier. PUT : la ressource n'est pas amendée, elle est réécrite. */
export function replaceCampaignDraft(id: number, draft: CampaignDraft): Promise<{ ok: boolean }> {
  return request(`${BASE}/campaigns/${id}/draft`, { method: 'PUT', body: draft })
}

/** Colonnes de la campagne seules — le statut au moment du lancement, par exemple. */
export function updateCampaign(id: number, change: Partial<CampaignDraft>): Promise<{ ok: boolean }> {
  return request(`${BASE}/campaigns/${id}`, { method: 'PATCH', body: change })
}

/**
 * Les objectifs par levier d'une campagne, seuls, quel que soit son statut : un montant vide
 * détache le levier, les leviers non envoyés ne bougent pas.
 */
export function setLeverTargets(id: number, targets: Array<{ lever_id: number; target_value: number | null }>): Promise<{ message: string }> {
  return request(`${BASE}/campaigns/${id}/lever-targets`, { method: 'PUT', body: { lever_targets: targets } })
}

/** Des produits du catalogue ajoutés à l'offre, quel que soit le statut : ajout seul, sans doublon. */
export function addOfferItems(id: number, offerItemIds: number[]): Promise<{ message: string }> {
  return request(`${BASE}/campaigns/${id}/offer-items`, { method: 'POST', body: { offer_item_ids: offerItemIds } })
}

/**
 * Suppression d'une campagne, et de tout ce qui lui est rattaché.
 *
 * Les objectifs par boutique et par produit, l'offre, le planning, les leads et
 * les demandes d'agence partent avec elle : leurs tables sont en cascade sur
 * `mar_campaign`. Sans cela, une campagne effacée laisserait des objectifs
 * derrière elle, que plus aucun écran ne montre et qu'aucune requête ne pense à
 * exclure.
 */
export function deleteCampaign(id: number): Promise<{ status: string; message: string }> {
  return request(`${BASE}/campaigns/${id}`, { method: 'DELETE' })
}

export interface MonitorKpi {
  kpi_code: string
  kpi_label: string | null
  value: number | null
  target_value: number | null
  unit: string | null
  attainment_pct: number | null
}

export interface MonitorShop extends MonitorKpi {
  shop_id: number
  shop_name: string
}

export function getMonitor(id: number): Promise<{ kpis: MonitorKpi[]; shops: MonitorShop[] }> {
  return request(`${BASE}/campaigns/${id}/monitor`)
}

// ---------------------------------------------------------------------------
// Outils de campagne
// ---------------------------------------------------------------------------

/** Référence du catalogue marketing (`mar_offer_item`), reprise de l'ERP. */
export interface OfferItem {
  id: number
  category: string
  sku_ref: string | null
  name: string
  /** Famille de produits, quand la reprise l'a trouvée. */
  detail: string | null
  price_amount: number | null
  /** Photo du catalogue, quand la reprise en a trouvé une. */
  image_url: string | null
  /** Gammes saisonnières où le produit est actif (`mar_offer_item_season`). */
  season_ids: number[]
}

/** Catalogue actif — la source de sélection de l'étape « Offre ». */
export function listOfferItems(): Promise<OfferItem[]> {
  return request<OfferItem[]>(`${BASE}/offer-items`)
}

// ---------------------------------------------------------------------------
// Visuels
// ---------------------------------------------------------------------------

/** Image écrite sur le serveur, rendue par son chemin public. */
export interface UploadedImage {
  /** Chemin relatif à la racine de l'application (`uploads/…`). */
  path: string
  bytes: number
  width: number | null
  height: number | null
  /** Dimensions avant réduction au format d'impression. */
  original_width: number | null
  original_height: number | null
  /** Vrai si le serveur a réduit l'image à l'envoi. */
  resized: boolean
  /** Vrai si l'image reste sous le format d'impression 300 dpi. */
  below_print: boolean
}

/**
 * Envoie une image et rend son chemin.
 *
 * Le contenu voyage en base64 dans le corps JSON, comme le reste du module :
 * un envoi multipart obligerait le routeur à porter les fichiers pour un seul
 * appel.
 */
export function uploadImage(content: string): Promise<UploadedImage> {
  return request<UploadedImage>(`${BASE}/uploads`, { method: 'POST', body: { content } })
}

// ---------------------------------------------------------------------------
// Ventes réelles — l'historique qui éclaire l'étape « Objectifs »
// ---------------------------------------------------------------------------

/** Ventes d'une boutique sur la période, par référence de l'offre. */
export interface ShopSalesRow {
  shop_id: number
  shop_name: string
  /** Pièces vendues par référence (`OfferItem.id`), absentes = zéro. */
  quantities: Record<number, number>
  total: number
  /** Total de la période équivalente N-1, si le comparatif est demandé. */
  total_previous: number | null
  /** Tickets de la période, tous produits confondus. */
  tickets: number
  /** Tickets contenant la référence — numérateur du taux de pénétration. */
  tickets_by_product: Record<number, number>
}

export interface SalesQuantities {
  from: string
  to: string
  compare: boolean
  /** `family` vient de `mar_offer_item.detail` : « Cougnou », « Bûche ». */
  products: Array<{ item_id: number; name: string; family: string | null }>
  shops: ShopSalesRow[]
  network: {
    by_product: Record<number, number>
    /** N-1 par produit, seulement quand le comparatif est demandé. */
    by_product_previous: Record<number, number> | null
    total: number
    total_previous: number | null
    tickets: number
    tickets_by_product: Record<number, number>
  }
  /** Tables de caisse réellement lues, ou `null` si aucune. */
  source: string | null
  /** Historique indisponible (tables absentes…) : des zéros expliqués. */
  warning: string | null
}

export function getSalesQuantities(params: {
  itemIds: number[]
  from: string
  to: string
  compare: boolean
}): Promise<SalesQuantities> {
  return request<SalesQuantities>(`${BASE}/sales/quantities`, {
    query: {
      item_ids: params.itemIds.join(','),
      from: params.from,
      to: params.to,
      compare: params.compare ? 1 : 0,
    },
  })
}

/**
 * Prix de vente d'un produit, tel que l'assistant doit le prendre pour départ.
 *
 * `source` dit d'où vient `price` : `boutiques` quand l'ERP a répondu son
 * tarif, `catalogue` quand c'est le prix réseau repris de `product.
 * suggested_sale_price`, `null` quand aucune des deux sources ne le connaît.
 * L'écran l'affiche : un prix sans provenance est un prix qu'on n'ose pas
 * corriger.
 */
export interface PriceListItem {
  item_id: number
  sku_ref: string | null
  name: string
  catalog_price: number | null
  shop_prices: Array<{
    shop_id: number
    shop_name: string
    price: number
    includes_tax: boolean | null
  }>
  /** Nombre de prix différents pratiqués dans le périmètre. */
  distinct: number
  price: number | null
  source: 'boutiques' | 'catalogue' | null
}

export interface PriceList {
  items: PriceListItem[]
  shops: Array<{ id: number; name: string; erp_shop_id: number | null }>
  /** Ce que l'appel à l'ERP a donné — pour ne pas deviner un silence. */
  erp: {
    configured: boolean
    endpoint: string
    shops_read: number
    rows_read: number
    keys: { product: string; price: string } | null
    errors: string[]
  }
}

export function getPriceList(itemIds: number[]): Promise<PriceList> {
  return request<PriceList>(`${BASE}/price-list`, {
    query: { item_ids: itemIds.join(',') },
  })
}

export interface Promotion {
  id: number
  name: string
  mechanic_type: string
  value_label: string | null
  scope_label: string | null
  availability_label: string | null
  campaign_id: number | null
  campaign_name: string | null
  campaign_status_label: string | null
  campaign_status_text_hex: string | null
  campaign_status_bg_rgba: string | null
}

export function listPromotions(): Promise<Promotion[]> {
  return request<Promotion[]>(`${BASE}/promotions`)
}

/**
 * Offres montées dans l'assistant de campagne.
 *
 * Table distincte de `mar_promotion`, qui vient de l'import catalogue : sans
 * cet appel, une offre créée à l'étape 2 n'apparaissait nulle part dans
 * l'onglet « Promotions » — l'endroit où on va la chercher.
 */
export interface CampaignOffer {
  id: number
  title: string
  mechanic_text: string | null
  starts_on: string | null
  ends_on: string | null
  hour_from: string | null
  hour_to: string | null
  template_label: string | null
  campaign_id: number
  campaign_name: string
  campaign_status_label: string
  campaign_status_text_hex: string
  campaign_status_bg_rgba: string
  items_count: number
}

export function listCampaignOffers(): Promise<CampaignOffer[]> {
  return request<CampaignOffer[]>(`${BASE}/campaign-offers`)
}

export interface BundleItem {
  name: string
  detail: string | null
  quantity: number
  price_amount: number | null
}

export interface Bundle {
  id: number
  name: string
  price_amount: number | null
  margin_pct: number | null
  image_url: string | null
  items: BundleItem[]
}

export function listBundles(): Promise<Bundle[]> {
  return request<Bundle[]>(`${BASE}/bundles`)
}

export interface Voucher {
  id: number
  code: string
  mechanic_label: string | null
  scope_label: string | null
  usage_limit_label: string | null
  status: string
  source: string | null
  partner_name: string | null
  campaign_id: number | null
  campaign_name: string | null
  /** Compté sur les utilisations réelles, et cloisonné au périmètre de l'appelant. */
  redemptions: number
  discount_total: number
  channels: string[]
}

export function listVouchers(): Promise<Voucher[]> {
  return request<Voucher[]>(`${BASE}/vouchers`)
}

// ---------------------------------------------------------------------------
// Promotions de l'ERP — lues sur son API par le module (route au format du
// standard : enveloppe, camelCase, montants en centimes)
// ---------------------------------------------------------------------------

export type ErpPromotionFamily = 'bundle' | 'buyXGetY' | 'quantity' | 'scheduledDiscount' | 'voucher'

/** Une récompense : offerte, en pourcentage, montant retiré ou prix fixe. */
export interface ErpReward {
  type: 'free' | 'percentage' | 'amountOff' | 'fixedPrice'
  percent: number | null
  amountCents: number | null
}

export interface ErpPromotion {
  id: string
  family: ErpPromotionFamily
  erpId: number
  name: string
  description: string | null
  /** DRAFT · ACTIVE · INACTIVE, tel que l'ERP le dit. */
  status: string
  /** AUTOMATIC · VOUCHER_ONLY (la promotion ne joue qu'avec un bon). */
  activationMode: string | null
  priority: number
  shopScope: 'all' | 'selected'
  shops: { erpShopId: number; name: string | null }[]
  /** Jours ISO (1 = lundi … 7 = dimanche), heure de début incluse, de fin exclue. */
  schedule: { dayOfWeek: number; from: string; to: string }[]
  validFrom: string | null
  validTo: string | null
  mechanic: {
    priceCents?: number | null
    currency?: string
    buyQuantity?: number | null
    getQuantity?: number | null
    reward?: ErpReward | null
    mechanism?: string | null
    quantity?: number | null
    freeQuantity?: number | null
    codeType?: string
    sharedCode?: string | null
    plannedPromotionType?: string | null
    promotionErpId?: number | null
    requiresCustomer?: boolean
  }
  products: { erpProductId: number; name: string | null; quantity: number | null; role: 'item' | 'trigger' | 'reward' | 'eligible' }[]
  categories: { erpCategoryId: number }[]
}

/** Ce qu'une famille a donné — ou pourquoi elle n'a rien donné (droit manquant, ERP injoignable). */
export interface ErpPromotionSource {
  ok: boolean
  count: number
  error: string | null
}

export interface ErpPromotionList {
  promotions: ErpPromotion[]
  sources: Partial<Record<ErpPromotionFamily, ErpPromotionSource>>
  /** Faux : l'adresse de l'ERP n'est pas renseignée sur le serveur, rien n'a été tenté. */
  configured: boolean
}

interface ErpPromotionEnvelope {
  success: boolean
  data: ErpPromotion[]
  meta: { sources?: ErpPromotionList['sources']; configured?: boolean }
}

/** Les promotions de l'ERP (une famille, ou toutes) — cent au plus, l'écran n'en montre pas davantage. */
export async function listErpPromotions(family?: ErpPromotionFamily): Promise<ErpPromotionList> {
  const body = await request<ErpPromotionEnvelope>(`${BASE}/erp-promotions`, {
    query: family ? { family, perPage: 100 } : { perPage: 100 },
  })

  return { promotions: body.data ?? [], sources: body.meta?.sources ?? {}, configured: body.meta?.configured === true }
}

// ---------------------------------------------------------------------------
// Bons d'une campagne — ils vivent dans le webshop, relus par son API
// ---------------------------------------------------------------------------

/** `percent` · `fixed` (€) · `product` (produit offert) · `free_delivery`. */
export type VoucherMechanic = 'percent' | 'fixed' | 'product' | 'free_delivery' | 'promotions'

/** Une promotion que déclenche un bon « promotions », telle que le webshop la garde. */
export interface VoucherPromotion {
  /** Ligne de l'offre (étape Prix) rapprochée ; null si elle n'y est plus. */
  offer_item_id: number | null
  product_name: string
  mechanic: string
  /** Libellé du panier : « Bûche : 2 achetés → 1 offert ». */
  label: string
}

/** Une promotion de l'étape Prix, et si elle peut partir au webshop. */
export interface CampaignPromotion {
  offer_item_id: number
  label: string
  mechanic: string
  mechanic_label: string
  /** La valeur en clair : « −15 % », « 2 achetés → 1 offert » ; vide si rien n'est saisi. */
  text: string
  webshop: boolean
  /** Pourquoi elle ne part pas au webshop, quand elle ne part pas. */
  reason: string | null
}

/** Un bon tel que le webshop le sert. Null partout si le webshop ne l'a pas. */
export interface WebshopVoucher {
  code: string
  found: boolean
  active: boolean | null
  mechanic: VoucherMechanic | null
  value: number | null
  min_order: number | null
  scope_product_name: string | null
  scope_max_qty: number | null
  /** « Marque », ou le nom de la boutique qui l'a émis. */
  issuer: string | null
  target_kind: 'NETWORK' | 'OFFICE' | 'CUSTOMER' | 'GROUP' | null
  target_label: string | null
  starts_on: string | null
  ends_on: string | null
  usage_count: number | null
  usage_limit: number | null
  per_customer: number | null
  /** Bon « promotions » : celles qu'il déclenche ; null pour les autres bons. */
  promotions: VoucherPromotion[] | null
  /** L'étape Prix a changé depuis l'envoi au webshop (null hors campagne). */
  promotions_changed: boolean | null
}

export interface VoucherResults {
  orders: number
  revenue: number
  discount: number
  by_shop: Array<{ shop_name: string; orders: number; revenue: number; discount: number }>
}

export interface CampaignVoucher extends WebshopVoucher {
  /** `created` : créé pour la campagne (le retirer le suspend) ; `attached` : bon existant suivi. */
  origin: 'created' | 'attached'
  results: VoucherResults | null
}

export interface CampaignVouchers {
  /** Connexion au webshop configurée sur le serveur. */
  configured: boolean
  /** Pourquoi la liste manque, quand elle manque. */
  message: string | null
  can_edit: boolean
  vouchers: CampaignVoucher[]
  totals: { orders: number; revenue: number; discount: number; average_basket: number | null } | null
  /** Les promotions de l'étape Prix qu'un bon peut déclencher. */
  campaign_promotions: CampaignPromotion[]
}

/** Ce que l'écran envoie pour créer ou modifier un bon. */
export interface VoucherInput {
  mechanic?: VoucherMechanic
  value?: string
  offer_item_id?: number | null
  max_qty?: string
  min_order?: string
  code?: string
  starts_on?: string
  ends_on?: string
  usage_total?: string
  per_customer?: string
  target_kind?: 'NETWORK' | 'OFFICE'
  target_id?: number | null
  /** Mécanique « promotions » : les lignes de l'étape Prix cochées. */
  promotions?: number[]
}

export function campaignVouchers(campaignId: number): Promise<CampaignVouchers> {
  return request<CampaignVouchers>(`${BASE}/campaigns/${campaignId}/vouchers`)
}

/** `inserted_id` : le code du bon créé (généré par le webshop si on n'en donne pas). */
export function createCampaignVoucher(campaignId: number, input: VoucherInput): Promise<{ message: string; inserted_id: string }> {
  return request(`${BASE}/campaigns/${campaignId}/vouchers`, { method: 'POST', body: input })
}

export function updateCampaignVoucher(campaignId: number, code: string, input: VoucherInput): Promise<{ message: string }> {
  return request(`${BASE}/campaigns/${campaignId}/vouchers/${encodeURIComponent(code)}`, { method: 'PATCH', body: input })
}

export function attachCampaignVoucher(campaignId: number, code: string): Promise<{ message: string }> {
  return request(`${BASE}/campaigns/${campaignId}/vouchers/${encodeURIComponent(code)}`, { method: 'PUT' })
}

export function detachCampaignVoucher(campaignId: number, code: string): Promise<{ message: string }> {
  return request(`${BASE}/campaigns/${campaignId}/vouchers/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export interface AttachableVoucher extends WebshopVoucher {
  campaign_id: number | null
  campaign_name: string | null
}

export function webshopVouchers(query: string): Promise<{ configured: boolean; message: string | null; vouchers: AttachableVoucher[] }> {
  return request(`${BASE}/webshop-vouchers`, { query: { q: query } })
}

export function webshopOffices(query: string): Promise<Array<{ id: number; name: string; city: string | null }>> {
  return request(`${BASE}/webshop-offices`, { query: { q: query } })
}

// ---------------------------------------------------------------------------
// Leads B2B
// ---------------------------------------------------------------------------

export interface Lead {
  id: number
  company_name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  size_label: string | null
  potential_amount: number | null
  status_code: string
  status_label: string
  color_hex: string
  bg_hex: string
  border_hex: string
  sector_label: string | null
  shop_id: number | null
  shop_name: string | null
  initials: string
}

export interface FunnelStep {
  status_code: string
  status_label: string
  color_hex: string
  bg_hex: string
  border_hex: string
  leads_count: number
}

export function getLeads(campaignId: number): Promise<{ leads: Lead[]; funnel: FunnelStep[] }> {
  return request(`${BASE}/campaigns/${campaignId}/leads`)
}

/** Le serveur écrit l'historique en même temps que l'état courant. */
export function setLeadStatus(leadId: number, statusCode: string, note?: string) {
  return request(`${BASE}/leads/${leadId}/status`, {
    method: 'PATCH',
    body: { status_code: statusCode, note },
  })
}

// ---------------------------------------------------------------------------
// Vivier B2B
// ---------------------------------------------------------------------------

/**
 * Effectif d'un secteur, sous deux angles qui ne disent pas la même chose :
 * `estimated_leads_count` est une intention de démarchage, `available` ce
 * qu'on a réellement sous la main.
 */
export interface SectorAvailability {
  id: number
  code: string
  label: string
  estimated_leads_count: number
  available: number
}

/** Un compte du vivier, tel que le panneau de l'assistant l'affiche. */
export interface Prospect {
  id: number
  company_name: string
  contact_name: string | null
  contact_email: string | null
  city: string | null
  postal_code: string | null
  shop_id: number | null
  shop_name: string | null
  sector_label: string | null
  /** La fiche client de l'ERP porte la livraison au bureau. */
  is_office: boolean
}

/**
 * Comptes distincts des secteurs retenus.
 *
 * Un compte relevant de deux secteurs cochés ne produit qu'un lead : additionner
 * les effectifs par secteur annoncerait plus de comptes qu'il n'en sera créé.
 */
/**
 * Effectifs du vivier.
 *
 * `shopIds` restreint aux comptes rattachés à ces boutiques — la boutique
 * préférée du client dans l'ERP. Vide pour une campagne réseau : elle vise tout
 * le monde. `network` et `without_shop` disent ce que la restriction a écarté,
 * pour que l'écran distingue « le périmètre est petit » de « le vivier est
 * vide » — deux situations qui appellent des décisions opposées.
 */
export interface ProspectCount {
  total: number
  network: number
  without_shop: number
  /**
   * Bureaux à livrer dans ce périmètre — comptés SANS le filtre, sinon le
   * chiffre vaudrait toujours le total et n'apprendrait rien avant le clic.
   * `null` : le vivier ne sait pas encore le dire (rejeu des référentiels ou
   * reprise ERP en attente), et le bouton reste éteint plutôt que menteur.
   */
  offices: number | null
}

export function countProspects(
  sectorIds: number[],
  shopIds: number[] = [],
  officesOnly = false,
): Promise<ProspectCount> {
  return request<ProspectCount>(`${BASE}/b2b/prospects/count`, {
    query: {
      sector_ids: sectorIds.join(','),
      shop_ids: shopIds.join(','),
      offices_only: officesOnly ? '1' : '',
    },
  })
}

export function listProspects(
  sectorIds: number[],
  shopIds: number[] = [],
  officesOnly = false,
): Promise<Prospect[]> {
  return request<Prospect[]>(`${BASE}/b2b/prospects`, {
    query: {
      sector_ids: sectorIds.join(','),
      shop_ids: shopIds.join(','),
      offices_only: officesOnly ? '1' : '',
    },
  })
}

export function getSectorAvailability(shopIds: number[] = []): Promise<SectorAvailability[]> {
  return request<SectorAvailability[]>(`${BASE}/b2b/sectors`, {
    query: { shop_ids: shopIds.join(',') },
  })
}

/** Une ligne du fichier importé, déjà découpée par le client. */
export interface ProspectRow {
  external_ref?: string
  company_name: string
  sector?: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  size_label?: string
  potential_amount?: string
  city?: string
  postal_code?: string
}

export interface ImportReport {
  imported: number
  updated: number
  skipped: number
  /** Sans référence d'origine, un réimport ne saura pas reconnaître le compte. */
  without_ref: number
  errors: string[]
}

/**
 * Compte rendu d'une reprise ERP.
 *
 * `columns` dit quelles colonnes de l'ERP ont été retenues : c'est le seul
 * moyen de vérifier, sans accès à la base, que la reprise a lu ce qu'on croit.
 */
export interface SyncReport {
  source: string
  columns: Record<string, string>
  read: number
  created: number
  updated: number
  skipped: number
  /** Secteurs de l'installation initiale sortis de la liste. */
  retired?: number
  warning?: string
}

/**
 * Rattachement des comptes à leurs secteurs.
 *
 * Compté à part des trois reprises : ce n'est pas un nombre de fiches créées
 * mais un nombre de liens, et il échoue seul — d'où `error`, qui dit pourquoi
 * plutôt que de laisser un tableau à zéro.
 */
export interface SectorLinkReport {
  source?: string
  columns?: Record<string, string>
  /** Part des valeurs de chaque colonne retenue qui existe dans la table visée. */
  match?: string
  read?: number
  linked?: number
  unknown_client?: number
  unknown_sector?: number
  removed?: number
  /** Comptes du vivier sans aucun secteur : aucune génération ne les retiendra. */
  without_sector?: number
  warning?: string
  error?: string
}

export interface SyncResult {
  shops: SyncReport
  prospects: SyncReport
  sectors?: SyncReport
  links?: SectorLinkReport
  /** Reprise du catalogue produit. Échoue seule, comme les rattachements. */
  products?: SyncReport | { error: string }
  /** Reprise des gammes saisonnières, même marge que le catalogue. */
  seasons?: SyncReport | { error: string }
  /** Liens produit ↔ gamme, réécrits en bloc à chaque reprise. */
  season_links?: {
    source?: string
    read?: number
    linked?: number
    unknown_product?: number
    unknown_season?: number
    error?: string
  }
}

export function syncErp(): Promise<SyncResult> {
  return request(`${BASE}/erp/sync`, { method: 'POST' })
}

export function importProspects(rows: ProspectRow[], source?: string): Promise<ImportReport> {
  return request(`${BASE}/b2b/prospects/import`, { method: 'POST', body: { rows, source } })
}

export interface LeadGenerationReport {
  created: number
  skipped_existing: number
  available: number
  shops: number
  /** Renseignée quand rien n'a été créé : dit pourquoi. */
  reason: string | null
}

export function generateLeads(campaignId: number): Promise<LeadGenerationReport> {
  return request(`${BASE}/campaigns/${campaignId}/leads/generate`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Fonds & ROI
// ---------------------------------------------------------------------------

/**
 * Un type de campagne tel que l'éditeur le manipule : la version complète, avec
 * ce qui est masqué ailleurs — l'ordre, l'activation, et le nombre de campagnes
 * qui s'en réclament, qui décide si la suppression a un sens.
 */
export interface CampaignTypeAdmin extends CampaignType {
  lever_badge_label: string | null
  sort_order: number
  is_active: boolean
  campaigns: number
}

export interface IconChoice {
  key: string
  label: string
  path: string
}

export function listCampaignTypes(): Promise<{ types: CampaignTypeAdmin[]; icons: IconChoice[] }> {
  return request(`${BASE}/campaign-types`)
}

/** Le code n'est pas modifiable : il ancre les jeux de données et les reprises. */
export interface CampaignTypeDraft {
  label: string
  description?: string | null
  color_hex?: string | null
  icon_key?: string | null
  lever_id?: number | null
  lever_badge_label?: string | null
  default_kpi_label?: string | null
  is_active?: boolean
}

export function addCampaignType(type: CampaignTypeDraft): Promise<{ inserted_id: number }> {
  return request(`${BASE}/campaign-types`, { method: 'POST', body: type })
}

export function updateCampaignType(
  id: number,
  type: CampaignTypeDraft,
): Promise<{ message: string }> {
  return request(`${BASE}/campaign-types/${id}`, { method: 'PATCH', body: type })
}

export function deleteCampaignType(id: number): Promise<{ message: string }> {
  return request(`${BASE}/campaign-types/${id}`, { method: 'DELETE' })
}

export function reorderCampaignTypes(ids: number[]): Promise<{ reordered: number }> {
  return request(`${BASE}/campaign-types/order`, { method: 'PUT', body: { ids } })
}

export interface LedgerRow {
  id: number
  movement_date: string
  /** Période couverte, quand le mouvement en couvre une. Les deux, ou aucune. */
  period_from: string | null
  period_to: string | null
  direction: 'IN' | 'OUT'
  label: string
  amount: number
  signed_amount: number
  source: string
  supplier_name: string | null
  document_ref: string | null
  shop_id: number | null
  shop_name: string | null
  campaign_id: number | null
  campaign_name: string | null
  lever_id: number | null
  lever_label: string | null
  lever_color_hex: string | null
  /** Non nul : la ligne est une échéance écrite par un frais récurrent. */
  recurrence_id: number | null
  /** Faux : ligne réservée à la marque, invisible pour le réseau. */
  is_public: boolean
  /** Vrai si la ligne est rattachée à une campagne (badge de liaison). */
  is_linked: boolean
}

export interface LedgerPeriod {
  period_key: string
  entries: LedgerRow[]
  entries_total: number
  exits: LedgerRow[]
  exits_total: number
  opening_balance: number
  closing_balance: number
}

export type Granularity = 'month' | 'quarter' | 'year'

export function getLedger(
  granularity: Granularity = 'month',
  from?: string,
  to?: string,
): Promise<{ granularity: Granularity; periods: LedgerPeriod[]; closing_balance: number }> {
  return request(`${BASE}/funds/ledger`, { query: { granularity, from, to } })
}

/**
 * Un mouvement du fonds, tel que l'écran le saisit.
 *
 * Le montant est toujours positif : c'est `direction` qui porte le signe, et
 * un « −100 € » en sortie créditerait le fonds au lieu de le débiter.
 */
export interface MovementDraft {
  direction: 'IN' | 'OUT'
  movement_date: string
  label: string
  amount: number
  /** Période couverte — les deux bornes, ou aucune. */
  period_from?: string | null
  period_to?: string | null
  lever_id?: number | null
  supplier_name?: string | null
  campaign_id?: number | null
  shop_id?: number | null
  source?: string | null
  document_ref?: string | null
  /** Absent = publique. Le fonds se rend des comptes ; le silence se demande. */
  is_public?: boolean
}

export function addMovement(movement: MovementDraft): Promise<{ inserted_id: number }> {
  return request(`${BASE}/funds/movements`, { method: 'POST', body: movement })
}

/** Correction d'une écriture : le même contrat qu'à la saisie, sur une ligne. */
export function updateMovement(id: number, movement: MovementDraft): Promise<{ message: string }> {
  return request(`${BASE}/funds/movements/${id}`, { method: 'PATCH', body: movement })
}

export function deleteMovement(id: number): Promise<{ message: string }> {
  return request(`${BASE}/funds/movements/${id}`, { method: 'DELETE' })
}

/** Le rythme d'un frais récurrent. Trois cadences : le fonds n'en paie pas d'autres. */
export type Frequency = 'month' | 'quarter' | 'year'

/**
 * Un frais récurrent : un modèle, qui écrit de vraies échéances au grand livre.
 *
 * `amount` est le montant d'une échéance, jamais le total — c'est la question
 * que pose un abonnement (« combien par mois ? »), et le total s'en déduit.
 */
export interface RecurrenceDraft {
  direction: 'IN' | 'OUT'
  frequency: Frequency
  label: string
  amount: number
  starts_on: string
  ends_on: string
  lever_id?: number | null
  supplier_name?: string | null
  campaign_id?: number | null
  shop_id?: number | null
  source?: string | null
  document_ref?: string | null
}

export interface Recurrence extends RecurrenceDraft {
  id: number
  shop_name: string | null
  campaign_name: string | null
  lever_label: string | null
  lever_color_hex: string | null
  /** Nombre d'échéances déjà écrites, et leur somme. */
  occurrences: number
  total_amount: number
}

export function listRecurrences(): Promise<Recurrence[]> {
  return request<Recurrence[]>(`${BASE}/funds/recurrences`)
}

export function addRecurrence(
  recurrence: RecurrenceDraft,
): Promise<{ inserted_id: number; occurrences: number; total_amount: number }> {
  return request(`${BASE}/funds/recurrences`, { method: 'POST', body: recurrence })
}

export function deleteRecurrence(id: number): Promise<{ message: string }> {
  return request(`${BASE}/funds/recurrences/${id}`, { method: 'DELETE' })
}

export interface LeverPerformance {
  lever_id: number
  lever_code: string
  lever_label: string
  color_hex: string
  spent_amount: number
  target_value: number
  actual_value: number
  roi_value: number | null
  penetration_pct: number | null
}

// ---------------------------------------------------------------------------
// Agences et prestataires
// ---------------------------------------------------------------------------

export interface Agency {
  id: number
  name: string
  speciality: string | null
  lever_code: string | null
  lever_label: string | null
  lever_color_hex: string | null
  avg_roi: number | null
  hit_rate_pct: number | null
  avg_cost_amount: number | null
  /** Colonne dénormalisée, conservée pour qu'un écart avec le compte réel se voie. */
  campaigns_count: number
  interventions: number
  fees_total: number
  roi_measured: number | null
}

export function listAgencies(): Promise<Agency[]> {
  return request<Agency[]>(`${BASE}/agencies`)
}

export interface AgencyIntervention {
  id: number
  campaign_name: string
  channel_label: string | null
  fee_amount: number | null
  roi_value: number | null
}

export function getAgencyInterventions(agencyId: number): Promise<AgencyIntervention[]> {
  return request<AgencyIntervention[]>(`${BASE}/agencies/${agencyId}/campaigns`)
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export interface CostKind {
  cost_kind: string
  lines_count: number
  total_amount: number
  /** Les sources de calcul, concaténées : c'est ce qui rend un chiffre contestable. */
  sources: string | null
}

export function getAnalysis(): Promise<{ levers: LeverPerformance[]; costs: CostKind[] }> {
  return request(`${BASE}/analysis`)
}

// ---------------------------------------------------------------------------
// Réseau : CRM, présence locale, kits
// ---------------------------------------------------------------------------

export interface CrmSegment {
  id: number
  code: string
  label: string
  color_hex: string | null
  customers_count: number
}

export interface CrmSummary {
  customers: number
  opted_in: number
  total_spent: number
  avg_orders: number
}

export function getCrm(): Promise<{ segments: CrmSegment[]; summary: CrmSummary }> {
  return request(`${BASE}/crm`)
}

// Réexport pour les écrans d'alias, qui restent servis par l'ERP.
export type { AliasType, LangCode }

// ---------------------------------------------------------------------------
// KPI d'une période — lu par le cockpit, pas par le module
// ---------------------------------------------------------------------------

/**
 * Le KPI du levier sur la période choisie, comparé à N-1.
 *
 * Servi par le COCKPIT (`/api/cockpit/marketing/kpi-periode`) et non par le
 * module : c'est lui qui tient le compte du panel, et c'est la même mécanique
 * que son écran « Mesure des campagnes ». La refaire ici donnerait deux
 * réponses à « combien a fait septembre l'an dernier », sans moyen de savoir
 * laquelle croire.
 */
export interface KpiDefinition {
  cle: string
  nom: string
  unite: string
  decimales: number
  calcul: string
}

export interface KpiBloc {
  ca: number
  tickets: number
  jours: number
  caJour: number | null
  ticketsJour: number | null
  panier: number | null
}

export interface KpiLigne {
  id: string
  nom: string
  avant: KpiBloc
  pendant: KpiBloc
  valeurAvant: number | null
  valeurPendant: number | null
  variation: number | null
  /** Aucun relevé sur les mêmes dates l'an dernier. */
  sansN1: boolean
  /**
   * Repli quand N-1 manque : la moyenne des trois derniers mois clos. Un
   * magasin ouvert cette année a une activité — elle vaut mieux qu'une case
   * vide, à condition de dire que c'en est une.
   */
  repli: { valeur: number; du: string; au: string; jours: number; libelle: string } | null
  /** La valeur affichée, quelle que soit sa provenance. */
  valeurRetenue: number | null
  /** `n1` | `repli` | null — jamais un chiffre sans sa provenance. */
  source: 'n1' | 'repli' | null
}

export interface KpiLevier {
  id: number
  code: string
  nom: string
  couleur: string
  /** `null` : rien de mesurable en caisse — `raison` dit pourquoi. */
  mesure: string | null
  kpi: KpiDefinition | null
  raison: string | null
}

export interface KpiPeriode {
  fenetres: {
    du: string
    au: string
    jours: number
    avantDu: string
    avantAu: string
    avantN1Du: string
    avantN1Au: string
    pendantN1Du: string
    pendantN1Au: string
    decalage: number
    repliDu: string
    repliAu: string
  }
  mesure: string
  kpi: KpiDefinition
  catalogue: Record<string, KpiDefinition>
  leviers: KpiLevier[]
  levierDemande: string | null
  levierMesurable: boolean | null
  magasins: KpiLigne[]
  reseau: {
    avant: KpiBloc
    pendant: KpiBloc
    valeurAvant: number | null
    /** Cumul N-1 seul — sert à la variation, pas au total affiché. */
    valeurPendant: number | null
    /** Le total qui ÉGALE la somme des lignes, replis compris. */
    valeurRetenue: number | null
    source: 'n1' | 'repli' | 'mixte'
    nN1: number
    nRepli: number
    nSans: number
    variation: number | null
    sansN1: boolean
  }
  motifs: string[]
  source: string
}

export function getKpiPeriode(query: {
  from: string
  to: string
  lever?: string | null
  metric?: string | null
  shopIds?: string[]
}): Promise<KpiPeriode> {
  const params = new URLSearchParams({ du: query.from, au: query.to })
  if (query.lever) params.set('levier', query.lever)
  if (query.metric) params.set('mesure', query.metric)
  if (query.shopIds && query.shopIds.length > 0) params.set('magasins', query.shopIds.join(','))

  return request<KpiPeriode>(`${COCKPIT_ROOT}/api/cockpit/marketing/kpi-periode?${params.toString()}`)
}

// ---------------------------------------------------------------------------
// Annexes d'une campagne — servies par le cockpit
// ---------------------------------------------------------------------------

/**
 * Les documents joints à une campagne : plan de publication, liste des
 * produits, bon de commande. Ceux qui portent `enMail` partent avec la note
 * envoyée aux franchisés.
 *
 * Servis par le COCKPIT, comme le KPI et la note : c'est lui qui écrit sur le
 * disque et qui envoie les courriels. Le module n'aurait qu'une copie du
 * fichier et une seconde vérité sur ce qui est joint.
 */
export interface Annexe {
  id: number
  nom: string
  type: string
  typeId: number | null
  fichier: string
  taille: number
  tailleTxt: string
  enMail: boolean
  depuis: string
  /** Le fichier est-il encore sur le serveur ? Une ligne peut lui survivre. */
  existe: boolean
}

export interface AnnexeType {
  id: number
  nom: string
  /** Nombre d'annexes rangées sous ce type — retirer n'efface pas l'historique. */
  utilise: number
}

export interface AnnexesEtat {
  annexes: Annexe[]
  types: AnnexeType[]
  maxOctets: number
}

const COCKPIT = `${COCKPIT_ROOT}/api/cockpit`

export function getAnnexes(campaignId: number): Promise<AnnexesEtat> {
  return request<AnnexesEtat>(`${COCKPIT}/marketing/campagne/${campaignId}/annexes`)
}

export function addAnnexe(
  campaignId: number,
  body: { nom: string; typeId?: number | null; typeNom?: string; fichier: string; enMail?: boolean },
): Promise<AnnexesEtat & { ok?: boolean; error?: string }> {
  return request(`${COCKPIT}/marketing/campagne/${campaignId}/annexe`, { method: 'POST', body })
}

export function updateAnnexe(
  annexeId: number,
  body: { enMail?: boolean; nom?: string; typeId?: number | null; typeNom?: string },
): Promise<AnnexesEtat> {
  return request(`${COCKPIT}/marketing/annexe/${annexeId}`, { method: 'PATCH', body })
}

export function removeAnnexe(annexeId: number): Promise<AnnexesEtat> {
  return request(`${COCKPIT}/marketing/annexe/${annexeId}`, { method: 'DELETE' })
}

export function removeAnnexeType(typeId: number): Promise<{ types: AnnexeType[] }> {
  return request(`${COCKPIT}/marketing/annexe-type/${typeId}`, { method: 'DELETE' })
}

/** L'adresse du fichier, pour l'ouvrir dans un onglet. */
export function annexeHref(annexeId: number): string {
  return `${COCKPIT}/marketing/annexe/${annexeId}/fichier`
}

// ---------------------------------------------------------------------------
// Ce que le module Social & Ads a rattaché à une campagne
// ---------------------------------------------------------------------------

/** Une publicité Meta rattachée à la campagne, avec les chiffres gardés par le module Social. */
export interface SocialAd {
  id: string
  nom: string
  statut: string
  origine: 'meta' | 'module'
  debut: string | null
  fin: string | null
  clics: number | null
  affichages: number | null
  depense: number
  devise: string
}

/**
 * Posts, publications et publicités rattachés à une campagne dans le module Social
 * (`GET /operations/bo-{id}/rattache`), et l'adresse du webshop d'où partent les liens
 * suivis. Lecture seule : le module Social ne demande rien à Meta pour répondre.
 */
export interface SocialAttached {
  operation: string
  posts: { total: number; parStatut: Record<string, number> }
  publicationsMeta: number
  publicites: SocialAd[]
  /** `devise` null : plusieurs devises, la somme n'a pas de sens. */
  totaux: { clics: number; affichages: number; depense: number; devise: string | null }
  webshop: string
}

export function getSocialAttached(campaignId: number): Promise<SocialAttached> {
  return request<SocialAttached>(`${SOCIAL_ROOT}/api/v1/social/operations/bo-${campaignId}/rattache`)
}

/** Un écran du module Social, ouvert sur la campagne (`op` : identifiant de la campagne ici). */
export function socialScreen(file: string, campaignId: number | null): string {
  return `${SOCIAL_ROOT}/${encodeURIComponent(file)}${campaignId === null ? '' : `?op=${campaignId}`}`
}


// ---------------------------------------------------------------------------
// Le calendrier marketing : ce que les autres modules ont prévu ou publié
// ---------------------------------------------------------------------------

/** Un post du module Social (création, validation, programmation, publication). */
export interface SocialPost {
  id: string
  date: string
  time: string
  type: string
  title: string
  /** Chemin relatif au module Social (`uploads/…`) ou adresse absolue. */
  img: string | null
  fb: boolean
  ig: boolean
  /** Canaux par boutique : `{ "4": { fb: true, ig: false } }`. */
  ch: Record<string, { fb?: boolean; ig?: boolean }> | null
  shops: string[] | null
  status: string
  /** `bo-19` : la campagne du Marketing à laquelle le post est rattaché. */
  campaign: string | null
}

/** Une publicité Meta suivie par le module Social. */
export interface SocialAdItem {
  id: string
  name: string
  status: string
  start: string | null
  end: string | null
  campaign: string | null
  spent: number | null
  devise: string | null
  lienMeta: string | null
  gone: boolean
}

export interface SocialState {
  posts: SocialPost[]
  ads: SocialAdItem[]
}

/** L'état du module Social : ses posts et les publicités Meta qu'il suit. */
export function getSocialState(): Promise<SocialState> {
  return request<SocialState>(`${SOCIAL_ROOT}/api/v1/social/state`)
}

/** Une publication lue sur une Page Facebook ou un compte Instagram, hors posts du module. */
export interface MetaPost {
  id: string
  channel: 'Facebook' | 'Instagram'
  accountName: string
  date: string
  time: string
  type: string
  title: string
  img: string | null
  status: string
  permalink: string | null
  campaign: string | null
  stats: { reactions?: number | null; comments?: number | null; shares?: number | null } | null
}

/**
 * Les publications des Pages et comptes Instagram sur une période (100 jours au plus).
 * Le module Social les relit chez Meta à chaque appel : comptez une dizaine de secondes.
 */
export function getMetaCalendar(du: string, au: string): Promise<{ posts: MetaPost[]; erreurs: string[] }> {
  return request<{ posts: MetaPost[]; erreurs: string[] }>(
    `${SOCIAL_ROOT}/api/v1/social/meta/calendriers?du=${du}&au=${au}`,
  )
}

/** Un avis Google d'une boutique, lu dans les fiches raccordées au BO. */
export interface GoogleReview {
  id: string
  boutique: string
  note: number | null
  /** `2026-09-08 12:00` */
  le: string
  message: string
}

export interface GoogleOverview {
  avis: GoogleReview[]
  reputation: { cible: number | null; reseau: { moyenne: number | null } | null }
}

export function getGoogleOverview(): Promise<GoogleOverview> {
  return request<GoogleOverview>(`${SOCIAL_ROOT}/api/v1/social/google`)
}

/** Une newsletter ou un SMS du cockpit. `exemple` : modèle de démonstration, jamais envoyé. */
export interface CockpitNewsletter {
  id: number
  nom: string
  objet: string | null
  /** `draft` | `sched` | `live` | `sent` */
  statut: string
  /** `email` | `sms` | `both` */
  canal: string | null
  envoiLe: string | null
  exemple: boolean
}

export function getCockpitNewsletters(): Promise<CockpitNewsletter[]> {
  return request<{ emailing?: { liste?: CockpitNewsletter[] } }>(`${COCKPIT}/marketing/hub`).then(
    (hub) => hub.emailing?.liste ?? [],
  )
}

/** L'adresse d'un visuel du module Social, qu'il soit relatif à son dossier ou déjà absolu. */
export function socialAsset(path: string | null): string | null {
  if (!path) return null

  return /^(https?:)?\/\//.test(path) || path.startsWith('data:') ? path : `${SOCIAL_ROOT}/${path.replace(/^\.?\//, '')}`
}

// ---------------------------------------------------------------------------
// Ventes mensuelles par boutique, lues par le cockpit
// ---------------------------------------------------------------------------

/**
 * Un mois d'une boutique tel que le panel le rend : CA, tickets et panier moyen.
 * Les champs restent à null tant que le mois n'a rien de vendu.
 */
export interface StoreMonth {
  /** Le numéro de la boutique au panel et en caisse : le `N` de son code `erp-N` ici. */
  storeId: string
  annee: number
  /** 1 à 12 */
  mois: number
  ca: number | null
  tickets: number | null
  panierMoyen: number | null
}

/**
 * Les mois des années demandées, toutes boutiques du panel (`GET /api/cockpit/stores/perf`,
 * la lecture du tableau des magasins et des leviers du cockpit). Le mois en cours y est,
 * à date ; c'est à l'écran de l'écarter s'il ne veut que des mois clos.
 */
export function getStoreMonths(years: number[]): Promise<StoreMonth[]> {
  return request(`${COCKPIT}/stores/perf`, { query: { annees: years.join(',') } })
}
