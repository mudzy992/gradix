import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { ApiError, type Envelope, type EnvelopeError } from '@/lib/api-types'
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

export function apiBase(): string {
  return import.meta.env.VITE_API_URL ?? ''
}

export function forceLogin(): void {
  useAuthStore.getState().clear()
  clearRefreshToken()
  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

async function rotateRefresh(): Promise<boolean> {
  const refreshToken = readRefreshToken()
  if (!refreshToken) {
    return false
  }
  const response = await fetch(`${apiBase()}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  const body = (await response.json()) as Envelope<{
    accessToken: string
    refreshToken: string
  }> | EnvelopeError
  if (!response.ok || !body.success) {
    const code = !body.success ? body.error.code : 'AUTH_INVALID_CREDENTIALS'
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
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: headers(Boolean(options.formData)),
    body: options.formData
      ? options.formData
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  })
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
  const body = (await response.json()) as Envelope<T> | EnvelopeError
  if (!response.ok || !body.success) {
    const error = !body.success
      ? body.error
      : { code: 'INTERNAL_ERROR', message: 'Request failed' }
    throw new ApiError(error.code, error.message, response.status, 'details' in error ? error.details : undefined)
  }
  return { data: body.data, meta: body.meta }
}

export async function apiBlob(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<Blob> {
  const url = buildUrl(path, query)
  const response = await fetch(url, { headers: headers(false) })
  if (!response.ok) {
    throw new ApiError('REPORT_UNKNOWN', 'Export failed', response.status)
  }
  return response.blob()
}
