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
  default_lever_code: string | null
  default_kpi_label: string | null
  icon_path: string | null
}

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

// Réexport pour les écrans d'alias, qui restent servis par l'ERP.
export type { AliasType, LangCode }
