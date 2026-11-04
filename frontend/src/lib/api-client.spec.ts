import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-types'
import type { AppRole } from '@/lib/constants'
import { api, apiBlob, clearSession, forceLogin, refreshSession } from '@/lib/api-client'
import { queryClient } from '@/lib/query-client'
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { REFRESH_KEY } from '@/lib/constants'

/**
 * FE-15 — jezgro mrežnog sloja. Drži ono što je prije tiho pucalo: mrežni prekid mora dati
 * `ApiError('NETWORK_ERROR')` (a ne `TypeError: Failed to fetch` u engleskom tekstu), ne-JSON odgovor
 * proxy-ja ne smije baciti `SyntaxError`, izvoz (`apiBlob`) mora osvježiti token kao i `api()`, a
 * odjava mora očistiti keš upita (na dijeljenom računaru sljedeći korisnik ne smije vidjeti tuđe
 * podatke).
 */
const fetchMock = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function ok<T>(data: T) {
  return json({ success: true, data })
}

function me(roles: AppRole[] = ['ADMIN']) {
  return {
    id: 'u1',
    firstName: 'A',
    lastName: 'B',
    employeeCode: null,
    email: 'a@b.c',
    roles,
    permissions: [],
    companyId: 'c1',
    company: null,
    hourlyRate: null,
    mustChangePassword: false,
    locale: 'bs' as const,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  clearRefreshToken()
  useAuthStore.setState({ accessToken: 'token-1', user: me(), ready: true })
  useCompanyStore.setState({ selectedId: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearRefreshToken()
})

describe('api()', () => {
  it('uspješan odgovor vraća `data` i `meta`, uz `Authorization` iz store-a', async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: [{ id: 'p1' }], meta: { page: 1, limit: 20, total: 1 } }))

    const result = await api<{ id: string }[]>('/api/projects', { query: { page: 1, q: 'kanal', status: undefined } })

    expect(result.data).toEqual([{ id: 'p1' }])
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/projects?page=1&q=kanal')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
  })

  it('platform administrator uz izabranu firmu šalje `X-Company-Id`', async () => {
    useAuthStore.setState({ user: me(['PLATFORM_ADMIN']) })
    useCompanyStore.setState({ selectedId: 'company-7' })
    fetchMock.mockResolvedValue(ok(null))

    await api('/api/projects')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-Company-Id']).toBe('company-7')
  })

  it('204 vraća `data: null` (bez pokušaja parsiranja)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(api('/api/projects/p1', { method: 'DELETE' })).resolves.toEqual({ data: null })
  })

  it('mrežni prekid daje `ApiError` NETWORK_ERROR sa statusom 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await api('/api/me').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })

  it('ne-JSON odgovor (proxy 502 HTML) daje ApiError, ne SyntaxError', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))

    await expect(api('/api/me')).rejects.toBeInstanceOf(ApiError)
  })

  it('greška iz envelope-a nosi kod i detalje sa servera', async () => {
    fetchMock.mockResolvedValue(
      json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'Polje', details: { name: 'required' } } }, 400),
    )

    await expect(api('/api/projects', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
      details: { name: 'required' },
    })
  })

  it('401 → osvježi token i ponovi zahtjev sa novim tokenom', async () => {
    writeRefreshToken('refresh-1', false)
    fetchMock
      .mockResolvedValueOnce(json({ success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'x' } }, 401))
      .mockResolvedValueOnce(json({ success: true, data: { accessToken: 'token-2', refreshToken: 'refresh-2' } }))
      .mockResolvedValueOnce(ok({ id: 'u1' }))

    await expect(api('/api/me')).resolves.toEqual({ data: { id: 'u1' } })
    expect(useAuthStore.getState().accessToken).toBe('token-2')
    expect(readRefreshToken()).toBe('refresh-2')
    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer token-2')
  })

  it('401 i neuspjelo osvježavanje → odjava (sesija obrisana)', async () => {
    writeRefreshToken('refresh-1', false)
    fetchMock
      .mockResolvedValueOnce(json({ success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'x' } }, 401))
      .mockResolvedValueOnce(json({ success: false, error: { code: 'AUTH_REFRESH_REUSE', message: 'x' } }, 401))

    await expect(api('/api/me')).rejects.toMatchObject({ status: 401 })
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(readRefreshToken()).toBeNull()
  })

  it('mrežni prekid tokom osvježavanja ne briše refresh token (sesija preživi)', async () => {
    writeRefreshToken('refresh-1', false)
    fetchMock.mockResolvedValueOnce(json({ success: false, error: { code: 'X', message: 'x' } }, 401))
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(api('/api/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(readRefreshToken()).toBe('refresh-1')
  })

  it('ne-JSON odgovor na osvježavanje ne ostavlja sesiju „otvorenu“', async () => {
    writeRefreshToken('refresh-1', false)
    fetchMock
      .mockResolvedValueOnce(json({ success: false, error: { code: 'X', message: 'x' } }, 401))
      .mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))

    await expect(refreshSession()).resolves.toBe(false)
    expect(readRefreshToken()).toBeNull()
  })
})

