import { request, requestWithEtag, toList } from './http'
import type { Shop } from './types'

/**
 * Données réseau — la vue « Réseau » du back-office s'appuie dessus pour
 * cadrer les campagnes (quelles boutiques, quelles ventes).
 *
 * Plusieurs routes consultant supportent `ETag` / `If-None-Match` : elles sont
 * exposées via `requestWithEtag`, qui renvoie `notModified` au lieu de lever
 * sur un 304.
 */

/** Boutiques du réseau (réalm admin). */
export async function listShops(query?: Record<string, string | number>): Promise<Shop[]> {
  return toList<Shop>(await request('/api/v1/shops', { query }))
}

export function getShop(id: number | string): Promise<Shop> {
  return request<Shop>(`/api/v1/shops/${id}`)
}

/** Annuaire public — accessible sans jeton. */
export async function listPublicShops(): Promise<Shop[]> {
  return toList<Shop>(await request('/api/v1/public/shops', { anonymous: true }))
}

/** Boutiques rattachées au propriétaire connecté. */
export async function listOwnerShops(): Promise<Shop[]> {
  return toList<Shop>(await request('/api/v1/owner/shops'))
}

/** Tableau de bord réseau du jour. */
export function getNetworkToday<T = unknown>(): Promise<T> {
  return request<T>('/api/v1/owner/network/dashboard/today')
}

/** Tendance des ventes réseau. */
export function getNetworkSalesTrend<T = unknown>(
  query?: Record<string, string | number>,
): Promise<T> {
  return request<T>('/api/v1/owner/network/sales/trend', { query })
}

/** Boutiques suivies par le consultant connecté. */
export async function listConsultantShops(): Promise<Shop[]> {
  return toList<Shop>(await request('/api/v1/consultant/shops'))
}

/** KPI de ventes consultant, avec revalidation par ETag. */
export function getConsultantSalesKpis<T = unknown>(options: {
  query?: Record<string, string | number>
  etag?: string
}) {
  return requestWithEtag<T>('/api/v1/consultant/shops/sales-kpis', options)
}

/** Ventes mensuelles par boutique, avec revalidation par ETag. */
export function getConsultantMonthlySales<T = unknown>(options: {
  query?: Record<string, string | number>
  etag?: string
}) {
  return requestWithEtag<T>('/api/v1/consultant/shops/monthly-sales', options)
}

/** KPI de ventes d'une boutique. */
export function getShopSalesKpis<T = unknown>(
  shopId: number | string,
  query?: Record<string, string | number>,
): Promise<T> {
  return request<T>(`/api/v1/shops/${shopId}/statistics/sales/kpis`, { query })
}

/** Synthèse mensuelle d'une boutique. */
export function getShopMonthlySummary<T = unknown>(
  shopId: number | string,
  query?: Record<string, string | number>,
): Promise<T> {
  return request<T>(`/api/v1/shops/${shopId}/statistics/monthly-summary`, { query })
}
