import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeUser } from '@/lib/api-types'
import type { DashboardPayload } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { LegacyDashboardPage as DashboardPage } from '@/pages/dashboard-page'

/**
 * FE-05 — testovi drže odluke iz FE-04/D-043: prevedene kartice (ne sirovi `dash.*` ključevi),
 * hitnost rokova izraženu tekstom, prečice koje poštuju ista prava kao sidebar i stanja
 * (greška + retry, prazno prisustvo).
 */
const getDashboard = vi.fn<() => Promise<{ data: DashboardPayload }>>()

vi.mock('@/lib/api-ops', () => ({
  getDashboard: () => getDashboard(),
}))

function adminUser(overrides: Partial<MeUser> = {}): MeUser {
  return {
    id: 'u1',
    firstName: 'Amar',
    lastName: 'Hodžić',
    employeeCode: 'EMP-1',
    email: 'amar@example.com',
    roles: ['ADMIN'],
    permissions: ['projects.read', 'tasks.read', 'diary.read', 'fleet.read', 'hse.read', 'documents.read'],
    companyId: 'c1',
    company: null,
    hourlyRate: null,
    mustChangePassword: false,
    locale: 'bs',
    ...overrides,
  }
}

function payload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    cards: [
      { key: 'activeProjects', value: '4' },
      { key: 'spend', value: '12.500 / 40.000' },
      { key: 'openTimers', value: '0' },
      { key: 'unread', value: null },
    ] as unknown as DashboardPayload['cards'],
    presence: null,
    expiring: [],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getDashboard.mockReset()
  useAuthStore.setState({ user: adminUser(), accessToken: 'token', ready: true })
  useCompanyStore.setState({ selectedId: 'c1' })
})

describe('DashboardPage — kartice', () => {
  it('prikazuje prevedene labele, nikad sirove `dash.*` ključeve', async () => {
    getDashboard.mockResolvedValue({ data: payload() })
    renderPage()

    expect(await screen.findByText('Aktivni projekti')).toBeInTheDocument()
    expect(screen.getByText('Potrošeno / budžet')).toBeInTheDocument()
    expect(screen.getByText('Otvoreni timer-i')).toBeInTheDocument()
    // Regresija: ključ se nikad ne smije prikazati kao tekst (FE-05 mreža za spread override).
    expect(screen.queryByText(/dash\./)).not.toBeInTheDocument()
  })

  it('vrijednost bez podatka prikazuje crticom, a nulu kao nulu', async () => {
    getDashboard.mockResolvedValue({ data: payload() })
    renderPage()

    const openTimers = (await screen.findByText('Otvoreni timer-i')).closest<HTMLElement>('[data-slot="card"]')!
    expect(within(openTimers).getByText('0')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('kartica sa poznatom rutom je link, a bez rute nije', async () => {
    getDashboard.mockResolvedValue({ data: payload() })
    renderPage()

    const projects = await screen.findByRole('link', { name: /Aktivni projekti/ })
    expect(projects).toHaveAttribute('href', '/projects')
    expect(screen.queryByRole('link', { name: /Nepročitane obavijesti/ })).not.toBeInTheDocument()
  })
})

describe('DashboardPage — rokovi', () => {
  it('istekli dokument nosi tekst „isteklo prije …“ i sortira se prvi', async () => {
    getDashboard.mockResolvedValue({
      data: payload({
        expiring: [
          { entityType: 'machine', entityId: 'm1', type: 'registration', daysLeft: 20 },
          { entityType: 'company', entityId: 'c1', type: 'insurance', daysLeft: -3 },
          { entityType: 'worker', entityId: 'w1', type: 'medical', daysLeft: 0 },
        ],
      }),
    })
    renderPage()

    const items = await screen.findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('isteklo prije 3 d')
    expect(items[1]).toHaveTextContent('ističe danas')
    expect(items[2]).toHaveTextContent('još 20 d')
    // Tip entiteta je preveden, ne sirov (`machine`).
    expect(items[0]).toHaveTextContent('Firma')
  })

  it('bez rokova prikazuje prazno stanje, ne praznu karticu', async () => {
    getDashboard.mockResolvedValue({ data: payload({ expiring: [] }) })
    renderPage()

    expect(await screen.findByText('Nema dokumenata koji istječu.')).toBeInTheDocument()
  })
})

describe('DashboardPage — prisustvo', () => {
  it('null (rola bez prisustva) objašnjava zašto nema liste', async () => {
    getDashboard.mockResolvedValue({ data: payload({ presence: null }) })
    renderPage()

    expect(await screen.findByText('Prisustvo nije dostupno za vašu rolu.')).toBeInTheDocument()
  })

  it('prazna lista i osobe imaju različit prikaz (niko nije na terenu vs. inicijali)', async () => {
    getDashboard.mockResolvedValue({ data: payload({ presence: [] }) })
    const { unmount } = renderPage()
    expect(await screen.findByText('Trenutno nema nikoga na terenu.')).toBeInTheDocument()
    unmount()

    getDashboard.mockResolvedValue({
      data: payload({
        presence: [
          { userId: 'u1', firstName: 'Amar', lastName: 'Hodžić', projectId: 'p1', projectName: 'Most' },
        ] as unknown as DashboardPayload['presence'],
      }),
    })
    renderPage()
    expect(await screen.findByText('Amar Hodžić')).toBeInTheDocument()
    expect(screen.getByText('AH')).toBeInTheDocument()
  })
})

describe('DashboardPage — prečice', () => {
  it('prikazuje samo ekrane koje korisnik smije otvoriti', async () => {
    useAuthStore.setState({ user: adminUser({ permissions: ['projects.read'] }), accessToken: 't', ready: true })
    getDashboard.mockResolvedValue({ data: payload() })
    renderPage()

    expect(await screen.findByRole('link', { name: 'Projekti' })).toHaveAttribute('href', '/projects')
    expect(screen.queryByRole('link', { name: 'Zadaci' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Dnevnik' })).not.toBeInTheDocument()
  })

  it('platform admin bez izabrane firme ne dobija prečice do tenant ekrana', async () => {
    useAuthStore.setState({
      user: adminUser({ roles: ['PLATFORM_ADMIN'], permissions: ['projects.read', 'tasks.read'] }),
      accessToken: 't',
      ready: true,
    })
    useCompanyStore.setState({ selectedId: null })
    getDashboard.mockResolvedValue({ data: payload() })
    renderPage()

    // Bez izabrane firme upit se ne izvršava: nema kartica, nema prečica, ali ekran objašnjava zašto.
    expect(await screen.findByText('Izaberite firmu da vidite pokazatelje.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Projekti' })).not.toBeInTheDocument()
    expect(screen.queryByText('Brze akcije')).not.toBeInTheDocument()
    expect(getDashboard).not.toHaveBeenCalled()
  })
})

describe('DashboardPage — stanja', () => {
  it('greška je trajna, sa `role="alert"` i dugmetom koje ponovo pita API', async () => {
    getDashboard.mockRejectedValueOnce(new Error('mreža'))
    getDashboard.mockResolvedValueOnce({ data: payload() })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Podaci se nisu učitali.')

    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Aktivni projekti')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(getDashboard).toHaveBeenCalledTimes(2)
  })
})
