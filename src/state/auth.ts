import { useCallback, useState, useSyncExternalStore } from 'react'
import { getTokens, subscribeTokens } from '../lib/api/tokens'
import { login, logout } from '../lib/api/auth'
import { TfBuddyError } from '../lib/api/http'
import type { Credentials } from '../lib/api/auth'
import type { AuthTokens } from '../lib/api/types'

/** Session courante, resynchronisée à chaque changement de jetons. */
export function useSession(): AuthTokens | null {
  return useSyncExternalStore(subscribeTokens, getTokens, () => null)
}

export interface LoginController {
  submit: (credentials: Credentials) => Promise<boolean>
  signOut: () => Promise<void>
  pending: boolean
  error: string | null
}

/** Message lisible pour l'utilisateur à partir d'une erreur d'appel. */
export function describeError(error: unknown): string {
  if (error instanceof TfBuddyError) {
    if (error.status === 401) return 'Identifiants refusés par l’ERP.'
    if (error.status === 403) return 'Ce compte n’a pas les droits requis.'
    return error.description
  }
  if (error instanceof Error) return error.message
  return 'Erreur inconnue.'
}

/** Pilote le formulaire de connexion. */
export function useLogin(): LoginController {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async (credentials: Credentials) => {
    setPending(true)
    setError(null)
    try {
      await login(credentials)
      return true
    } catch (cause) {
      setError(describeError(cause))
      return false
    } finally {
      setPending(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await logout()
  }, [])

  return { submit, signOut, pending, error }
}
