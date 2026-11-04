import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  broadcastLogout,
  clearRefreshToken,
  isRemembered,
  readCompanyId,
  readRefreshToken,
  writeCompanyId,
  writeRefreshToken,
} from '@/lib/storage'
import { COMPANY_KEY, LOGOUT_KEY, REFRESH_KEY } from '@/lib/constants'

/**
 * FE-15 — pohrana tokena. Drži: „zapamti me“ bira `localStorage`, inače `sessionStorage`; i — ključno —
 * pristup pohrani može baciti (`SecurityError` u Safari privatnom režimu), a prije je to rušilo
 * aplikaciju već pri uvozu modula. Sada se koristi memorijski fallback.
 */
function blockStorage() {
  return {
    get: vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    }),
    set: vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    }),
    remove: vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    }),
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  clearRefreshToken()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('refresh token', () => {
  it('bez „zapamti me“ ide u sessionStorage', () => {
    writeRefreshToken('t1', false)

    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('t1')
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(isRemembered()).toBe(false)
    expect(readRefreshToken()).toBe('t1')
  })

  it('sa „zapamti me“ ide u localStorage', () => {
    writeRefreshToken('t2', true)

    expect(localStorage.getItem(REFRESH_KEY)).toBe('t2')
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(isRemembered()).toBe(true)
    expect(readRefreshToken()).toBe('t2')
  })

  it('novi zapis uklanja prethodni iz oba skladišta (bez duplog tokena)', () => {
    writeRefreshToken('stari', true)
    writeRefreshToken('novi', false)

    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(readRefreshToken()).toBe('novi')
    expect(isRemembered()).toBe(false)
  })

  it('`clearRefreshToken` briše token i oznaku pamćenja', () => {
    writeRefreshToken('t3', true)

    clearRefreshToken()

    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(localStorage.getItem('gradix:remember')).toBeNull()
    expect(readRefreshToken()).toBeNull()
  })

  it('ne vraća stari memorisani token kad ga drugi tab obriše', () => {
    writeRefreshToken('t-old', true)
    localStorage.removeItem(REFRESH_KEY)
    expect(readRefreshToken()).toBeNull()
  })

  it('ne vraća zapamćeni token kad drugi tab obriše oznaku pamćenja', () => {
    writeRefreshToken('t-old', true)
    localStorage.removeItem('gradix:remember')
    expect(isRemembered()).toBe(false)
    expect(readRefreshToken()).toBeNull()
  })

  it('ne oživljava token kada brisanje iz skladišta ne uspije', () => {
    writeRefreshToken('t-old', true)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError') })
    clearRefreshToken()
    expect(readRefreshToken()).toBeNull()
    expect(isRemembered()).toBe(false)
  })

  it('čuva novi token u memoriji i kad pisanje ne uspije ali čitanje radi', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    writeRefreshToken('t-new', true)
    expect(isRemembered()).toBe(true)
    expect(readRefreshToken()).toBe('t-new')
  })

  it('blokirana pohrana ne ruši pozivaoce — memorijski fallback drži sesiju', () => {
    const spy = blockStorage()

    expect(() => writeRefreshToken('t4', false)).not.toThrow()
    expect(readRefreshToken()).toBe('t4')
    expect(() => clearRefreshToken()).not.toThrow()
    expect(readRefreshToken()).toBeNull()
    expect(spy.set).toHaveBeenCalled()
  })
})

describe('izbor firme', () => {
  it('pamti se u sessionStorage i čisti kad je `null`', () => {
    writeCompanyId('company-1')
    expect(sessionStorage.getItem(COMPANY_KEY)).toBe('company-1')
    expect(readCompanyId()).toBe('company-1')

    writeCompanyId(null)
    expect(readCompanyId()).toBeNull()
  })

  it('blokirana pohrana: čitanje vraća `null`, pisanje ne baca', () => {
    blockStorage()

    expect(() => writeCompanyId('company-2')).not.toThrow()
    expect(readCompanyId()).toBe('company-2')
  })
})

describe('broadcastLogout', () => {
  it('upisuje oznaku za ostale tabove', () => {
    broadcastLogout()

    expect(localStorage.getItem(LOGOUT_KEY)).toMatch(/^\d+$/)
  })

  it('ne baca kad je pohrana blokirana', () => {
    blockStorage()

    expect(() => broadcastLogout()).not.toThrow()
  })
})
