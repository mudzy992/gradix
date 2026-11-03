import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRow } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { ProjectsPage } from '@/pages/projects-page'

/**
 * FE-08 — lista projekata. Drži ono što je prije falilo: preveden status (prije je pisalo
 * `IN_PROGRESS`), stanja (skeleton, greška + ponovni pokušaj, prazno/bez rezultata) i paginaciju
 * koja se ne prikazuje kad je sve na jednoj strani.
 */
const listProjects = vi.fn()

vi.mock('@/lib/api-ops', () => ({
  listProjects: (query: unknown) => listProjects(query),
}))

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p1',
    code: 'DEMO-1',
    name: 'Sarajevo obilaznica',
    status: 'IN_PROGRESS',
    locality: 'Sarajevo',
    lat: null,
    lng: null,
    geofenceRadius: 200,
    progressPercent: 42,
    plannedBudget: '40000.00',
    currentSpend: '12500.00',
    client: null,
    plannedStart: null,
    plannedEnd: null,
    archivedAt: null,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listProjects.mockReset()
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ADMIN'],
      permissions: ['projects.read'],
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

describe('ProjectsPage', () => {
  it('prikazuje preveden status i napredak, uz ukupan broj u opisu tabele', async () => {
    listProjects.mockResolvedValue({ data: [project()], meta: { total: 1 } })
    renderPage()

    expect(await screen.findByRole('link', { name: 'Sarajevo obilaznica' })).toHaveAttribute(
      'href',
      '/projects/p1',
    )
    expect(screen.getByText('U toku')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('Ukupno projekata: 1')).toBeInTheDocument()
    // Sirov enum se ne smije pojaviti nigdje na ekranu.
    expect(screen.queryByText('IN_PROGRESS')).not.toBeInTheDocument()
  })

  it('dok se učitava prikazuje skeleton sa aria-busy, ne praznu tabelu', () => {
    listProjects.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Projekti').closest('div')).toBeTruthy()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('prazna pretraga i prazna lista imaju različite poruke', async () => {
    listProjects.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    expect(await screen.findByText(/Još nema projekata/)).toBeInTheDocument()

    listProjects.mockResolvedValue({ data: [], meta: { total: 0 } })
    await userEvent.type(screen.getByLabelText('Pretraga projekata'), 'obilaznica')
    expect(await screen.findByText('Nema rezultata za „obilaznica“.')).toBeInTheDocument()
  })

  it('greška je trajna i dugme ponovo pita API', async () => {
    listProjects.mockRejectedValueOnce(new Error('mreža'))
    listProjects.mockResolvedValueOnce({ data: [project()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Projekti se nisu učitali.')

    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByRole('link', { name: 'Sarajevo obilaznica' })).toBeInTheDocument()
    expect(listProjects).toHaveBeenCalledTimes(2)
  })

  it('paginacija se prikazuje samo kad ima više strana', async () => {
    listProjects.mockResolvedValue({ data: [project()], meta: { total: 25 } })
    renderPage()

    const nav = await screen.findByRole('navigation', { name: 'Stranice' })
    expect(within(nav).getByText('Stranica 1 od 2')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Nazad' })).toBeDisabled()

    await userEvent.click(within(nav).getByRole('button', { name: 'Dalje' }))
    expect(await screen.findByText('Stranica 2 od 2')).toBeInTheDocument()
    expect(listProjects.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2, limit: 20 })
  })

  it('kad sve stane na jednu stranu, nema navigacije stranicama', async () => {
    listProjects.mockResolvedValue({ data: [project()], meta: { total: 3 } })
    renderPage()

    await screen.findByRole('link', { name: 'Sarajevo obilaznica' })
    expect(screen.queryByRole('navigation', { name: 'Stranice' })).not.toBeInTheDocument()
  })
})
