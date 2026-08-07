import { useEffect, useState } from 'react'
import { describeError } from '../state/auth'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/**
 * Charge une ressource et suit son état.
 *
 * L'abandon est important : changer d'écran pendant un chargement ne doit pas
 * faire remonter le résultat de l'écran quitté, ni une erreur d'annulation.
 *
 * `deps` pilote le rechargement, comme pour `useEffect`.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let cancelled = false
    setState((previous) => ({ ...previous, loading: true, error: null }))

    load()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ data: null, error: describeError(cause), loading: false })
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

/** Formatage monétaire commun à tous les écrans. */
export function formatEur(amount: number, decimals = 0): string {
  return amount.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** `2026-07-01` → `01/07/2026`. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const [year, month, day] = iso.split('-')

  return `${day}/${month}/${year}`
}
