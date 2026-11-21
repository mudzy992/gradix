import { COMPANY_KEY, LOGOUT_KEY, REFRESH_KEY, REMEMBER_KEY } from '@/lib/constants'

/**
 * FE-15: pristup `localStorage`/`sessionStorage` **može baciti** — Safari u privatnom režimu i
 * preglednici kojima je pohrana blokirana daju `SecurityError` već na `getItem`. Prije je to rušilo
 * aplikaciju pri samom uvozu modula (`company-store` čita izbor firme na nivou modula), a korisnik je
 * vidio bijeli ekran bez objašnjenja. Sada svaki pristup ide kroz zaštitu, uz **memorijski fallback**
 * da sesija radi i kad pohrana nije dostupna (do prvog reloada).
 */
const memory = new Map<string, string>()
// Only failed writes/removals override an accessible storage area. Otherwise
// another tab's deletion must not resurrect an old value from our cache.
const pending = new Map<string, string | null>()
let boundRefreshToken: string | null | undefined
let logoutAtSessionStart: string | null = null

/** Bind this tab to the token it adopted; a different shared token is not
 * necessarily the same session (another account may have logged in). */
export function bindRefreshToken(token: string | null): boolean {
  if (boundRefreshToken === undefined) {
    boundRefreshToken = token
    logoutAtSessionStart = read('local', LOGOUT_KEY)
  }
  return boundRefreshToken === token
}
// Advances on login/logout, not on rotation within the same session.
let sessionGeneration = 0

export function getSessionGeneration(): number {
  return sessionGeneration
}

function resolve(area: 'local' | 'session'): Storage | null {
  try {
    return area === 'local' ? localStorage : sessionStorage
  } catch {
    return null
  }
}

function read(area: 'local' | 'session', key: string): string | null {
  const cacheKey = `${area}:${key}`
  if (pending.has(cacheKey)) return pending.get(cacheKey) ?? null
  const storage = resolve(area)
  if (storage) {
    try {
      return storage.getItem(key)
    } catch {
      // blokirana pohrana — koristi memoriju ispod
    }
  }
  return memory.get(cacheKey) ?? null
}

function write(area: 'local' | 'session', key: string, value: string): void {
  const cacheKey = `${area}:${key}`
  memory.set(cacheKey, value)
  const storage = resolve(area)
  try {
    if (!storage) throw new Error('Storage unavailable')
    storage.setItem(key, value)
    pending.delete(cacheKey)
  } catch {
    pending.set(cacheKey, value)
  }
}

function remove(area: 'local' | 'session', key: string): void {
  const cacheKey = `${area}:${key}`
  memory.delete(cacheKey)
  const storage = resolve(area)
  try {
    if (!storage) throw new Error('Storage unavailable')
    storage.removeItem(key)
    pending.delete(cacheKey)
  } catch {
    // A failed removal must not resurrect the old persisted value.
    pending.set(cacheKey, null)
  }
}

export function isRemembered(): boolean {
  return read('local', REMEMBER_KEY) === '1'
}

export function readRefreshToken(): string | null {
  return isRemembered() ? read('local', REFRESH_KEY) : read('session', REFRESH_KEY)
}

export function writeRefreshToken(token: string, remember: boolean): void {
  sessionGeneration += 1
  boundRefreshToken = token
  logoutAtSessionStart = read('local', LOGOUT_KEY)
  storeRefreshToken(token, remember)
}

/** Called only after verifying that the refresh belongs to the current session. */
export function writeRotatedRefreshToken(token: string, remember: boolean): void {
  boundRefreshToken = token
  storeRefreshToken(token, remember)
}

function storeRefreshToken(token: string, remember: boolean): void {
  remove('local', REFRESH_KEY)
  remove('session', REFRESH_KEY)
  if (remember) {
    write('local', REMEMBER_KEY, '1')
    write('local', REFRESH_KEY, token)
    return
  }
  remove('local', REMEMBER_KEY)
  write('session', REFRESH_KEY, token)
}

/** The token adopted by this tab, never a different login's shared token. */
export function readBoundRefreshToken(): string | null {
  return boundRefreshToken ?? null
}

export function clearRefreshToken(): void {
  sessionGeneration += 1
  // Another tab may have logged into a different account. Never knowingly
  // delete its shared credential when clearing this tab's old session.
  if (boundRefreshToken && read('local', REFRESH_KEY) === boundRefreshToken) {
    remove('local', REFRESH_KEY)
    remove('local', REMEMBER_KEY)
  }
  boundRefreshToken = undefined
  logoutAtSessionStart = null
  remove('session', REFRESH_KEY)
}

export function readCompanyId(): string | null {
  return read('session', COMPANY_KEY)
}

export function writeCompanyId(id: string | null): void {
  if (!id) {
    remove('session', COMPANY_KEY)
    return
  }
  write('session', COMPANY_KEY, id)
}

export function broadcastLogout(userId: string): void {
  // Nonce makes repeated events observable without exposing a refresh token.
  write('local', LOGOUT_KEY, JSON.stringify({ version: 1, userId, nonce: `${Date.now()}-${Math.random()}` }))
}

export function isLogoutForCurrentSession(value: string | null, userId: string): boolean {
  if (!value || value === logoutAtSessionStart) return false
  try {
    const payload: unknown = JSON.parse(value)
    return typeof payload === 'object' && payload !== null &&
      'version' in payload && payload.version === 1 &&
      'userId' in payload && payload.userId === userId &&
      'nonce' in payload && typeof payload.nonce === 'string' && payload.nonce.length > 0
  } catch {
    return false
  }
}
