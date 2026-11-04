import { COMPANY_KEY, LOGOUT_KEY, REFRESH_KEY, REMEMBER_KEY } from '@/lib/constants'

/**
 * FE-15: pristup `localStorage`/`sessionStorage` **može baciti** — Safari u privatnom režimu i
 * preglednici kojima je pohrana blokirana daju `SecurityError` već na `getItem`. Prije je to rušilo
 * aplikaciju pri samom uvozu modula (`company-store` čita izbor firme na nivou modula), a korisnik je
 * vidio bijeli ekran bez objašnjenja. Sada svaki pristup ide kroz zaštitu, uz **memorijski fallback**
 * da sesija radi i kad pohrana nije dostupna (do prvog reloada).
 */
const memory = new Map<string, string>()

function resolve(area: 'local' | 'session'): Storage | null {
  try {
    return area === 'local' ? localStorage : sessionStorage
  } catch {
    return null
  }
}

function read(area: 'local' | 'session', key: string): string | null {
  const storage = resolve(area)
  if (storage) {
    try {
      const value = storage.getItem(key)
      if (value !== null) {
        return value
      }
    } catch {
      // blokirana pohrana — koristi memoriju ispod
    }
  }
  return memory.get(`${area}:${key}`) ?? null
}

function write(area: 'local' | 'session', key: string, value: string): void {
  memory.set(`${area}:${key}`, value)
  const storage = resolve(area)
  try {
    storage?.setItem(key, value)
  } catch {
    // nema trajne pohrane — memorijski fallback drži sesiju do reloada
  }
}

function remove(area: 'local' | 'session', key: string): void {
  memory.delete(`${area}:${key}`)
  const storage = resolve(area)
  try {
    storage?.removeItem(key)
  } catch {
    // nema šta da se briše
  }
}

export function isRemembered(): boolean {
  return read('local', REMEMBER_KEY) === '1'
}

export function readRefreshToken(): string | null {
  return isRemembered() ? read('local', REFRESH_KEY) : read('session', REFRESH_KEY)
}

export function writeRefreshToken(token: string, remember: boolean): void {
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

export function clearRefreshToken(): void {
  remove('local', REFRESH_KEY)
  remove('session', REFRESH_KEY)
  remove('local', REMEMBER_KEY)
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

export function broadcastLogout(): void {
  write('local', LOGOUT_KEY, String(Date.now()))
}
