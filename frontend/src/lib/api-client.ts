import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { ApiError, type Envelope, type EnvelopeError } from '@/lib/api-types'
import { queryClient } from '@/lib/query-client'
import {
  broadcastLogout,
  clearRefreshToken,
  isRemembered,
  readRefreshToken,
  writeRefreshToken,
} from '@/lib/storage'

const AUTH_SKIP_REFRESH = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/forgot',
  '/api/auth/reset',
])

let refreshInFlight: Promise<boolean> | null = null

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

async function rotateRefresh(): Promise<boolean> {
  const refreshToken = readRefreshToken()
  if (!refreshToken) {
    return false
  }
  let response: Response
  try {
    response = await fetch(`${apiBase()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
  } catch (error) {
    // Mreža je pala: sesija (refresh token) ostaje, sljedeći pokušaj ide ponovo.
    throw networkError(error)
  }
  const body = await readBody<{ accessToken: string; refreshToken: string }>(response)
  if (!body || !response.ok || !body.success) {
    const code = body && !body.success ? body.error.code : 'AUTH_INVALID_CREDENTIALS'
    if (code === 'AUTH_REFRESH_REUSE') {
      broadcastLogout()
    }
    clearRefreshToken()
    useAuthStore.getState().clear()
    return false
  }
  useAuthStore.getState().setAccessToken(body.data.accessToken)
  writeRefreshToken(body.data.refreshToken, isRemembered())
  return true
}

export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = rotateRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
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
  if (response.status === 401 && !options.skipRefresh && !AUTH_SKIP_REFRESH.has(path)) {
    const ok = await refreshSession()
    if (ok) {
      return api<T>(path, { ...options, skipRefresh: true })
    }
    forceLogin()
    throw new ApiError('AUTH_INVALID_CREDENTIALS', 'Session expired', 401)
  }
  if (response.status === 204) {
    return { data: null as T }
  }
  const body = await readBody<T>(response)
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
  if (response.status === 401 && !skipRefresh && !AUTH_SKIP_REFRESH.has(path)) {
    const ok = await refreshSession()
    if (ok) {
      return apiBlob(path, query, true)
    }
    forceLogin()
    throw new ApiError('AUTH_INVALID_CREDENTIALS', 'Session expired', 401)
  }
  if (!response.ok) {
    throw new ApiError(response.status === 429 ? 'RATE_LIMITED' : 'REPORT_UNKNOWN', 'Export failed', response.status)
  }
  return response.blob()
}
