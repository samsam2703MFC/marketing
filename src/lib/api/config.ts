/**
 * Configuration de l'accès à l'ERP TFBuddy.
 *
 * Le swagger ne déclare qu'un seul serveur : https://test.tfbuddy.com
 * (« Środowisko testowe » — environnement de test). Aucun hôte de production
 * n'y figure, donc l'URL est rendue configurable et pointe par défaut sur le
 * proxy Vite, qui relaie vers l'environnement de test (voir vite.config.ts).
 * Passer par le proxy évite les problèmes de CORS en développement.
 */

/** Hôte de test, seul serveur listé dans le swagger. */
export const TFBUDDY_TEST_HOST = 'https://test.tfbuddy.com'

/** Préfixe du proxy Vite en développement. */
export const DEV_PROXY_PREFIX = '/erp'

/**
 * Racine des appels API. Vide côté dev (le proxy `/erp` prend le relais),
 * surchargeable par `VITE_TFBUDDY_BASE_URL` pour cibler un autre environnement.
 */
export const API_BASE_URL = (
  import.meta.env.VITE_TFBUDDY_BASE_URL ?? DEV_PROXY_PREFIX
).replace(/\/+$/, '')

/**
 * Deux réalms d'authentification admin coexistent dans le swagger :
 * - `phone`  → POST /api/v1/admin/auth/login   ({ phone, password }, normalisé E.164)
 * - `legacy` → POST /api/v1/admin/authenticate ({ login, password })
 */
export const AUTH_MODE: 'phone' | 'legacy' =
  import.meta.env.VITE_TFBUDDY_AUTH_MODE ?? 'phone'

/** Durée de vie d'un access token (1800 s d'après le swagger). */
export const ACCESS_TOKEN_TTL_SECONDS = 1800

/**
 * Marge de sécurité avant expiration : on rafraîchit le token un peu en avance
 * plutôt que d'attendre un 401.
 */
export const REFRESH_SKEW_SECONDS = 60

/** Langue par défaut des alias. L'API retombe sur `fr` pour toute valeur non supportée. */
export const DEFAULT_LANG_CODE = 'fr' as const
