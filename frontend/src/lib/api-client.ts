import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { ApiError, type Envelope, type EnvelopeError } from '@/lib/api-types'
import { queryClient } from '@/lib/query-client'
import {
  bindRefreshToken,
  broadcastLogout,
  clearRefreshToken,
  getSessionGeneration,
  isRemembered,
  readRefreshToken,
  writeRotatedRefreshToken,
} from '@/lib/storage'

const AUTH_SKIP_REFRESH = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/forgot',
  '/api/auth/reset',
])

type RefreshFlight = { generation: number; token: string; promise: Promise<boolean> }
let refreshInFlight: RefreshFlight | null = null

type RequestContext = { generation: number; userId: string | null; companyId: string | null }

function requestContext(): RequestContext {
  const user = useAuthStore.getState().user
  return {
    generation: getSessionGeneration(),
    userId: user?.id ?? null,
    companyId: user?.roles?.includes('PLATFORM_ADMIN') ? useCompanyStore.getState().selectedId : user?.companyId ?? null,
  }
}

function ensureContext(original: RequestContext): void {
  const current = requestContext()
  if (original.generation !== current.generation || original.userId !== current.userId || original.companyId !== current.companyId) {
    throw new ApiError('SESSION_CHANGED', 'Session or company changed; retry the operation', 409)
  }
}

function ensureNoNewSessionAfterFailedRefresh(original: RequestContext): void {
  const generation = getSessionGeneration()
  if (generation === original.generation) {
    ensureContext(original)
    return
  }
  // The failed refresh itself clears the old session exactly once. Do not log
  // out a newer login that appeared while awaiting the old request.
  if (generation !== original.generation + 1 || readRefreshToken() !== null || useAuthStore.getState().user !== null) {
    throw new ApiError('SESSION_CHANGED', 'Session changed during refresh', 409)
  }
}

function ensureRefreshCurrent(generation: number, token: string): void {
  if (getSessionGeneration() !== generation || readRefreshToken() !== token) {
    throw new ApiError('SESSION_CHANGED', 'Session changed during refresh', 409)
  }
}

/**
 * FE-15: kad mreža padne, `fetch` odbija Promise sa `TypeError: Failed to fetch`. To nije `ApiError`,
 * pa je stizalo do UI-a kao engleski tehnički tekst (ili, u bootstrapu, kao neuhvaćen `rejection`).
 * Sada uvijek `ApiError` sa kodom `NETWORK_ERROR` i statusom `0`.
 */
function networkError(error: unknown): ApiError {
  return new ApiError('NETWORK_ERROR', error instanceof Error ? error.message : 'Network error', 0)
}

/** FE-15: odgovor ne mora biti JSON (proxy 502/504 vrati HTML) — `response.json()` bi bacio `SyntaxError`. */
async function readBody<T>(response: Response): Promise<Envelope<T> | EnvelopeError | null> {
  try {
    return (await response.json()) as Envelope<T> | EnvelopeError
  } catch {
    return null
  }
}

export function apiBase(): string {
  return import.meta.env.VITE_API_URL ?? ''
}

/**
 * FE-15 — jedno mjesto za **lokalno** zatvaranje sesije: store, refresh token i keš upita.
 *
 * Keš je prije ostajao pun podataka prethodnog korisnika (liste, `me`, firme), pa ih je na dijeljenom
 * računaru sljedeći korisnik vidio do prvog osvježavanja. Odjava je bila rasuta na četiri mjesta
 * (`forceLogin`, korisnički meni ×2, promjena lozinke, sinhronizacija tabova) — sada svi zovu ovo.
 */
export function clearSession(): void {
  useAuthStore.getState().clear()
  queryClient.clear()
  clearRefreshToken()
}

