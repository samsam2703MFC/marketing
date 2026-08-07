import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_SKEW_SECONDS } from './config'
import type { AuthTokens } from './types'

/**
 * Stockage des jetons.
 *
 * Les refresh tokens sont tournants (l'API en émet un nouveau à chaque
 * rafraîchissement) : la source de vérité est la variable en mémoire, et
 * sessionStorage ne sert qu'à survivre à un rechargement d'onglet. On évite
 * localStorage, qui persisterait le jeton bien au-delà de la session.
 */

const STORAGE_KEY = 'tfbuddy.auth'

let tokens: AuthTokens | null = readFromStorage()

type Listener = (tokens: AuthTokens | null) => void
const listeners = new Set<Listener>()

function readFromStorage(): AuthTokens | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthTokens>
    if (!parsed.accessToken || !parsed.refreshToken) return null
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt ?? 0,
      sessionId: parsed.sessionId,
    }
  } catch {
    // sessionStorage indisponible (mode privé strict) ou JSON corrompu.
    return null
  }
}

function writeToStorage(next: AuthTokens | null): void {
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // On reste utilisable en mémoire seule.
  }
}

/** Jetons courants, ou `null` si personne n'est connecté. */
export function getTokens(): AuthTokens | null {
  return tokens
}

/** Remplace les jetons courants et notifie les abonnés. */
export function setTokens(next: AuthTokens | null): void {
  tokens = next
  writeToStorage(next)
  for (const listener of listeners) listener(next)
}

/** Purge la session locale. */
export function clearTokens(): void {
  setTokens(null)
}

/** S'abonne aux changements de session. Renvoie la fonction de désabonnement. */
export function subscribeTokens(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Calcule l'instant d'expiration à partir d'un `expires_in` en secondes.
 * Le réalm legacy ne renvoie pas cette valeur : on retombe sur les 1800 s
 * documentées dans le swagger.
 */
export function expiryFromNow(expiresInSeconds = ACCESS_TOKEN_TTL_SECONDS): number {
  return Date.now() + expiresInSeconds * 1000
}

/** Vrai si l'access token est expiré, ou sur le point de l'être. */
export function isAccessTokenStale(current: AuthTokens | null = tokens): boolean {
  if (!current) return true
  return Date.now() >= current.expiresAt - REFRESH_SKEW_SECONDS * 1000
}
