import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { AdminDashboard } from './admin-dashboard'

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(), getCreatedTasks: vi.fn(), getClosedTimers: vi.fn(), getProjects: vi.fn(),
  getPresence: vi.fn(), getDocumentAlerts: vi.fn(), getTaskAlerts: vi.fn(), getActivity: vi.fn(),
}))
vi.mock('@/lib/api-dashboard', () => mocks)
vi.mock('./project-map', () => ({ default: () => <div data-testid="project-map">Map</div> }))
const user = (overrides: Partial<MeUser> = {}): MeUser => ({
  id: 'u1', firstName: 'Amar', lastName: 'Hodžić', employeeCode: null, email: 'a@example.test', roles: ['ADMIN'],
  permissions: ['projects.read', 'projects.write', 'tasks.read', 'users.read', 'documents.read', 'payroll.read'],
  companyId: 'c1', company: null, hourlyRate: null, mustChangePassword: false, locale: 'bs', ...overrides,
})
const response = <T,>(data: T) => Promise.resolve({ data })
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><AdminDashboard /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  localStorage.removeItem('gradix.dashboard.theme')
  document.documentElement.classList.remove('dark')
  useAuthStore.setState({ user: user(), accessToken: 'token', ready: true })
  useCompanyStore.setState({ selectedId: null, revision: 0 })
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.getSummary.mockImplementation(() => response({ activeProjects: 2, openTasks: 3, openTimers: 1, projectsWithBudget: 1, knownPlannedBudget: '100.10', currentSpend: '99.99' }))
  mocks.getCreatedTasks.mockImplementation(() => response({ timezone: 'Europe/Sarajevo', limit: 7, nextCursor: null, current: 2, previous: 0, delta: 2, deltaPercent: null, series: [{ startAt: '2025-01-01T00:00:00.000Z', endAt: '2025-01-02T00:00:00.000Z', count: 2 }] }))
  mocks.getClosedTimers.mockImplementation(() => response({ timezone: 'Europe/Sarajevo', limit: 7, nextCursor: null, currentMinutes: '90', previousMinutes: '60', deltaMinutes: '30', deltaPercent: '50.00', series: [{ startAt: '2025-01-01T00:00:00.000Z', endAt: '2025-01-02T00:00:00.000Z', minutes: '90', workers: 1 }] }))
  mocks.getProjects.mockImplementation(() => response([{ id: 'p', name: 'Most', status: 'IN_PROGRESS', plannedBudget: '100.10', currentSpend: '99.99', lat: '43.8563000', lng: '18.4131000', geofenceRadius: 100 }]))
  mocks.getPresence.mockImplementation(() => response([{ userId: 'w', firstName: 'Ana', lastName: 'Anić', projectId: 'p', lastSeenAt: '2025-01-01T12:00:00.000Z' }]))
  mocks.getDocumentAlerts.mockImplementation(() => response([]))
  mocks.getTaskAlerts.mockImplementation(() => response([]))
  mocks.getActivity.mockImplementation(() => response([]))
})
afterEach(() => vi.unstubAllGlobals())
describe('admin dashboard v2', () => {
  it('puts today and severity-ranked actionable alerts before the KPI overview', async () => {
    mocks.getDocumentAlerts.mockImplementation(() => response([{ id: 'd', kind: 'WORKER', type: 'medical', expiresAt: '2025-01-01T00:00:00.000Z', daysUntilExpiry: -1, severity: 'CRITICAL' }]))
    mocks.getTaskAlerts.mockImplementation(() => response([{ id: 't', projectId: 'p', title: 'Nadzor', status: 'OPEN', plannedEnd: '2025-01-02T00:00:00.000Z', severity: 'HIGH' }]))
    setup()
    const today = await screen.findByRole('region', { name: 'Danas' })
    const alerts = screen.getByRole('region', { name: 'Upozorenja' })
    const overview = screen.getByRole('region', { name: 'Ključni pokazatelji' })
    expect(today.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(alerts.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await within(today).findByText('Na terenu · GPS procjena')).toBeInTheDocument()
    expect(within(today).getByText('2')).toBeInTheDocument()
    expect(await within(alerts).findByRole('link', { name: /Dokument radnika/ })).toHaveAttribute('href', '/documents')
    expect(within(alerts).getByRole('link', { name: /Zadatak: Nadzor/ })).toHaveAttribute('href', '/tasks/t')
  })
  it('does not show a complete alert count when one source fails', async () => {
    mocks.getDocumentAlerts.mockRejectedValueOnce(new Error('offline'))
    setup()
    const today = await screen.findByRole('region', { name: 'Danas' })
    expect(await within(today).findByText('Neka upozorenja nisu dostupna.')).toBeInTheDocument()
  })
  it('styles each KPI with an accent and reduced-motion-safe hover treatment', async () => {
    setup()
    const overview = screen.getByRole('region', { name: 'Ključni pokazatelji' })
    await within(overview).findByText('Aktivni projekti')
    const cards = overview.querySelectorAll('[data-kpi-card]')
    expect(cards).toHaveLength(4)
    for (const card of cards) expect(card).toHaveClass('border-t-primary', 'motion-safe:hover:-translate-y-0.5')
  })
  it('renders independent real sections, exact money, safe trend and project map', async () => {
    setup()
    expect(await screen.findByRole('link', { name: 'Most' })).toBeInTheDocument()
    expect(screen.getAllByText('99,99').length).toBeGreaterThan(0)
    expect(screen.getByText('Ana Anić')).toBeInTheDocument()
    expect(screen.getByText(/Nema poređenja/)).toBeInTheDocument()
    expect(await screen.findByTestId('project-map')).toBeInTheDocument()
    expect(mocks.getSummary).toHaveBeenCalledTimes(1)
    expect(mocks.getActivity).toHaveBeenCalledTimes(1)
  })
  it('isolates a section error and retries without hiding successful sections', async () => {
    mocks.getPresence.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => response([]))
    setup()
    const section = await screen.findByRole('region', { name: 'Prisustvo' })
    expect(await within(section).findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Most' })).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await within(section).findByText('Nema nedavno pronađenih GPS lokacija.')).toBeInTheDocument()
  })
  it('shows permission-aware empty-company guidance and no stale false data', async () => {
    mocks.getSummary.mockImplementation(() => response({ activeProjects: 0, openTasks: 0, openTimers: 0, projectsWithBudget: 0, knownPlannedBudget: null, currentSpend: '0.00' }))
    mocks.getProjects.mockImplementation(() => response([]))
    useAuthStore.setState({ user: user({ permissions: ['projects.read', 'tasks.read', 'users.read', 'documents.read', 'payroll.read'] }) })
    setup()
    expect(await screen.findByText('Nema aktivnih projekata.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Kreiraj projekat' })).not.toBeInTheDocument()
  })
  it('never shows the previous company response after a switch', async () => {
    let resolveOld!: (value: unknown) => void
    mocks.getSummary.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve })).mockImplementation(() => response({ activeProjects: 8, openTasks: 0, openTimers: 0, projectsWithBudget: 0, knownPlannedBudget: null, currentSpend: '0.00' }))
    useAuthStore.setState({ user: user({ roles: ['PLATFORM_ADMIN'], companyId: null }) })
    useCompanyStore.setState({ selectedId: 'a', revision: 1 })
    setup()
    await act(async () => { useCompanyStore.setState({ selectedId: 'b', revision: 2 }) })
    await act(async () => { resolveOld({ data: { activeProjects: 999, openTasks: 0, openTimers: 0, projectsWithBudget: 0, knownPlannedBudget: null, currentSpend: '0.00' } }) })
    expect(await screen.findByText('8')).toBeInTheDocument()
    expect(screen.queryByText('999')).not.toBeInTheDocument()
  })
  it('shows loading, not empty or success, while sections are pending', () => {
    Object.values(mocks).forEach((mock) => mock.mockImplementation(() => new Promise(() => {})))
    setup()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(4)
    expect(within(screen.getByRole('region', { name: 'Ključni pokazatelji' })).getAllByRole('status')).toHaveLength(4)
    expect(screen.queryByText('Nema projekata za prikaz.')).not.toBeInTheDocument()
    expect(screen.queryByText('Nema trenutnih upozorenja.')).not.toBeInTheDocument()
  })
  it.each([
    ['getSummary', 'Ključni pokazatelji'], ['getCreatedTasks', 'Novi zadaci'],
    ['getClosedTimers', 'Odobreno vrijeme'], ['getProjects', 'Projekti i budžeti'],
    ['getActivity', 'Nedavna aktivnost'],
  ] as const)('independently reports and retries %s errors', async (api, sectionName) => {
    mocks[api].mockRejectedValueOnce(new Error('offline'))
    setup()
    const section = screen.getByRole('region', { name: sectionName })
    expect(await within(section).findByRole('alert')).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(mocks[api]).toHaveBeenCalledTimes(2)
  })
  it('ranks alerts by severity and does not claim all clear on partial failure', async () => {
    mocks.getDocumentAlerts.mockImplementation(() => response([{ id: 'd', kind: 'WORKER', type: 'medical', expiresAt: '2025-01-01T00:00:00.000Z', daysUntilExpiry: -1, severity: 'CRITICAL' }]))
    mocks.getTaskAlerts.mockImplementation(() => response([{ id: 't', projectId: 'p', title: 'Nadzor', status: 'OPEN', plannedEnd: '2025-01-02T00:00:00.000Z', severity: 'HIGH' }]))
    setup()
    const section = screen.getByRole('region', { name: 'Upozorenja' })
    const items = await within(section).findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Kritično')
    expect(items[1]).toHaveTextContent('Visoko')
  })
  it('keeps partial alerts visible if the other source fails', async () => {
    mocks.getDocumentAlerts.mockRejectedValueOnce(new Error('offline'))
    mocks.getTaskAlerts.mockImplementation(() => response([{ id: 't', projectId: 'p', title: 'Nadzor', status: 'OPEN', plannedEnd: '2025-01-02T00:00:00.000Z', severity: 'HIGH' }]))
    setup()
    const section = screen.getByRole('region', { name: 'Upozorenja' })
    expect(await within(section).findByRole('alert')).toHaveTextContent('Neka upozorenja nisu dostupna.')
    expect(await within(section).findByText('Zadatak: Nadzor')).toBeInTheDocument()
    expect(within(section).queryByText('Nema trenutnih upozorenja.')).not.toBeInTheDocument()
  })
  it('removes cached alerts immediately if the corresponding permission is revoked', async () => {
    mocks.getDocumentAlerts.mockImplementation(() => response([{ id: 'd', kind: 'WORKER', type: 'medical', expiresAt: '2025-01-01T00:00:00.000Z', daysUntilExpiry: -1, severity: 'CRITICAL' }]))
    setup()
    expect(await screen.findByText('Dokument radnika')).toBeInTheDocument()
    await act(async () => { useAuthStore.setState({ user: user({ permissions: ['projects.read', 'tasks.read', 'users.read', 'payroll.read'] }) }) })
    expect(screen.queryByText('Dokument radnika')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Upozorenja' })).getByText('Neka upozorenja nisu dostupna.')).toBeInTheDocument()
  })
  it('restores the previous document theme when leaving the dashboard', async () => {
    const view = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Tamni prikaz' }))
    expect(document.documentElement).toHaveClass('dark')
    view.unmount()
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem('gradix.dashboard.theme')).toBe('dark')
  })
  it('does not query without a selected platform tenant and toggles a real dark theme', async () => {
    useAuthStore.setState({ user: user({ roles: ['PLATFORM_ADMIN'], companyId: null }) })
    setup()
    expect(screen.getByText('Izaberite firmu da vidite pokazatelje.')).toBeInTheDocument()
    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Tamni prikaz' }))
    expect(document.documentElement).toHaveClass('dark')
  })
})
