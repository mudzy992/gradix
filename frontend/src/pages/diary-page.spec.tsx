import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryRow, ProjectRow } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { DiaryPage } from '@/pages/diary-page'

/**
 * FE-10 — mjesečni dnevnik. Drži: označen mjesec, opciju „Svi projekti“ (filter se prije nije mogao
 * poništiti), dane kao ćelije sa **punim imenom** (prije su bili dugmad koja ništa ne rade i zvala su
 * se „01“), stanja liste i listu unosa mjeseca.
 */
const listDiary = vi.fn()
const listProjects = vi.fn()

vi.mock('@/lib/api-ops', () => ({
  listDiary: (query: unknown) => listDiary(query),
  listProjects: (query: unknown) => listProjects(query),
}))

vi.mock('@/components/ops/project-diary-tab', () => ({
  ProjectDiaryTab: ({ projectId }: { projectId: string }) => <div data-testid="diary-tab">{projectId}</div>,
}))

function entry(overrides: Partial<DiaryRow> = {}): DiaryRow {
  return {
    id: 'e1',
    projectId: 'p1',
    date: '2026-11-03',
    weather: null,
    tempMin: null,
    tempMax: null,
    workDescription: 'Iskop kanala',
    problemsNoted: null,
    workersCount: 4,
    updatedAt: '2026-11-03T18:00:00.000Z',
    photos: [],
    ...overrides,
  }
}

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

function renderPage(initial = '/diary') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <DiaryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listDiary.mockReset().mockResolvedValue({ data: [], meta: { total: 0 } })
  listProjects.mockReset().mockResolvedValue({ data: [project()], meta: { total: 1 } })
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['SITE_SUPERVISOR'],
      permissions: ['diary.read', 'diary.write'],
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

describe('DiaryPage', () => {
  it('polje mjeseca ima labelu, a izbor projekta opciju „Svi projekti“', async () => {
    renderPage()
    expect(await screen.findByLabelText('Mjesec')).toHaveValue(new Date().toISOString().slice(0, 7))

    const select = screen.getByLabelText('Projekti')
    await userEvent.click(select)
    expect(await screen.findByRole('option', { name: 'Svi projekti' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Sarajevo obilaznica' })).toBeInTheDocument()
  })

  it('dan sa unosom ima puno ime i vidi se u listi unosa', async () => {
    listDiary.mockResolvedValue({ data: [entry()], meta: { total: 1 } })
    renderPage()

    expect(await screen.findByLabelText('2026-11-03 — ima unos')).toBeInTheDocument()
    expect(screen.getByText('Unosa: 1')).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'Unosi u mjesecu' })
    expect(section).toHaveTextContent('2026-11-03 · Iskop kanala')
  })

  it('dan bez unosa ima ime koje to kaže (prije je pisalo samo „03“)', async () => {
    renderPage()
    // Svi dani mjeseca bez unosa nose puno ime (mjesec, dan i ishod), ne samo „03“.
    expect((await screen.findAllByLabelText(/2026-11-\d\d — nema unosa/)).length).toBeGreaterThanOrEqual(28)
  })

  it('prazan mjesec ima uputu', async () => {
    renderPage()
    expect(await screen.findByText('Nema unosa za ovaj mjesec.')).toBeInTheDocument()
    expect(screen.getByText(/Unos se dodaje u detalju projekta/)).toBeInTheDocument()
  })

  it('greška je trajna i nudi ponovni pokušaj', async () => {
    listDiary.mockRejectedValueOnce(new Error('mreža'))
    listDiary.mockResolvedValueOnce({ data: [entry()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Dnevnik se nije učitao.')
    await userEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByLabelText('2026-11-03 — ima unos')).toBeInTheDocument()
  })

  it('izabrani projekat otvara tab dnevnika i link na projekat', async () => {
    renderPage('/diary?projectId=p1')
    expect(await screen.findByTestId('diary-tab')).toHaveTextContent('p1')
    expect(screen.getByRole('link', { name: 'Otvori projekat' })).toHaveAttribute('href', '/projects/p1')
    expect(await screen.findByRole('heading', { name: 'Sarajevo obilaznica' })).toBeInTheDocument()
  })

  it('promjena mjeseca mijenja opseg upita (od 1. do zadnjeg dana)', async () => {
    renderPage()
    const month = await screen.findByLabelText('Mjesec')
    await userEvent.clear(month)
    await userEvent.type(month, '2026-02')
    expect(listDiary).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-02-01', to: '2026-02-28', limit: 100 }),
    )
  })
})
