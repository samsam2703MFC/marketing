import { API_BASE_URL } from './config'
import { clearTokens, getTokens, isAccessTokenStale } from './tokens'
import type { ApiErrorEnvelope, AuthTokens } from './types'

/** Erreur applicative issue de l'enveloppe `{ status: 'error', description, errors }`. */
export class TfBuddyError extends Error {
  readonly status: number
  readonly description: string
  readonly errors?: unknown
  readonly url: string

  constructor(init: {
    status: number
    description: string
    errors?: unknown
    url: string
  }) {
    super(init.description)
    this.name = 'TfBuddyError'
    this.status = init.status
    this.description = init.description
    this.errors = init.errors
    this.url = init.url
  }
}

/** Valeurs acceptées en paramètre de requête. Les `undefined`/`null` sont omis. */
export type QueryValue = string | number | boolean | null | undefined | Array<string | number>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Record<string, QueryValue>
  body?: unknown
  /** N'ajoute pas l'en-tête Authorization (login, refresh, routes publiques). */
  anonymous?: boolean
  /** En-têtes additionnels — utile pour `If-None-Match` sur les routes à ETag. */
  headers?: Record<string, string>
  signal?: AbortSignal
  /**
   * Racine à utiliser à la place de celle de l'ERP. Le module marketing est
   * servi par l'application elle-même (`/api/...`), pas derrière le proxy
   * `/erp` — d'où cette surcharge plutôt qu'un second client dupliqué.
   */
  baseUrl?: string
}

// ---------------------------------------------------------------------------
// Rafraîchissement du jeton
// ---------------------------------------------------------------------------

type RefreshHandler = () => Promise<AuthTokens>

let refreshHandler: RefreshHandler | null = null
let inFlightRefresh: Promise<AuthTokens> | null = null

/**
 * Enregistre la stratégie de rafraîchissement. Déclaré ici plutôt qu'importé
 * depuis `auth.ts` pour éviter un cycle d'imports (auth utilise `request`).
 */
export function setRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler
}

/**
 * Rafraîchit les jetons, en ne laissant passer qu'un appel à la fois : les
 * refresh tokens sont tournants, deux appels concurrents en invalideraient un.
 */
async function refreshTokens(): Promise<AuthTokens> {
  if (!refreshHandler) throw new Error('Aucune stratégie de rafraîchissement enregistrée.')
  if (!inFlightRefresh) {
    inFlightRefresh = refreshHandler().finally(() => {
      inFlightRefresh = null
    })
  }
  return inFlightRefresh
}

// ---------------------------------------------------------------------------
// Construction et exécution des requêtes
// ---------------------------------------------------------------------------

function buildUrl(path: string, query?: Record<string, QueryValue>, baseUrl?: string): string {
  const root = baseUrl ?? API_BASE_URL
  const url = `${root}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry))
    } else {
      params.append(key, String(value))
    }
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

/**
 * Lit le corps sans jamais en dépendre.
 *
 * Le swagger prévient à répétition que plusieurs routes `204` émettent malgré
 * tout un corps JSON, et que les clients ne doivent pas s'y fier. On lit donc
 * en texte, puis on tente le parse : un corps absent, vide ou non-JSON ne fait
 * pas échouer l'appel.
 */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'error'
  )
}

function describeFailure(payload: unknown, response: Response): string {
  if (isErrorEnvelope(payload) && payload.description) return payload.description
  if (typeof payload === 'string' && payload.trim()) return payload
  return `${response.status} ${response.statusText}`.trim()
}

async function execute(
  path: string,
  options: RequestOptions,
  accessToken: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  }

  let payload: BodyInit | undefined
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      // Le navigateur pose lui-même le Content-Type et son boundary.
      payload = options.body
    } else {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(options.body)
    }
  }

  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  return fetch(buildUrl(path, options.query, options.baseUrl), {
    method: options.method ?? 'GET',
    headers,
    body: payload,
    signal: options.signal,
  })
}

/**
 * Appel API typé.
 *
 * - injecte le `Bearer` courant, en rafraîchissant en amont si le jeton est périmé ;
 * - retente une fois après un 401, au cas où le serveur invalide avant nous ;
 * - déplie l'enveloppe d'erreur en `TfBuddyError` ;
 * - tolère les corps vides et les `204` bavards.
 */
export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let accessToken: string | null = null

  if (!options.anonymous) {
    let current = getTokens()
    if (current && isAccessTokenStale(current) && refreshHandler) {
      try {
        current = await refreshTokens()
      } catch {
        // Le refresh a échoué : on tente quand même avec le jeton en main,
        // le serveur tranchera par un 401 propre.
        current = getTokens()
      }
    }
    accessToken = current?.accessToken ?? null
  }

  let response = await execute(path, options, accessToken)

  if (response.status === 401 && !options.anonymous && refreshHandler && getTokens()) {
    try {
      const refreshed = await refreshTokens()
      response = await execute(path, options, refreshed.accessToken)
    } catch {
      clearTokens()
    }
  }

  const payload = await parseBody(response)

  if (!response.ok) {
    throw new TfBuddyError({
      status: response.status,
      description: describeFailure(payload, response),
      errors: isErrorEnvelope(payload) ? payload.errors : undefined,
      url: response.url,
    })
  }

  return payload as T
}

/**
 * Variante pour les routes à ETag (`/consultant/shops/*`) : renvoie `null` sur
 * un 304 plutôt que de lever, et remonte l'ETag pour la requête suivante.
 */
export async function requestWithEtag<T = unknown>(
  path: string,
  options: RequestOptions & { etag?: string } = {},
): Promise<{ data: T | null; etag: string | null; notModified: boolean }> {
  const { etag, ...rest } = options
  const headers = { ...rest.headers, ...(etag ? { 'If-None-Match': etag } : {}) }

  const tokens = rest.anonymous ? null : getTokens()
  const response = await execute(path, { ...rest, headers }, tokens?.accessToken ?? null)

  if (response.status === 304) {
    return { data: null, etag: response.headers.get('ETag'), notModified: true }
  }

  const payload = await parseBody(response)
  if (!response.ok) {
    throw new TfBuddyError({
      status: response.status,
      description: describeFailure(payload, response),
      errors: isErrorEnvelope(payload) ? payload.errors : undefined,
      url: response.url,
    })
  }

  return { data: payload as T, etag: response.headers.get('ETag'), notModified: false }
}

/**
 * Normalise une réponse de liste.
 *
 * Selon la route, l'API renvoie soit un tableau nu, soit `{ items: [...] }`,
 * soit un objet enveloppé dans `data`. On ramène le tout à un tableau.
 */
export function toList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>
    for (const key of ['items', 'data', 'results'] as const) {
      if (Array.isArray(record[key])) return record[key] as T[]
    }
  }
  return []
}
