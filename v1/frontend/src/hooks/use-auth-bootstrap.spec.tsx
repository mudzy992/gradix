import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type MeUser } from '@/lib/api-types'
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
const getSessionGeneration = vi.fn()

vi.mock('@/lib/api-client', () => ({
  refreshSession: () => refreshSession(),
  forceLogin: () => forceLogin(),
}))

vi.mock('@/lib/api', () => ({
  getMe: () => getMe(),
}))

vi.mock('@/lib/storage', () => ({
  readRefreshToken: () => readRefreshToken(),
  getSessionGeneration: () => getSessionGeneration(),
}))

const USER: MeUser = {
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
  getSessionGeneration.mockReset().mockReturnValue(1)
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
  it.each(['RATE_LIMITED', 'NETWORK_ERROR'] as const)('oporavak %s nudi retry, ne briše token i zatim učita korisnika', async (code) => {
    refreshSession.mockRejectedValueOnce(new ApiError(code, 'temporary', code === 'RATE_LIMITED' ? 429 : 0)).mockResolvedValueOnce(true)
    getMe.mockResolvedValue({ data: USER })
    const { result } = renderHook(() => useAuthBootstrap())
    await waitFor(() => expect(result.current.error).toBe(code))
    expect(useAuthStore.getState().ready).toBe(true)
    expect(forceLogin).not.toHaveBeenCalled()
    act(() => result.current.retry())
    await waitFor(() => expect(useAuthStore.getState().user?.id).toBe('u1'))
    expect(result.current.error).toBeNull()
    expect(refreshSession).toHaveBeenCalledTimes(2)
  })

  it('prikazuje nepoznat ishod refresh-a i nakon promjene generacije sesije', async () => {
    refreshSession.mockImplementation(async () => {
      getSessionGeneration.mockReturnValue(2)
      throw new ApiError('AUTH_REFRESH_UNCERTAIN', 'unknown outcome', 0)
    })
    const { result } = renderHook(() => useAuthBootstrap())
    await waitFor(() => expect(result.current.error).toBe('AUTH_REFRESH_UNCERTAIN'))
    expect(useAuthStore.getState().ready).toBe(true)
    expect(getMe).not.toHaveBeenCalled()
    expect(forceLogin).not.toHaveBeenCalled()
  })

  it('limit pri učitavanju profila također omogućava retry ili nastavak bez obnove', async () => {
    refreshSession.mockResolvedValue(true)
    getMe.mockRejectedValue(new ApiError('RATE_LIMITED', 'limit', 429))
    const { result } = renderHook(() => useAuthBootstrap())
    await waitFor(() => expect(result.current.error).toBe('RATE_LIMITED'))
    expect(forceLogin).not.toHaveBeenCalled()
    act(() => result.current.continueWithoutRecovery())
    expect(result.current.error).toBeNull()
    expect(useAuthStore.getState().ready).toBe(true)
  })

  it('zakašnjeli getMe ne smije odjaviti novu sesiju niti prikazati starog korisnika', async () => {
    refreshSession.mockResolvedValue(true)
    let reject!: (error: unknown) => void
    getMe.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    renderHook(() => useAuthBootstrap())
    await waitFor(() => expect(getMe).toHaveBeenCalledOnce())
    getSessionGeneration.mockReturnValue(2)
    act(() => useAuthStore.setState({ user: { ...USER, id: 'new' } }))
    await act(async () => reject(new ApiError('AUTH_INVALID_CREDENTIALS', 'old', 401)))
    expect(forceLogin).not.toHaveBeenCalled()
    expect(useAuthStore.getState().user?.id).toBe('new')
  })

  it('nakon unmounta zakašnjeli refresh ne pokreće getMe', async () => {
    let resolve!: (value: boolean) => void
    refreshSession.mockReturnValue(new Promise((done) => { resolve = done }))
    const { unmount } = renderHook(() => useAuthBootstrap())
    unmount()
    await act(async () => resolve(true))
    expect(getMe).not.toHaveBeenCalled()
  })

  it('retry nakon privremene greške profila ne rotira već osvježeni token ponovo', async () => {
    refreshSession.mockImplementation(async () => {
      useAuthStore.setState({ accessToken: 'fresh' })
      return true
    })
    getMe.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', 0)).mockResolvedValueOnce({ data: USER })
    const { result } = renderHook(() => useAuthBootstrap())
    await waitFor(() => expect(result.current.error).toBe('NETWORK_ERROR'))
    act(() => result.current.retry())
    await waitFor(() => expect(useAuthStore.getState().user?.id).toBe('u1'))
    expect(refreshSession).toHaveBeenCalledOnce()
    expect(getMe).toHaveBeenCalledTimes(2)
  })

  it('zakašnjeli uspjeh getMe ne prepisuje novu sesiju', async () => {
    refreshSession.mockResolvedValue(true)
    let resolve!: (value: { data: MeUser }) => void
    getMe.mockReturnValue(new Promise((done) => { resolve = done }))
    renderHook(() => useAuthBootstrap())
    await waitFor(() => expect(getMe).toHaveBeenCalledOnce())
    getSessionGeneration.mockReturnValue(2)
    act(() => useAuthStore.setState({ user: { ...USER, id: 'new' } }))
    await act(async () => resolve({ data: USER }))
    expect(useAuthStore.getState().user?.id).toBe('new')
  })

  it('nova sesija tokom refresh-a ne pokreće getMe starog bootstrapa', async () => {
    let resolve!: (value: boolean) => void
    refreshSession.mockReturnValue(new Promise((done) => { resolve = done }))
    renderHook(() => useAuthBootstrap())
    getSessionGeneration.mockReturnValue(2)
    act(() => useAuthStore.setState({ user: { ...USER, id: 'new' } }))
    await act(async () => resolve(true))
    expect(getMe).not.toHaveBeenCalled()
    expect(useAuthStore.getState().user?.id).toBe('new')
    expect(useAuthStore.getState().ready).toBe(true)
  })

})
