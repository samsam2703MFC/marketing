import { AUTH_MODE } from './config'
import { request, setRefreshHandler } from './http'
import { clearTokens, expiryFromNow, getTokens, setTokens } from './tokens'
import type { AuthTokens, LegacyLoginResponse, PhoneLoginResponse } from './types'

/**
 * Authentification admin.
 *
 * Le swagger expose deux réalms admin en parallèle :
 *   • `phone`  — POST /api/v1/admin/auth/login   { phone, password }  → access_token / refresh_token / session_id / expires_in
 *   • `legacy` — POST /api/v1/admin/authenticate { login, password }  → token / refresh_token
 *
 * Les deux sont implémentés, le choix se fait par `VITE_TFBUDDY_AUTH_MODE`
 * (`phone` par défaut, le réalm le plus récent). Les refresh tokens sont
 * tournants dans les deux cas : chaque rafraîchissement remplace la paire.
 */

/** Identifiants du réalm téléphone. */
export interface PhoneCredentials {
  phone: string
  password: string
}

/** Identifiants du réalm legacy. */
export interface LegacyCredentials {
  login: string
  password: string
}

export type Credentials = PhoneCredentials | LegacyCredentials

function isPhoneCredentials(value: Credentials): value is PhoneCredentials {
  return 'phone' in value
}

/**
 * Normalise un numéro au format E.164 attendu par l'API.
 * Les numéros français saisis en 0X sont préfixés en +33.
 */
export function toE164(input: string, defaultCallingCode = '33'): string {
  const trimmed = input.trim()
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`

  const digits = trimmed.replace(/\D/g, '')
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.startsWith('0')) return `+${defaultCallingCode}${digits.slice(1)}`
  return `+${digits}`
}

function fromPhoneResponse(payload: PhoneLoginResponse): AuthTokens {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: expiryFromNow(payload.expires_in),
    sessionId: payload.session_id,
  }
}

function fromLegacyResponse(payload: LegacyLoginResponse): AuthTokens {
  return {
    accessToken: payload.token,
    refreshToken: payload.refresh_token,
    // Le réalm legacy ne renvoie pas d'`expires_in` : on applique le TTL par défaut.
    expiresAt: expiryFromNow(),
  }
}

/** Connexion. Enregistre les jetons et les renvoie. */
export async function login(credentials: Credentials): Promise<AuthTokens> {
  let tokens: AuthTokens

  if (isPhoneCredentials(credentials)) {
    const payload = await request<PhoneLoginResponse>('/api/v1/admin/auth/login', {
      method: 'POST',
      anonymous: true,
      body: { phone: toE164(credentials.phone), password: credentials.password },
    })
    tokens = fromPhoneResponse(payload)
  } else {
    const payload = await request<LegacyLoginResponse>('/api/v1/admin/authenticate', {
      method: 'POST',
      anonymous: true,
      body: { login: credentials.login, password: credentials.password },
    })
    tokens = fromLegacyResponse(payload)
  }

  setTokens(tokens)
  return tokens
}

/**
 * Rafraîchit la paire de jetons. Un échec purge la session : le refresh token
 * ayant été consommé, il n'y a plus rien à retenter.
 */
export async function refresh(): Promise<AuthTokens> {
  const current = getTokens()
  if (!current) throw new Error('Session absente : rafraîchissement impossible.')

  try {
    if (AUTH_MODE === 'phone') {
      const payload = await request<PhoneLoginResponse>('/api/v1/admin/auth/refresh', {
        method: 'POST',
        anonymous: true,
        body: { refresh_token: current.refreshToken },
      })
      const tokens = fromPhoneResponse(payload)
      setTokens(tokens)
      return tokens
    }

    const payload = await request<LegacyLoginResponse>('/api/v1/admin/refresh', {
      method: 'POST',
      anonymous: true,
      body: { refresh_token: current.refreshToken },
    })
    const tokens = fromLegacyResponse(payload)
    setTokens(tokens)
    return tokens
  } catch (error) {
    clearTokens()
    throw error
  }
}

/**
 * Déconnexion. La session locale est purgée quoi qu'il arrive : si l'appel
 * serveur échoue, rester connecté côté client serait pire.
 */
export async function logout(): Promise<void> {
  const current = getTokens()
  try {
    if (current && AUTH_MODE === 'phone') {
      await request('/api/v1/admin/auth/logout', { method: 'POST' })
    }
  } catch {
    // Ignoré volontairement.
  } finally {
    clearTokens()
  }
}

/** Branche le rafraîchissement automatique sur la couche HTTP. */
export function installAuthRefresh(): void {
  setRefreshHandler(refresh)
}
