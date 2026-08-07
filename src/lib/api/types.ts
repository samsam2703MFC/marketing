/**
 * Types de l'API TFBuddy.
 *
 * ⚠️ Le swagger décrit la plupart des routes marketing via `SharedResponse200`,
 * dont le schéma est littéralement « The data » — sans structure. Les routes
 * `runtime_*` ne déclarent qu'une réponse `default` (« Request, authorization
 * and response contracts are not inferred by coverage generation »).
 *
 * Les interfaces ci-dessous sont donc écrites à la main : les champs typés sont
 * ceux dont on a besoin, et l'index signature laisse passer le reste du payload
 * sans le perdre ni le contraindre à tort.
 */

/** Enveloppe d'erreur commune à toute l'API. */
export interface ApiErrorEnvelope {
  status: 'error'
  description: string
  errors?: unknown
}

/** Enveloppe de succès d'une création. */
export interface CreatedEnvelope {
  status: 'success'
  message: string
  inserted_id: number | string
}

/** Enveloppe de succès d'une mutation sans corps utile. */
export interface MutationEnvelope {
  status: 'success'
  message: string
}

/** Pagination partagée par les listes (promotions, bons, etc.). */
export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

/** Liste paginée générique. */
export interface Paginated<T> {
  items: T[]
  pagination: Pagination
}

// ---------------------------------------------------------------------------
// Alias / localisation
// ---------------------------------------------------------------------------

/** Langues acceptées par les endpoints d'alias. Toute autre valeur retombe sur `fr`. */
export type LangCode = 'pl' | 'en' | 'fr' | 'it' | 'nl'

/** Contexte d'utilisation de l'alias. */
export type AliasType = 'default' | 'label' | 'pos_application'

/** Ligne d'alias telle que renvoyée par les endpoints `*-aliases`. */
export interface AliasRow {
  fk_id: number
  base_value: string
  alias_value?: string | null
  effective_value: string
  lang_code: LangCode
  alias_type: AliasType
}

/** Corps d'un PATCH d'alias. */
export interface AliasWrite {
  lang_code: LangCode
  alias_type: AliasType
  alias_value: string | null
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

/** Campagne marketing (`/api/v1/marketing-campaigns`). */
export interface MarketingCampaign {
  id: number
  name: string
  description?: string | null
  date_from?: string | null
  date_to?: string | null
  status?: string | null
  [key: string]: unknown
}

/** Corps de création / mise à jour d'une campagne. */
export interface MarketingCampaignWrite {
  name: string
  description?: string | null
  date_from?: string | null
  date_to?: string | null
  [key: string]: unknown
}

/** Type de support marketing (`/api/v1/marketing-material-types`). */
export interface MarketingMaterialType {
  id: number
  name: string
  [key: string]: unknown
}

/** Support marketing (`/api/v1/marketing-materials`). */
export interface MarketingMaterial {
  id: number
  title: string
  summary?: string | null
  id_marketing_material_type?: number | null
  id_marketing_campaign?: number | null
  [key: string]: unknown
}

/** Corps de création / mise à jour d'un support. */
export interface MarketingMaterialWrite {
  title: string
  summary?: string | null
  id_marketing_material_type?: number | null
  id_marketing_campaign?: number | null
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Réseau / boutiques
// ---------------------------------------------------------------------------

/** Boutique du réseau (`/api/v1/shops`). */
export interface Shop {
  id: number
  name: string
  city?: string | null
  address?: string | null
  uid?: string | null
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

/** Réponse de `/api/v1/admin/auth/login` (réalm téléphone). */
export interface PhoneLoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  session_id: string
  expires_in: number
}

/** Réponse de `/api/v1/admin/authenticate` et `/api/v1/admin/refresh` (réalm legacy). */
export interface LegacyLoginResponse {
  token: string
  refresh_token: string
}

/** Jeux de jetons normalisés, quel que soit le réalm utilisé. */
export interface AuthTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms d'expiration estimée de l'access token. */
  expiresAt: number
  sessionId?: string
}