export function forceLogin(): void {
  clearSession()
  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

async function rotateRefresh(refreshToken: string, generation: number): Promise<boolean> {
  let response: Response
  try {
    response = await fetch(`${apiBase()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
  } catch (error) {
    ensureRefreshCurrent(generation, refreshToken)
    // Mreža je pala: sesija (refresh token) ostaje, sljedeći pokušaj ide ponovo.
    throw networkError(error)
  }
  const body = await readBody<{ accessToken: string; refreshToken: string }>(response)
  // Never let a response for an older login replace or clear a newer session.
  ensureRefreshCurrent(generation, refreshToken)
  if (!body || !response.ok || !body.success) {
    const code = body && !body.success ? body.error.code : 'AUTH_INVALID_CREDENTIALS'
    if (code === 'AUTH_REFRESH_REUSE') {
      const userId = useAuthStore.getState().user?.id
      if (userId) broadcastLogout(userId)
    }
    clearRefreshToken()
    useAuthStore.getState().clear()
    return false
  }
  useAuthStore.getState().setAccessToken(body.data.accessToken)
  writeRotatedRefreshToken(body.data.refreshToken, isRemembered())
  return true
}

export function refreshSession(): Promise<boolean> {
  const token = readRefreshToken()
  if (!bindRefreshToken(token)) {
    return Promise.reject(new ApiError('SESSION_CHANGED', 'Session changed in another tab', 409))
  }
  if (!token) return Promise.resolve(false)
  const generation = getSessionGeneration()
  if (refreshInFlight?.generation === generation && refreshInFlight.token === token) return refreshInFlight.promise
  const flight: RefreshFlight = { generation, token, promise: Promise.resolve(false) }
  // A lock serializes remembered-token refreshes across cooperative tabs. A
  // changed token is not automatically adopted: it might be another login.
  const rotate = async () => {
    ensureRefreshCurrent(generation, token)
    return rotateRefresh(token, generation)
  }
  const lockManager = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const attempt = isRemembered() && lockManager
    ? lockManager.request('gradix:remembered-refresh', rotate)
    : rotate()
  flight.promise = attempt.finally(() => {
    if (refreshInFlight === flight) refreshInFlight = null
  })
  refreshInFlight = flight
  return flight.promise
}

type RequestOptions = {
  method?: string
  body?: unknown
  formData?: FormData
  query?: Record<string, string | number | boolean | undefined>
  skipRefresh?: boolean
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = apiBase()
  const url = base
    ? new URL(path, base.endsWith('/') ? base : `${base}/`)
    : new URL(path, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return base ? url.toString() : `${url.pathname}${url.search}`
}

function headers(isForm: boolean): HeadersInit {
  const result: Record<string, string> = {}
  if (!isForm) {
    result['Content-Type'] = 'application/json'
  }
  const token = useAuthStore.getState().accessToken
  if (token) {
    result.Authorization = `Bearer ${token}`
  }
  const user = useAuthStore.getState().user
  const companyId = useCompanyStore.getState().selectedId
  if (user?.roles.includes('PLATFORM_ADMIN') && companyId) {
    result['X-Company-Id'] = companyId
  }
  return result
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<{
  data: T
  meta?: { page: number; limit: number; total: number }
}> {
  const context = requestContext()
  const url = buildUrl(path, options.query)
  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: headers(Boolean(options.formData)),
      body: options.formData
        ? options.formData
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    })
  } catch (error) {
    throw networkError(error)
  }
  ensureContext(context)
  if (response.status === 401 && !options.skipRefresh && !AUTH_SKIP_REFRESH.has(path)) {
    const ok = await refreshSession()
    if (ok) {
      ensureContext(context)
      return api<T>(path, { ...options, skipRefresh: true })
    }
    ensureNoNewSessionAfterFailedRefresh(context)
    forceLogin()
    throw new ApiError('AUTH_INVALID_CREDENTIALS', 'Session expired', 401)
  }
  if (response.status === 204) {
    return { data: null as T }
  }
  const body = await readBody<T>(response)
  ensureContext(context)
  if (!body) {
    throw new ApiError(response.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR', 'Invalid response', response.status)
  }
  if (!response.ok || !body.success) {
    const error =
      !body.success && body.error ? body.error : { code: 'INTERNAL_ERROR', message: 'Request failed' }
    throw new ApiError(error.code, error.message, response.status, 'details' in error ? error.details : undefined)
  }
  return { data: body.data, meta: body.meta }
}

export async function apiBlob(
  path: string,
  query?: Record<string, string | number | undefined>,
  skipRefresh = false,
): Promise<Blob> {
  const context = requestContext()
  const url = buildUrl(path, query)
  let response: Response
  try {
    response = await fetch(url, { headers: headers(false) })
  } catch (error) {
    throw networkError(error)
  }
  /**
   * FE-15: izvoz (PDF/CSV) nije prolazio kroz osvježavanje tokena — poslije isteka pristupnog tokena
   * (15 min) preuzimanje je padalo sa „Export failed“ iako je sesija bila ispravna. Sada isto pravilo
   * kao `api()`: jedan pokušaj osvježavanja pa ponovni zahtjev.
   */
  ensureContext(context)
  if (response.status === 401 && !skipRefresh && !AUTH_SKIP_REFRESH.has(path)) {
    const ok = await refreshSession()
    if (ok) {
      ensureContext(context)
      return apiBlob(path, query, true)
    }
    ensureNoNewSessionAfterFailedRefresh(context)
    forceLogin()
    throw new ApiError('AUTH_INVALID_CREDENTIALS', 'Session expired', 401)
  }
  if (!response.ok) {
    throw new ApiError(response.status === 429 ? 'RATE_LIMITED' : 'REPORT_UNKNOWN', 'Export failed', response.status)
  }
  const blob = await response.blob()
  ensureContext(context)
  return blob
}