describe('apiBlob()', () => {
  it('vraća Blob na uspjeh', async () => {
    fetchMock.mockResolvedValue(new Response('pdf', { status: 200 }))

    const blob = await apiBlob('/api/reports/export')
    expect(blob.size).toBe(3)
  })

  it('401 → osvježi token i ponovi izvoz (prije: „Export failed“ poslije isteka tokena)', async () => {
    writeRefreshToken('refresh-1', false)
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(json({ success: true, data: { accessToken: 'token-2', refreshToken: 'refresh-2' } }))
      .mockResolvedValueOnce(new Response('pdf', { status: 200 }))

    const blob = await apiBlob('/api/reports/export')
    expect(blob.size).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('429 daje RATE_LIMITED, mrežni prekid NETWORK_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
    await expect(apiBlob('/api/reports/export')).rejects.toMatchObject({ code: 'RATE_LIMITED' })

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(apiBlob('/api/reports/export')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})

describe('clearSession()', () => {
  it('briše store, refresh token i keš upita (jedno mjesto za sve odjave)', () => {
    writeRefreshToken('refresh-1', true)
    queryClient.setQueryData(['users'], [{ id: 'u1' }])

    clearSession()

    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(readRefreshToken()).toBeNull()
    expect(queryClient.getQueryData(['users'])).toBeUndefined()
  })
})

describe('forceLogin()', () => {
  it('briše keš upita (podaci prethodnog korisnika ne smiju ostati)', () => {
    const clear = vi.spyOn(queryClient, 'clear')
    queryClient.setQueryData(['me'], { id: 'old-user' })

    forceLogin()

    expect(clear).toHaveBeenCalled()
    expect(queryClient.getQueryData(['me'])).toBeUndefined()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('session and company changes during requests', () => {
  function deferred() {
    let resolve!: (value: Response) => void
    const promise = new Promise<Response>((done) => { resolve = done })
    return { promise, resolve }
  }

  function loginAsSecondUser() {
    clearSession()
    writeRefreshToken('refresh-b', false)
    useAuthStore.setState({ accessToken: 'token-b', user: { ...me(), id: 'u2' } })
  }

  it.each([200, 401])('old refresh result %i cannot overwrite or clear the new login', async (status) => {
    writeRefreshToken('refresh-a', false)
    const pending = deferred()
    fetchMock.mockReturnValueOnce(pending.promise)
    const oldRefresh = refreshSession().catch((error: unknown) => error)
    loginAsSecondUser()
    pending.resolve(status === 200
      ? ok({ accessToken: 'stale-access', refreshToken: 'stale-refresh' })
      : json({ success: false, error: { code: 'AUTH_REFRESH_REUSE', message: 'x' } }, 401))
    expect(await oldRefresh).toMatchObject({ code: 'SESSION_CHANGED' })
    expect(readRefreshToken()).toBe('refresh-b')
    expect(useAuthStore.getState().accessToken).toBe('token-b')
    expect(useAuthStore.getState().user?.id).toBe('u2')
  })

  it('a new login can refresh independently while the previous refresh is in flight', async () => {
    writeRefreshToken('refresh-a', false)
    const pending = deferred()
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok({ accessToken: 'new-b', refreshToken: 'rotated-b' }))
    const oldRefresh = refreshSession().catch((error: unknown) => error)
    loginAsSecondUser()
    await expect(refreshSession()).resolves.toBe(true)
    pending.resolve(ok({ accessToken: 'stale-access', refreshToken: 'stale-refresh' }))
    expect(await oldRefresh).toMatchObject({ code: 'SESSION_CHANGED' })
    expect(readRefreshToken()).toBe('rotated-b')
    expect(useAuthStore.getState().accessToken).toBe('new-b')
  })

  it.each([200, 401])('an old API response %i is not applied or retried using another user', async (status) => {
    writeRefreshToken('refresh-a', false)
    const pending = deferred()
    fetchMock.mockReturnValueOnce(pending.promise)
    const result = api('/api/projects', { method: 'POST', body: { name: 'old' } }).catch((error: unknown) => error)
    loginAsSecondUser()
    pending.resolve(status === 200 ? ok({ id: 'old-project' }) : json({ success: false }, 401))
    expect(await result).toMatchObject({ code: 'SESSION_CHANGED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readRefreshToken()).toBe('refresh-b')
  })

  it.each([200, 401])('company switch rejects an old blob response %i without retrying it', async (status) => {
    useAuthStore.setState({ user: me(['PLATFORM_ADMIN']) })
    useCompanyStore.setState({ selectedId: 'c1' })
    writeRefreshToken('refresh-a', false)
    const pending = deferred()
    fetchMock.mockReturnValueOnce(pending.promise)
    const result = apiBlob('/api/export').catch((error: unknown) => error)
    useCompanyStore.setState({ selectedId: 'c2' })
    pending.resolve(new Response(status === 200 ? 'old report' : null, { status }))
    expect(await result).toMatchObject({ code: 'SESSION_CHANGED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readRefreshToken()).toBe('refresh-a')
  })

  it('a refresh token changed externally is not overwritten by an old response', async () => {
    writeRefreshToken('refresh-a', false)
    const pending = deferred()
    fetchMock.mockReturnValueOnce(pending.promise)
    const result = refreshSession().catch((error: unknown) => error)
    sessionStorage.setItem(REFRESH_KEY, 'external-token')
    pending.resolve(ok({ accessToken: 'stale-access', refreshToken: 'stale-refresh' }))
    expect(await result).toMatchObject({ code: 'SESSION_CHANGED' })
    expect(readRefreshToken()).toBe('external-token')
    expect(useAuthStore.getState().accessToken).toBe('token-1')
  })

  it('changing company during refresh prevents retrying the old write in the new company', async () => {
    useAuthStore.setState({ user: me(['PLATFORM_ADMIN']) })
    useCompanyStore.setState({ selectedId: 'c1' })
    writeRefreshToken('refresh-a', false)
    const pending = deferred()
    fetchMock.mockResolvedValueOnce(json({ success: false }, 401)).mockReturnValueOnce(pending.promise)
    const result = api('/api/projects', { method: 'POST', body: { name: 'old' } }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    useCompanyStore.setState({ selectedId: 'c2' })
    pending.resolve(ok({ accessToken: 'rotated-access', refreshToken: 'rotated-token' }))
    expect(await result).toMatchObject({ code: 'SESSION_CHANGED' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(readRefreshToken()).toBe('rotated-token')
  })

  it('concurrent requests share the same session refresh and both retry', async () => {
    writeRefreshToken('refresh-a', false)
    const pending = deferred()
    fetchMock.mockResolvedValueOnce(json({ success: false }, 401))
      .mockResolvedValueOnce(json({ success: false }, 401))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(ok('one'))
      .mockResolvedValueOnce(ok('two'))
    const one = api('/api/one')
    const two = api('/api/two')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    pending.resolve(ok({ accessToken: 'rotated-access', refreshToken: 'rotated-token' }))
    expect((await Promise.all([one, two])).map((v) => v.data).sort()).toEqual(['one', 'two'])
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
