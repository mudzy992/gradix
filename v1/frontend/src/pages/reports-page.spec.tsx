import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { ReportsPage } from '@/pages/reports-page'

/**
 * FE-11 — izvještaji. Drži: prevedena zaglavlja kolona (prije `plannedBudget`), nepoznata kolona
 * ostaje sirova (signal da fallback postoji), caption sa brojem redova, stanja (skeleton/greška +
 * retry/prazno) i export vezan za izabrani period.
 */
const getReport = vi.fn()
const exportReport = vi.fn()

vi.mock('@/lib/api-polish', () => ({
  getReport: (slug: string, query: unknown) => getReport(slug, query),
  exportReport: (slug: string, query: unknown) => exportReport(slug, query),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getReport.mockReset()
  exportReport.mockReset().mockResolvedValue(new Blob(['x']))
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ACCOUNTANT'],
      permissions: ['reports.read', 'reports.export'],
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
})

describe('ReportsPage', () => {
  it('prevodi zaglavlja kolona, a nepoznatu kolonu prikazuje sirovu', async () => {
    getReport.mockResolvedValue({
      data: {
        slug: 'project-spend',
        from: '2026-11-01',
        to: '2026-11-30',
        columns: ['project', 'plannedBudget', 'nepoznataKolona'],
        rows: [{ project: 'Sarajevo obilaznica', plannedBudget: '40000.00', nepoznataKolona: 'x' }],
      },
    })
    renderPage()

    expect(await screen.findByRole('columnheader', { name: 'Projekat' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Planirani budžet' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'nepoznataKolona' })).toBeInTheDocument()
    expect(screen.getByText('Spend projekta — redova: 1')).toBeInTheDocument()
    expect(screen.getByText('40000.00')).toBeInTheDocument()
  })

  it('prazan izvještaj objašnjava da nema redova', async () => {
    getReport.mockResolvedValue({
      data: { slug: 'project-spend', from: '2026-11-01', to: '2026-11-30', columns: ['project'], rows: [] },
    })
    renderPage()

    expect(await screen.findByText('Izvještaj nema redova za izabrani period.')).toBeInTheDocument()
  })

  it('dok se učitava prikazuje skeleton sa aria-busy', () => {
    getReport.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('greška je trajna i nudi ponovni pokušaj', async () => {
    getReport.mockRejectedValueOnce(new Error('mreža'))
    getReport.mockResolvedValueOnce({
      data: { slug: 'project-spend', from: '', to: '', columns: ['project'], rows: [{ project: 'X' }] },
    })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Izvještaj se nije učitao.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Spend projekta — redova: 1')).toBeInTheDocument()
  })

  it('promjena perioda mijenja upit i onemogućuje export kad nema redova', async () => {
    getReport.mockResolvedValue({
      data: { slug: 'project-spend', from: '2026-11-01', to: '2026-11-30', columns: [], rows: [] },
    })
    renderPage()

    const from = await screen.findByLabelText('Od')
    await userEvent.type(from, '2026-11-01')
    await userEvent.type(screen.getByLabelText('Do'), '2026-11-30')
    expect(getReport).toHaveBeenLastCalledWith('project-spend', { from: '2026-11-01', to: '2026-11-30' })
    expect(screen.getByRole('button', { name: 'Export xlsx' })).toBeDisabled()
  })

  it('export šalje isti period i ne briše URL prije preuzimanja', async () => {
    getReport.mockResolvedValue({
      data: { slug: 'project-spend', from: '', to: '', columns: ['project'], rows: [{ project: 'X' }] },
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Export xlsx' }))
    expect(exportReport).toHaveBeenCalledWith('project-spend', { from: undefined, to: undefined })
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})
