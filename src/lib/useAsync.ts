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

/**
 * Nombre lisible.
 *
 * PDO renvoie les colonnes DECIMAL en chaîne et l'API les convertit en nombres :
 * un compte de tickets arrive donc à `412` mais un panier à `4.55`. Afficher la
 * valeur brute donnait « 412.00 » et « 1284.00 ». On garde les décimales
 * seulement quand elles portent de l'information.
 */
export function formatNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'

  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  })
}

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/**
 * Clé de période du grand livre en libellé lisible.
 * Le serveur renvoie `2026-07-01` (mois), `2026-T3` (trimestre) ou `2026`.
 */
export function formatPeriod(key: string): string {
  if (/^\d{4}$/.test(key)) return key

  const quarter = key.match(/^(\d{4})-T(\d)$/)
  if (quarter) return `${quarter[2]}ᵉ trimestre ${quarter[1]}`

  const month = key.match(/^(\d{4})-(\d{2})/)
  if (month) return `${MONTH_NAMES[Number(month[2]) - 1]} ${month[1]}`

  return key
}
