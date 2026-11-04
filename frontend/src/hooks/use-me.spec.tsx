import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHasPermission, useIsPlatform, useMeQuery } from '@/hooks/use-me'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useCompanyStore } from '@/stores/company-store'
import { useAuthStore } from '@/stores/auth-store'

/**
 * FE-15 — pomoćni hookovi za prava i kontekst firme. Drže dvije stvari iz FE-13/FE-14: djelimičan
 * `me` (bez `roles`/`permissions`) ne smije rušiti ekran, i platform administrator bez izabrane firme
 * nije „spreman“ (svaki zahtjev bi pao na `TENANT_HEADER_REQUIRED`).
 */
function setUser(user: unknown) {
  useAuthStore.setState({ user: user as never, accessToken: 't', ready: true })
}

const getMe = vi.fn()

vi.mock('@/lib/api', () => ({
  getMe: () => getMe(),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  useCompanyStore.setState({ selectedId: null })
  getMe.mockReset()
})

describe('useHasPermission', () => {
  it('vraća `true` kad pravo postoji', () => {
    setUser({ id: 'u1', roles: ['ADMIN'], permissions: ['users.read'] })
    expect(renderHook(() => useHasPermission('users.read')).result.current).toBe(true)
  })

  it('vraća `false` bez prava i bez niza prava', () => {
    setUser({ id: 'u1', roles: ['ADMIN'], permissions: ['users.read'] })
    expect(renderHook(() => useHasPermission('users.write')).result.current).toBe(false)

    setUser({ id: 'u1', roles: ['ADMIN'] })
    expect(renderHook(() => useHasPermission('users.read')).result.current).toBe(false)
  })

  it('bez korisnika vraća `false` (ne baca)', () => {
    setUser(null)
    expect(renderHook(() => useHasPermission('users.read')).result.current).toBe(false)
  })
})

describe('useIsPlatform', () => {
  it('prepoznaje platformsku rolu, tolerantno na `roles` koji nedostaje', () => {
    setUser({ id: 'u1', roles: ['PLATFORM_ADMIN'], permissions: [] })
    expect(renderHook(() => useIsPlatform()).result.current).toBe(true)

    setUser({ id: 'u1', permissions: [] })
    expect(renderHook(() => useIsPlatform()).result.current).toBe(false)
  })
})

describe('useTenantReady', () => {
  it('obična rola je uvijek spremna', () => {
    setUser({ id: 'u1', roles: ['ADMIN'], permissions: [] })
    expect(renderHook(() => useTenantReady()).result.current).toBe(true)
  })

  it('platform administrator nije spreman dok ne izabere firmu', () => {
    setUser({ id: 'u1', roles: ['PLATFORM_ADMIN'], permissions: [] })
    expect(renderHook(() => useTenantReady()).result.current).toBe(false)

    useCompanyStore.setState({ selectedId: 'company-1' })
    expect(renderHook(() => useTenantReady()).result.current).toBe(true)
  })
})

describe('useMeQuery', () => {
  it('ne poziva API bez pristupnog tokena', () => {
    useAuthStore.setState({ user: null, accessToken: null, ready: true })
    const { result } = renderHook(() => useMeQuery(), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(getMe).not.toHaveBeenCalled()
  })

  it('učitani profil upisuje u store (jedan izvor za prava)', async () => {
    const me = { id: 'u1', firstName: 'Demo', lastName: 'Admin', roles: ['ADMIN'], permissions: ['users.read'] }
    getMe.mockResolvedValue({ data: me })
    useAuthStore.setState({ user: null, accessToken: 't', ready: true })
    const { result } = renderHook(() => useMeQuery(), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(me))
    expect(useAuthStore.getState().user).toEqual(me)
  })
})
