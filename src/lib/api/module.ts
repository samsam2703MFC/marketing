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
const API_ROOT = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

const BASE = `${API_ROOT}/api/v1/marketing`

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
export interface References {
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
  tone: string | null
  tone_label: string | null
  objective_coef_pct: number | null
  agency_note: string | null
  b2b_webshop_enabled: number | boolean
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
  tone?: string | null
  /** Objectif exprimé en écart au N-1 : « N-1 + 12 % ». */
  objective_coef_pct?: number | null
  agency_note?: string | null
  b2b_webshop_enabled?: boolean
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
  channels: Array<{ channel_id: number; agency_id: number | null; budget_amount: number | null }>
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

/** Barre de calendrier : le mois de départ et la portée viennent du serveur. */
export interface CalendarBar extends Campaign {
  start_month: number
  span_months: number
}

export function getCalendar(year: number): Promise<CalendarBar[]> {
  return request<CalendarBar[]>(`${BASE}/campaigns/calendar`, { query: { year } })
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
}

export function countProspects(sectorIds: number[], shopIds: number[] = []): Promise<ProspectCount> {
  return request<ProspectCount>(`${BASE}/b2b/prospects/count`, {
    query: { sector_ids: sectorIds.join(','), shop_ids: shopIds.join(',') },
  })
}

export function listProspects(sectorIds: number[], shopIds: number[] = []): Promise<Prospect[]> {
  return request<Prospect[]>(`${BASE}/b2b/prospects`, {
    query: { sector_ids: sectorIds.join(','), shop_ids: shopIds.join(',') },
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
  /** Base et taux, quand le montant a été calculé — une redevance. */
  base_amount: number | null
  rate_pct: number | null
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

/**
 * Les trois redevances. `MARKETING` alimente le fonds et se lit par le réseau ;
 * les deux autres sont les revenus de la marque et ne sortent pas de chez elle.
 */
export type RoyaltyKind = 'MARKETING' | 'ASSISTANCE' | 'MARQUE'

export const ROYALTY_KINDS: Array<{ kind: RoyaltyKind; label: string; public: boolean }> = [
  { kind: 'MARKETING', label: 'Marketing', public: true },
  { kind: 'ASSISTANCE', label: 'Assistance', public: false },
  { kind: 'MARQUE', label: 'Marque', public: false },
]

export interface RoyaltyRate {
  rate_pct: number
  /** Date d'effet du taux : c'est elle qui protège les mois déjà facturés. */
  valid_from: string
  /** Vrai quand le taux vient de la grille de marque, faute d'un taux propre. */
  from_default: boolean
}

export interface RoyaltyShop {
  shop_id: number
  shop_name: string
  city: string | null
  /** `null` = pas encore déclaré, ce qui n'est pas « zéro euro ». */
  revenue_amount: number | null
  rates: Partial<Record<RoyaltyKind, RoyaltyRate>>
  /** Ce qui est déjà au grand livre pour ce mois, nature par nature. */
  movements: Partial<Record<RoyaltyKind, { id: number; amount: number; base_amount: number | null; rate_pct: number | null }>>
  /** La facture de l'ERP pour ce magasin et ce mois, quand il y en a une. */
  erp: {
    document_ref: string
    revenue: number | null
    total: number | null
    lines: Partial<
      Record<
        RoyaltyKind,
        {
          amount: number
          rate: number | null
          base: number | null
          /** L'assiette a été retrouvée depuis le montant et le taux, faute d'être stockée. */
          base_derived: boolean
          label: string | null
        }
      >
    >
    unknown_lines: number
  } | null
}

export function getRoyalties(month: string): Promise<{
  month: string
  shops: RoyaltyShop[]
  erp: {
    available: boolean
    reason: string | null
    invoices: number
    inventory: Record<string, { 'non reconnues': string[]; disponibles: string[] }>
    /** Libellés de ligne que la lecture n'a pas su classer, tels quels. */
    unknown_labels: string[]
  } | null
}> {
  return request(`${BASE}/funds/royalties`, { query: { month } })
}

export function saveRoyalties(payload: {
  month: string
  rates: Array<{ shop_id: number; kind: RoyaltyKind; rate_pct: number }>
  revenues: Array<{ shop_id: number; revenue_amount: number | null }>
}): Promise<{
  rates_changed: number
  rates_unchanged: number
  revenues_saved: number
  revenues_cleared: number
}> {
  return request(`${BASE}/funds/royalties`, { method: 'PUT', body: payload })
}

/**
 * Ce que l'ERP a facturé, tel que le module le lit.
 *
 * `available: false` n'est pas une panne : c'est une réponse — la table manque,
 * ou une colonne n'a pas été reconnue. `reason` le dit en clair, et `inventory`
 * donne les colonnes réellement présentes pour qu'on puisse trancher.
 */
export interface ErpRoyaltyLine {
  label: string | null
  kind: RoyaltyKind | null
  rate: number | null
  base: number | null
  amount: number
}

export interface ErpRoyaltyInvoice {
  erp_id: string
  shop_id: number | null
  shop_name: string
  erp_shop_id: string
  document_ref: string
  invoice_date: string
  period_from: string
  period_to: string
  revenue: number | null
  total: number | null
  status: string | null
  lines: ErpRoyaltyLine[]
}

export interface ErpRoyaltyPreview {
  available: boolean
  reason: string | null
  mapping: { invoice?: Record<string, string>; line?: Record<string, string> }
  inventory: Record<string, { 'non reconnues': string[]; disponibles: string[] }>
  invoices: ErpRoyaltyInvoice[]
}

export function getErpRoyalties(month: string): Promise<ErpRoyaltyPreview> {
  return request(`${BASE}/funds/royalties/erp`, { query: { month } })
}

export function importErpRoyalties(month: string): Promise<{
  created: number
  skipped: number
  unmatched_shop: number
  unknown_kind: number
  total_amount: number
}> {
  return request(`${BASE}/funds/royalties/erp/import`, { method: 'POST', body: { month } })
}

export function generateRoyalties(
  month: string,
  kinds: RoyaltyKind[] = [],
): Promise<{
  created: number
  skipped: number
  without_rate: number
  without_revenue: number
  /** Combien viennent d'une facture ERP plutôt que d'un calcul local. */
  from_erp: number
  total_amount: number
}> {
  return request(`${BASE}/funds/royalties/generate`, { method: 'POST', body: { month, kinds } })
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

export function getLeverSummary(): Promise<LeverPerformance[]> {
  return request<LeverPerformance[]>(`${BASE}/funds/levers`)
}

export interface RoiQuarter {
  period_label: string
  total_cost_amount: number
  generated_revenue: number
  cost_per_1000_revenue: number | null
  trend: 'up' | 'down' | 'flat' | null
  /** Un coût en baisse est une amélioration — d'où le champ explicite. */
  is_improvement: boolean | null
}

export function getRoiQuarterly(): Promise<RoiQuarter[]> {
  return request<RoiQuarter[]>(`${BASE}/roi/quarterly`)
}

// ---------------------------------------------------------------------------
// Diffusion : supports physiques et déclinaisons digitales
// ---------------------------------------------------------------------------

export interface CampaignChannel {
  id: number
  channel_code: string
  channel_label: string
  family: 'PHYSIQUE' | 'DIGITAL'
  budget_amount: number | null
  is_enabled: boolean
  campaign_id: number
  campaign_name: string
  status_label: string
  status_text_hex: string
  status_bg_rgba: string
  agency_name: string | null
}

export interface AssetRender {
  id: number
  format_code: string
  format_name: string
  width_px: number
  height_px: number
  note: string | null
  /** Le recadrage manuel prime sur le rendu automatique quand il existe. */
  file_url: string | null
  override_file_url: string | null
  master_file_url: string | null
  focal_point_y: number | null
  status: string
  campaign_id: number
  campaign_name: string
}

export interface CampaignUniform extends Uniform {
  campaign_id: number | null
  campaign_name: string | null
}

export interface Diffusion {
  channels: CampaignChannel[]
  renders: AssetRender[]
  uniforms: CampaignUniform[]
}

/** Un seul point d'entrée pour les deux écrans : seule la famille change. */
export function getDiffusion(family: 'PHYSIQUE' | 'DIGITAL'): Promise<Diffusion> {
  return request<Diffusion>(`${BASE}/diffusion`, { query: { family } })
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

export function getRoi(): Promise<{ quarterly: RoiQuarter[]; costs: CostKind[] }> {
  return request(`${BASE}/roi`)
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

export interface ShopPresence {
  id: number
  shop_name: string
  platform: string
  rating_avg: number | null
  reviews_count: number
  completeness_pct: number | null
  last_synced_at: string | null
  pending_replies: number
}

export interface Review {
  id: number
  author_name: string | null
  rating: number | null
  body: string | null
  published_at: string | null
  reply_status: string
  shop_name: string
  platform: string
}

export function getPresence(): Promise<{ shops: ShopPresence[]; reviews: Review[] }> {
  return request(`${BASE}/presence`)
}

export interface Kit {
  id: number
  name: string
  description: string | null
  type_label: string | null
  default_budget_amount: number | null
  is_published: boolean
  activations: number
  assets_count: number
}

export function listKits(): Promise<Kit[]> {
  return request<Kit[]>(`${BASE}/kits`)
}

// Réexport pour les écrans d'alias, qui restent servis par l'ERP.
export type { AliasType, LangCode }
