import { COMPANY_KEY, LOGOUT_KEY, REFRESH_KEY, REMEMBER_KEY } from '@/lib/constants'

export function isRemembered(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === '1'
}

export function readRefreshToken(): string | null {
  if (isRemembered()) {
    return localStorage.getItem(REFRESH_KEY)
  }
  return sessionStorage.getItem(REFRESH_KEY)
}

export function writeRefreshToken(token: string, remember: boolean): void {
  localStorage.removeItem(REFRESH_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
  if (remember) {
    localStorage.setItem(REMEMBER_KEY, '1')
    localStorage.setItem(REFRESH_KEY, token)
    return
  }
  localStorage.removeItem(REMEMBER_KEY)
  sessionStorage.setItem(REFRESH_KEY, token)
}

export function clearRefreshToken(): void {
  localStorage.removeItem(REFRESH_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(REMEMBER_KEY)
}

export function readCompanyId(): string | null {
  return sessionStorage.getItem(COMPANY_KEY)
}

export function writeCompanyId(id: string | null): void {
  if (!id) {
    sessionStorage.removeItem(COMPANY_KEY)
    return
  }
  sessionStorage.setItem(COMPANY_KEY, id)
}

export function broadcastLogout(): void {
  localStorage.setItem(LOGOUT_KEY, String(Date.now()))
}
