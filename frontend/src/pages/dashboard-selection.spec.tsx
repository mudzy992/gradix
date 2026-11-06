import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { DashboardPage } from './dashboard-page'
const legacy = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-ops', () => ({ getDashboard: legacy }))
vi.mock('@/components/dashboard/admin-dashboard', () => ({ AdminDashboard: () => <div>Admin v2</div> }))
const base: MeUser = { id: 'u', firstName: 'A', lastName: 'B', employeeCode: null, email: 'a@example.test', roles: [], permissions: [], companyId: 'c', company: null, hourlyRate: null, mustChangePassword: false, locale: 'bs' }
function setup(role: MeUser['roles'][number]) {
  useAuthStore.setState({ user: { ...base, roles: [role] }, accessToken: 'token', ready: true })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { legacy.mockReset(); legacy.mockResolvedValue({ data: { cards: [], presence: null, expiring: [] } }) })
describe('dashboard role selection', () => {
  it.each(['ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN'] as const)('uses v2 for %s', (role) => {
    setup(role)
    expect(screen.getByText('Admin v2')).toBeInTheDocument()
    expect(legacy).not.toHaveBeenCalled()
  })
  it.each(['WORKER', 'ACCOUNTANT', 'SITE_SUPERVISOR'] as const)('keeps the legacy dashboard for %s', async (role) => {
    setup(role)
    expect(screen.queryByText('Admin v2')).not.toBeInTheDocument()
    expect(await screen.findByText('Nema dokumenata koji istječu.')).toBeInTheDocument()
    expect(legacy).toHaveBeenCalledOnce()
  })
})
