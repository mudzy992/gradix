import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useDisplayPrefs, usePublicSettings } from '@/hooks/use-public-settings'

/**
 * FE-14 — `useDisplayPrefs` je hranio `Intl.DateTimeFormat` sirovim stringovima iz postavki. Prazna
 * ili neispravna zona (npr. „GMT+1“, ili prazan string) rušila je zvono obavještenja i dnevnik
 * (`RangeError: Invalid time zone specified`), a format bez `dd`/`MM` tokena je tiho prikazivao isti
 * datum. Sada se nevalidne vrijednosti zamjenjuju defaultima; hook se ne poziva bez `slug`-a.
 */
const getPublicSettings = vi.fn()

vi.mock('@/lib/api', () => ({
  getPublicSettings: (slug: string) => getPublicSettings(slug),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function usePrefs() {
  return renderHook(useDisplayPrefs, { wrapper })
}

beforeEach(() => {
  getPublicSettings.mockReset().mockResolvedValue({ data: {} })
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ADMIN'],
      permissions: [],
      companyId: 'c1',
      company: { slug: 'demo' } as never,
      hourlyRate: null,
      mustChangePassword: false,
      locale: 'bs',
    },
    accessToken: 't',
    ready: true,
  })
})

describe('useDisplayPrefs', () => {
  it('koristi vrijednosti iz postavki kad su ispravne', async () => {
    getPublicSettings.mockResolvedValue({ data: { 'app.timezone': 'UTC', 'app.dateFormat': 'yyyy-MM-dd' } })
    const { result } = usePrefs()

    await waitFor(() => expect(result.current.timeZone).toBe('UTC'))
    expect(result.current.dateFormat).toBe('yyyy-MM-dd')
    expect(getPublicSettings).toHaveBeenCalledWith('demo')
  })

  it('nevalidna vremenska zona ne ruši pozivaoce — fallback na Europe/Sarajevo', async () => {
    getPublicSettings.mockResolvedValue({ data: { 'app.timezone': 'GMT+1' } })
    const { result } = usePrefs()

    await waitFor(() => expect(getPublicSettings).toHaveBeenCalled())
    expect(result.current.timeZone).toBe('Europe/Sarajevo')
    // Ključno: vrijednost mora proći kroz `Intl` bez izuzetka.
    expect(() => new Intl.DateTimeFormat('en-GB', { timeZone: result.current.timeZone })).not.toThrow()
  })

  it('prazan string i format bez `dd`/`MM` tokena padaju na default', async () => {
    getPublicSettings.mockResolvedValue({ data: { 'app.timezone': '   ', 'app.dateFormat': 'yyyy' } })
    const { result } = usePrefs()

    await waitFor(() => expect(getPublicSettings).toHaveBeenCalled())
    expect(result.current).toEqual({ timeZone: 'Europe/Sarajevo', dateFormat: 'dd.MM.yyyy' })
  })

  it('ne-string vrijednosti (npr. broj ili null) se ignorišu', async () => {
    getPublicSettings.mockResolvedValue({ data: { 'app.timezone': null, 'app.dateFormat': 20240101 } })
    const { result } = usePrefs()

    await waitFor(() => expect(getPublicSettings).toHaveBeenCalled())
    expect(result.current).toEqual({ timeZone: 'Europe/Sarajevo', dateFormat: 'dd.MM.yyyy' })
  })

  it('bez firme se ne poziva API (nema `slug`-a)', async () => {
    useAuthStore.setState({ user: null, accessToken: null, ready: true })
    const { result } = renderHook(() => usePublicSettings(), { wrapper })

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(getPublicSettings).not.toHaveBeenCalled()
  })
})
