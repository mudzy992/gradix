import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-types'
import { i18n } from '@/i18n'
import { useAuthBootstrap } from '@/hooks/use-auth-bootstrap'
import { useAuthStore } from '@/stores/auth-store'

/**
 * FE-15 — prvo pokretanje aplikacije. Prije: kad bi `refreshSession()` odbio Promise (mreža pala pri
 * otvaranju), `void run()` je ostavljao **neuhvaćen `rejection`**, a `ready` se nikad nije postavljao —
 * korisnik je gledao „učitavanje“ zauvijek. Uz to je svaki pad `getMe` (i mrežni) odjavljivao korisnika
 * i brisao ispravan refresh token.
 */
const refreshSession = vi.fn()
const forceLogin = vi.fn()
const getMe = vi.fn()
const readRefreshToken = vi.fn()

vi.mock('@/lib/api-client', () => ({
  refreshSession: () => refreshSession(),
  forceLogin: () => forceLogin(),
}))

vi.mock('@/lib/api', () => ({
  getMe: () => getMe(),
}))

vi.mock('@/lib/storage', () => ({
  readRefreshToken: () => readRefreshToken(),
}))

const USER = {
  id: 'u1',
  firstName: 'Demo',
  lastName: 'Admin',
  employeeCode: null,
  email: 'admin@gradix.local',
  roles: ['ADMIN'],
  permissions: ['users.read'],
  companyId: 'c1',
  company: { id: 'c1', name: 'Demo', slug: 'demo' },
  hourlyRate: null,
  mustChangePassword: false,
  locale: 'en' as const,
}

beforeEach(() => {
  refreshSession.mockReset()
  forceLogin.mockReset()
  getMe.mockReset()
  readRefreshToken.mockReset().mockReturnValue('refresh-1')
  useAuthStore.setState({ accessToken: null, user: null, ready: false })
})

describe('useAuthBootstrap', () => {
  it('bez refresh tokena odmah je `ready` i ne zove API', async () => {
    readRefreshToken.mockReturnValue(null)
    const { result } = renderHook(() => useAuthBootstrap())

    await waitFor(() => expect(useAuthStore.getState().ready).toBe(true))
    expect(refreshSession).not.toHaveBeenCalled()
    expect(result).toBeDefined()
  })

  it('mrežni pad pri osvježavanju ne ostavlja aplikaciju bez `ready` (i ne odjavljuje)', async () => {
    refreshSession.mockRejectedValue(new ApiError('NETWORK_ERROR', 'Failed to fetch', 0))
    renderHook(() => useAuthBootstrap())

    await waitFor(() => expect(useAuthStore.getState().ready).toBe(true))
    expect(forceLogin).not.toHaveBeenCalled()
  })

  it('uspješna sesija postavlja korisnika i jezik iz profila', async () => {
    refreshSession.mockResolvedValue(true)
    getMe.mockResolvedValue({ data: USER })
    const changeLanguage = vi.spyOn(i18n, 'changeLanguage')
    renderHook(() => useAuthBootstrap())

    await waitFor(() => expect(useAuthStore.getState().user?.id).toBe('u1'))
    expect(changeLanguage).toHaveBeenCalledWith('en')
    expect(useAuthStore.getState().ready).toBe(true)
  })

  it('neispravna sesija (401) odjavljuje korisnika', async () => {
    refreshSession.mockResolvedValue(true)
    getMe.mockRejectedValue(new ApiError('AUTH_INVALID_CREDENTIALS', 'x', 401))
    renderHook(() => useAuthBootstrap())

    await waitFor(() => expect(forceLogin).toHaveBeenCalled())
    expect(useAuthStore.getState().ready).toBe(true)
  })

  it('mrežni prekid na `getMe` NE odjavljuje (refresh token ostaje za sljedeći pokušaj)', async () => {
    refreshSession.mockResolvedValue(true)
    getMe.mockRejectedValue(new ApiError('NETWORK_ERROR', 'Failed to fetch', 0))
    renderHook(() => useAuthBootstrap())

    await waitFor(() => expect(useAuthStore.getState().ready).toBe(true))
    expect(forceLogin).not.toHaveBeenCalled()
  })

  it('neuspjelo osvježavanje (false) ne zove `getMe`', async () => {
    refreshSession.mockResolvedValue(false)
    renderHook(() => useAuthBootstrap())

    await waitFor(() => expect(useAuthStore.getState().ready).toBe(true))
    expect(getMe).not.toHaveBeenCalled()
  })
})
