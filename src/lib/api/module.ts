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
  /** Formulation d'origine du handoff, conservée pour retrouver l'intention. */
  default_lever_code: string | null
  default_kpi_label: string | null
  icon_path: string | null
  lever_id: number | null
  /** Libellé de la pastille : celui du levier, ou la nuance propre au type. */
  lever_label: string | null
  lever_color_hex: string | null
}

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
  estimated_leads_count: number
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
}

export function getReferences(): Promise<References> {
  return request<References>(`${BASE}/references`)
}

export interface Brand {
  id: number
  code: string
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

export function getCampaign(id: number): Promise<Campaign & Record<string, unknown>> {
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
  /** Cadrage vertical du visuel, en pourcentage de la hauteur. */
  focal_point_y?: number | null
  shop_ids?: number[]
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
    items?: string[]
  }
}

export function createCampaign(
  draft: CampaignDraft,
): Promise<{ inserted_id: number; leads?: LeadGenerationReport }> {
  return request(`${BASE}/campaigns`, { method: 'POST', body: draft })
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

export function getSectorAvailability(): Promise<SectorAvailability[]> {
  return request<SectorAvailability[]>(`${BASE}/b2b/sectors`)
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

export interface LedgerRow {
  id: number
  movement_date: string
  direction: 'IN' | 'OUT'
  label: string
  amount: number
  signed_amount: number
  source: string
  supplier_name: string | null
  shop_name: string | null
  campaign_id: number | null
  campaign_name: string | null
  lever_label: string | null
  lever_color_hex: string | null
  /** Le badge ⛓ : la ligne est rattachée à une campagne. */
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
