import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { queryClient } from '@/lib/query-client'
import { useCompanyStore } from '@/stores/company-store'
import { CompanySwitcher } from '@/components/layout/company-switcher'

/**
 * FE-13 — prebacivač firme. Drži da platform admin vidi listu, da pad liste **nije tišina**, da izbor
 * firme osvježi kontekst (`getMe`) i da neuspjeh tog osvježavanja bude prijavljen (prije:
 * `.catch(() => undefined)` — korisnik bira firmu i ostaje na starim podacima bez poruke).
 */
const listCompanies = vi.fn()
const getMe = vi.fn()

vi.mock('@/lib/api', () => ({
  listCompanies: (query: unknown) => listCompanies(query),
  getMe: () => getMe(),
}))

function renderSwitcher(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <CompanySwitcher />
    </QueryClientProvider>,
  )
}

function signIn(roles: string[]) {
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'admin@gradix.local',
      roles: roles as never,
      permissions: [],
      companyId: null,
      company: null,
      hourlyRate: null,
      mustChangePassword: false,
      locale: 'bs',
    },
    accessToken: 't',
    ready: true,
  })
}

beforeEach(() => {
  listCompanies.mockReset().mockResolvedValue({
    data: [
      { id: 'c1', name: 'Gradix d.o.o.', slug: 'gradix', isActive: true },
      { id: 'c2', name: 'Test gradnja', slug: 'test-gradnja', isActive: true },
    ],
  })
  getMe.mockReset().mockResolvedValue({
    data: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'admin@gradix.local',
      roles: ['PLATFORM_ADMIN'],
      permissions: [],
      companyId: 'c2',
      company: null,
      hourlyRate: null,
      mustChangePassword: false,
      locale: 'bs',
    },
  })
  useCompanyStore.setState({ selectedId: null })
})

describe('CompanySwitcher', () => {
  it('se ne prikazuje korisniku koji nije platform admin', () => {
    signIn(['ADMIN'])
    renderSwitcher()
    expect(screen.queryByText('Firma')).not.toBeInTheDocument()
  })

  it('prikazuje listu firmi i bira firmu (uz osvježavanje konteksta)', async () => {
    signIn(['PLATFORM_ADMIN'])
    renderSwitcher()

    const trigger = await screen.findByRole('combobox', { name: 'Izaberite firmu' })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'Test gradnja' }))

    expect(useCompanyStore.getState().selectedId).toBe('c2')
    expect(getMe).toHaveBeenCalled()
  })

  it('nakon resetovanja stvarnog keša opet učita firmu i zadrži izbor', async () => {
    queryClient.clear()
    signIn(['PLATFORM_ADMIN'])
    const { unmount } = renderSwitcher(queryClient)
    const trigger = await screen.findByRole('combobox', { name: 'Izaberite firmu' })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'Test gradnja' }))
    await waitFor(() => expect(trigger).toBeEnabled())
    expect(useCompanyStore.getState().selectedId).toBe('c2')
    expect(trigger).toHaveTextContent('Test gradnja')
    expect(listCompanies.mock.calls.length).toBeGreaterThanOrEqual(2)
    unmount()
    queryClient.clear()
  })

  it('revizija raste samo kad se izbor zaista promijeni', () => {
    useCompanyStore.setState({ selectedId: 'c1' })
    const initial = useCompanyStore.getState().revision
    useCompanyStore.getState().setSelectedId('c1')
    expect(useCompanyStore.getState().revision).toBe(initial)
    useCompanyStore.getState().setSelectedId('c2')
    useCompanyStore.getState().setSelectedId('c1')
    expect(useCompanyStore.getState().revision).toBe(initial + 2)
  })

  it('pad liste firmi je vidljiv i blokira izbor', async () => {
    signIn(['PLATFORM_ADMIN'])
    listCompanies.mockRejectedValue(new Error('mreža'))
    renderSwitcher()

    expect(await screen.findByRole('alert')).toHaveTextContent('Lista firmi se nije učitala.')
    expect(screen.getByRole('combobox', { name: 'Izaberite firmu' })).toBeDisabled()
  })
})
