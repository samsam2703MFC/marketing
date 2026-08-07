/** Point d'entrée unique du client ERP TFBuddy. */

export * from './config'
export * from './types'
export { TfBuddyError, request, requestWithEtag, toList } from './http'
export type { RequestOptions, QueryValue } from './http'
export { getTokens, subscribeTokens, clearTokens } from './tokens'
export * from './auth'

/**
 * `module` = les tables `mar_`, propriétaires des campagnes, de l'offre, des
 * fonds et des leads. `network` = ce que l'ERP possède réellement : boutiques
 * d'origine, catalogue, statistiques de vente.
 */
export * as module from './module'
export * as network from './network'
