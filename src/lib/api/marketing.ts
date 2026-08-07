import { DEFAULT_LANG_CODE } from './config'
import { request, toList } from './http'
import type {
  AliasRow,
  AliasType,
  AliasWrite,
  CreatedEnvelope,
  LangCode,
  MarketingCampaign,
  MarketingCampaignWrite,
  MarketingMaterial,
  MarketingMaterialType,
  MarketingMaterialWrite,
  MutationEnvelope,
} from './types'

/**
 * Surface marketing de l'ERP.
 *
 * Les routes portent des paramètres génériques dans le swagger (`{param1}`) ;
 * ils sont nommés ici d'après leur usage réel.
 */

export interface AliasQuery {
  lang_code?: LangCode
  alias_type?: AliasType
}

// ---------------------------------------------------------------------------
// Campagnes
// ---------------------------------------------------------------------------

export async function listCampaigns(query?: Record<string, string | number>): Promise<MarketingCampaign[]> {
  return toList<MarketingCampaign>(await request('/api/v1/marketing-campaigns', { query }))
}

export function getCampaign(id: number | string): Promise<MarketingCampaign> {
  return request<MarketingCampaign>(`/api/v1/marketing-campaigns/${id}`)
}

export function createCampaign(body: MarketingCampaignWrite): Promise<CreatedEnvelope> {
  return request<CreatedEnvelope>('/api/v1/marketing-campaigns', { method: 'POST', body })
}

export function updateCampaign(
  id: number | string,
  body: Partial<MarketingCampaignWrite>,
): Promise<MutationEnvelope> {
  return request<MutationEnvelope>(`/api/v1/marketing-campaigns/${id}`, { method: 'PATCH', body })
}

export function deleteCampaign(id: number | string): Promise<MutationEnvelope> {
  return request<MutationEnvelope>(`/api/v1/marketing-campaigns/${id}`, { method: 'DELETE' })
}

/** Alias de libellé des campagnes. Une langue non supportée retombe sur `fr`. */
export async function listCampaignAliases(query: AliasQuery = {}): Promise<AliasRow[]> {
  return toList<AliasRow>(
    await request('/api/v1/marketing-campaigns/aliases', {
      query: { lang_code: query.lang_code ?? DEFAULT_LANG_CODE, alias_type: query.alias_type },
    }),
  )
}

export function updateCampaignAlias(
  id: number | string,
  body: AliasWrite,
): Promise<MutationEnvelope> {
  return request<MutationEnvelope>(`/api/v1/marketing-campaigns/${id}/aliases`, {
    method: 'PATCH',
    body,
  })
}

// ---------------------------------------------------------------------------
// Supports
// ---------------------------------------------------------------------------

export async function listMaterials(query?: Record<string, string | number>): Promise<MarketingMaterial[]> {
  return toList<MarketingMaterial>(await request('/api/v1/marketing-materials', { query }))
}

export function getMaterial(id: number | string): Promise<MarketingMaterial> {
  return request<MarketingMaterial>(`/api/v1/marketing-materials/${id}`)
}

export function createMaterial(body: MarketingMaterialWrite): Promise<CreatedEnvelope> {
  return request<CreatedEnvelope>('/api/v1/marketing-materials', { method: 'POST', body })
}

export function updateMaterial(
  id: number | string,
  body: Partial<MarketingMaterialWrite>,
): Promise<MutationEnvelope> {
  return request<MutationEnvelope>(`/api/v1/marketing-materials/${id}`, { method: 'PATCH', body })
}

export function deleteMaterial(id: number | string): Promise<MutationEnvelope> {
  return request<MutationEnvelope>(`/api/v1/marketing-materials/${id}`, { method: 'DELETE' })
}

export async function listMaterialTypes(): Promise<MarketingMaterialType[]> {
  return toList<MarketingMaterialType>(await request('/api/v1/marketing-material-types'))
}

/** Supports diffusés à une boutique donnée. */
export async function listShopMaterials(shopId: number | string): Promise<MarketingMaterial[]> {
  return toList<MarketingMaterial>(await request(`/api/v1/shops/${shopId}/marketing-materials`))
}

// ---------------------------------------------------------------------------
// Alias des supports (titre et résumé sont deux jeux distincts)
// ---------------------------------------------------------------------------

export async function listMaterialTitleAliases(query: AliasQuery = {}): Promise<AliasRow[]> {
  return toList<AliasRow>(
    await request('/api/v1/marketing-materials/title-aliases', {
      query: { lang_code: query.lang_code ?? DEFAULT_LANG_CODE, alias_type: query.alias_type },
    }),
  )
}

export function updateMaterialTitleAlias(
  id: number | string,
  body: AliasWrite,
): Promise<MutationEnvelope> {
  return request<MutationEnvelope>(`/api/v1/marketing-materials/${id}/title-aliases`, {
    method: 'PATCH',
    body,
  })
}

export async function listMaterialSummaryAliases(query: AliasQuery = {}): Promise<AliasRow[]> {
  return toList<AliasRow>(
    await request('/api/v1/marketing-materials/summary-aliases', {
      query: { lang_code: query.lang_code ?? DEFAULT_LANG_CODE, alias_type: query.alias_type },
    }),
  )
}

export function updateMaterialSummaryAlias(
  id: number | string,
  body: AliasWrite,
): Promise<MutationEnvelope> {
  return request<MutationEnvelope>(`/api/v1/marketing-materials/${id}/summary-aliases`, {
    method: 'PATCH',
    body,
  })
}
