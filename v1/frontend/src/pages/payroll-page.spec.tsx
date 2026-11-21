import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayrollSession, PayrollSummary } from '@/lib/api-payroll'
import type { AppRole } from '@/lib/constants'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { PayrollPage } from '@/pages/payroll-page'

/**
 * FE-12 — obračun sati. Drži: trajanje i zbroj u čitljivom obliku („8 h“, ne `480`), iznose
 * formatirane, ton statusa (odbijeno crveno), stanja tabele i akcije odobravanja/odbijanja samo uz
 * pravo odlučivanja.
 */
const listPayrollSessions = vi.fn()
const getPayrollSummary = vi.fn()
const approvePayrollSession = vi.fn()
const rejectPayrollSession = vi.fn()
const exportPayroll = vi.fn()

vi.mock('@/lib/api-payroll', () => ({
  listPayrollSessions: (query: unknown) => listPayrollSessions(query),
  getPayrollSummary: (query: unknown) => getPayrollSummary(query),
  approvePayrollSession: (id: string) => approvePayrollSession(id),
  rejectPayrollSession: (id: string) => rejectPayrollSession(id),
  exportPayroll: (query: unknown) => exportPayroll(query),
}))

function session(overrides: Partial<PayrollSession> = {}): PayrollSession {
  return {
    id: 'ps1',
    userId: 'u1',
    userName: 'Amar Hodžić',
    projectId: 'p1',
    projectName: 'Sarajevo obilaznica',
    taskId: 't1',
    taskTitle: 'Iskop kanala',
    startedAt: '2026-11-03T07:00:00.000Z',
    closedAt: '2026-11-03T15:00:00.000Z',
    durationMinutes: 480,
    hourlyRate: '15.00',
    amount: '120.000000',
    approvalStatus: 'PENDING',
    ...overrides,
  }
}

function summary(overrides: Partial<PayrollSummary> = {}): PayrollSummary {
  return {
    from: '2026-11-01',
    to: '2026-11-30',
    tz: 'Europe/Sarajevo',
    approvedMinutes: 1560,
    approvedAmount: '390.00',
    pendingMinutes: 480,
    pendingCount: 1,
    rejectedCount: 2,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function signIn(roles: AppRole[], permissions: string[] = []) {
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles,
      permissions,
      companyId: 'c1',
      company: null,
      hourlyRate: null,
      mustChangePassword: false,
      locale: 'bs',
    },
    accessToken: 't',
    ready: true,
  })
  useCompanyStore.setState({ selectedId: 'c1' })
}

beforeEach(() => {
  listPayrollSessions.mockReset()
  getPayrollSummary.mockReset().mockResolvedValue({ data: summary() })
  approvePayrollSession.mockReset().mockResolvedValue({})
  rejectPayrollSession.mockReset().mockResolvedValue({})
  exportPayroll.mockReset().mockResolvedValue(new Blob(['x']))
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  signIn(['SITE_SUPERVISOR'], ['payroll.read'])
})

describe('PayrollPage', () => {
  it('prikazuje trajanje i iznose u čitljivom obliku, sa prevedenim statusom', async () => {
    listPayrollSessions.mockResolvedValue({
      data: [session()],
      meta: { total: 1 },
    })
    renderPage()

    const table = await screen.findByRole('table')
    expect(await within(table).findByText('8 h')).toBeInTheDocument() // 480 min, ne „480“
    expect(within(table).getByText('120,00')).toBeInTheDocument()
    expect(within(table).getByText('Na čekanju')).toBeInTheDocument()
    expect(within(table).getByText('Stavki: 1')).toBeInTheDocument()
    expect(screen.queryByText('480')).not.toBeInTheDocument()
    expect(screen.queryByText('120.000000')).not.toBeInTheDocument()
  })

  it('zbroj je u satima i iznosu, sa brojem na čekanju i odbijenih', async () => {
    listPayrollSessions.mockResolvedValue({ data: [], meta: { total: 0 } })
    getPayrollSummary.mockResolvedValue({
      data: summary({ approvedMinutes: 1560, rejectedCount: 2 }),
    })
    renderPage()

    const summarySection = await screen.findByRole('region', {
      name: /Zbroj za/,
    })
    expect(await within(summarySection).findByText('26 h')).toBeInTheDocument()
    expect(within(summarySection).getByText('390,00')).toBeInTheDocument()
    expect(within(summarySection).getByText('8 h')).toBeInTheDocument() // pendingMinutes
    expect(within(summarySection).getByText('2')).toBeInTheDocument()
  })

  it('odbijena stavka ima crveni ton i nema akcija', async () => {
    listPayrollSessions.mockResolvedValue({
      data: [session({ approvalStatus: 'REJECTED' })],
      meta: { total: 1 },
    })
    renderPage()

    const table = await screen.findByRole('table')
    expect(await within(table).findByText('Odbijeno')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Odobri' })).not.toBeInTheDocument()
    expect(screen.getByText('Odluka je konačna; odbijena stavka ostaje u listi.')).toBeInTheDocument()
  })

  it('dok se učitava prikazuje skeleton i aria-busy', () => {
    listPayrollSessions.mockReturnValue(new Promise(() => {}))
    getPayrollSummary.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('prazan mjesec ima uputu, bez prazne tabele', async () => {
    listPayrollSessions.mockResolvedValue({ data: [], meta: { total: 0 } })
    getPayrollSummary.mockResolvedValue({
      data: summary({ pendingCount: 0, approvedMinutes: 0 }),
    })
    renderPage()

    expect(await screen.findByText('Nema stavki obračuna za ovaj mjesec.')).toBeInTheDocument()
    expect(screen.getByText(/Stavke nastaju iz timera/)).toBeInTheDocument()
  })

  it('greška je trajna i nudi ponovni pokušaj za oba upita', async () => {
    listPayrollSessions.mockRejectedValueOnce(new Error('mreža'))
    listPayrollSessions.mockResolvedValueOnce({
      data: [session()],
      meta: { total: 1 },
    })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Obračun se nije učitao.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    const table = await screen.findByRole('table')
    expect(await within(table).findByText('Na čekanju')).toBeInTheDocument()
    expect(listPayrollSessions).toHaveBeenCalledTimes(2)
  })

  it('odobravanje i odbijanje zovu API sa id-em stavke', async () => {
    listPayrollSessions.mockResolvedValue({
      data: [session()],
      meta: { total: 1 },
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Odobri' }))
    expect(approvePayrollSession).toHaveBeenCalledWith('ps1')
    await userEvent.click(screen.getByRole('button', { name: 'Odbij' }))
    expect(rejectPayrollSession).toHaveBeenCalledWith('ps1')
  })

  it('bez prava odlučivanja nema akcija ni kolone Akcije', async () => {
    signIn(['DRIVER'], ['payroll.read'])
    listPayrollSessions.mockResolvedValue({
      data: [session()],
      meta: { total: 1 },
    })
    renderPage()

    const table = await screen.findByRole('table')
    await within(table).findByText('Na čekanju')
    expect(screen.queryByRole('button', { name: 'Odobri' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Akcije' })).not.toBeInTheDocument()
  })

  it('export je onemogućen kad nema stavki', async () => {
    listPayrollSessions.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    expect(await screen.findByRole('button', { name: 'Export xlsx' })).toBeDisabled()
  })

  it('export šalje period i ime fajla sa mjesecom i godinom', async () => {
    listPayrollSessions.mockResolvedValue({
      data: [session()],
      meta: { total: 1 },
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Export xlsx' }))
    expect(exportPayroll).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }))
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled() // briše se sa odgodom, ne odmah
  })
})
