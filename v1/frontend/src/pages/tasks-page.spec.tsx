import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRow } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { TasksPage } from '@/pages/tasks-page'
import { TaskDetailPage } from '@/pages/task-detail-page'

/**
 * FE-08 — tabla zadataka i detalj zadatka. Prije je tabla imala **sirove statuse kao naslove
 * kolona** (`PENDING`, `IN_PROGRESS`), sirov prioritet na kartici, a detalj je za svaku grešku
 * zauvijek prikazivao „Učitavanje…“.
 */
const listTasks = vi.fn()
const getTask = vi.fn()
const getTimerMe = vi.fn()
const startTimer = vi.fn()
const pauseTimer = vi.fn()
const resumeTimer = vi.fn()
const stopTimer = vi.fn()
const completeTask = vi.fn()

vi.mock('@/lib/api-ops', () => ({
  listTasks: (query: unknown) => listTasks(query),
  getTask: (id: string) => getTask(id),
  getTimerMe: () => getTimerMe(),
  startTimer: (body: unknown) => startTimer(body),
  pauseTimer: () => pauseTimer(),
  resumeTimer: () => resumeTimer(),
  stopTimer: () => stopTimer(),
  completeTask: (id: string) => completeTask(id),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useParams: () => ({ id: 't1' }) }
})

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    projectId: 'p1',
    phaseId: null,
    title: 'Iskop kanala',
    description: null,
    status: 'ASSIGNED',
    priority: 'HIGH',
    totalTimeSpentMinutes: 95,
    plannedStart: null,
    plannedEnd: null,
    ...overrides,
  } as TaskRow
}

function renderWith(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function setUser(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ADMIN'],
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
  listTasks.mockReset()
  getTask.mockReset()
  getTimerMe.mockReset().mockResolvedValue({ data: { session: null, elapsedMinutes: 0 } })
  setUser(['tasks.read', 'tasks.timer'])
})

describe('TasksPage', () => {
  it('kolone su prevedene i nose broj zadataka', async () => {
    listTasks.mockResolvedValue({
      data: [task(), task({ id: 't2', title: 'Nasip', priority: 'URGENT', status: 'IN_PROGRESS' })],
    })
    renderWith(<TasksPage />)

    // Prvo sačekaj podatke (kolone postoje i dok se učitava, ali sa skeletonima).
    await screen.findByText('Iskop kanala')
    // Anchored: „Nedodijeljeno“ takođe sadrži „dodijeljeno“.
    const assigned = screen.getByRole('region', { name: /^Dodijeljeno/i })
    expect(within(assigned).getByText('Iskop kanala')).toBeInTheDocument()
    expect(within(assigned).getByText('Visok')).toBeInTheDocument()

    const inProgress = screen.getByRole('region', { name: /^U toku/i })
    expect(within(inProgress).getByText('Hitno')).toBeInTheDocument()

    expect(screen.getByText('Zadataka na tabli: 2')).toBeInTheDocument()
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument()
    expect(screen.queryByText('URGENT')).not.toBeInTheDocument()
  })

  it('prazna kolona kaže da je prazna, umjesto tišine', async () => {
    listTasks.mockResolvedValue({ data: [task()] })
    renderWith(<TasksPage />)

    await screen.findByText('Iskop kanala')
    const paused = screen.getByRole('region', { name: /^Pauza/i })
    expect(within(paused).getByText('Nema zadataka')).toBeInTheDocument()
  })

  it('greška nudi ponovni pokušaj', async () => {
    listTasks.mockRejectedValueOnce(new Error('mreža'))
    listTasks.mockResolvedValueOnce({ data: [task()] })
    renderWith(<TasksPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Zadaci se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Iskop kanala')).toBeInTheDocument()
  })
})

describe('TaskDetailPage', () => {
  it('prikazuje preveden status i prioritet te trajanje u satima', async () => {
    getTask.mockResolvedValue({ data: task({ status: 'IN_PROGRESS', priority: 'URGENT' }) })
    renderWith(<TaskDetailPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Iskop kanala' })).toBeInTheDocument()
    expect(screen.getByText('U toku')).toBeInTheDocument()
    expect(screen.getByText('Hitno')).toBeInTheDocument()
    expect(screen.getByText(/Proteklo: 1 h 35 min/)).toBeInTheDocument()
  })

  it('greška zamjenjuje skeleton i može se ponoviti', async () => {
    getTask.mockRejectedValueOnce(new Error('404'))
    getTask.mockResolvedValueOnce({ data: task() })
    renderWith(<TaskDetailPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Zadaci se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Iskop kanala' })).toBeInTheDocument()
  })

  it('bez prava `tasks.timer` nema dugmadi za timer', async () => {
    setUser(['tasks.read'])
    getTask.mockResolvedValue({ data: task() })
    renderWith(<TaskDetailPage />)

    await screen.findByRole('heading', { level: 1, name: 'Iskop kanala' })
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('sa pravom `tasks.timer` start zove API sa id-jem zadatka', async () => {
    startTimer.mockResolvedValue({ data: {} })
    getTask.mockResolvedValue({ data: task() })
    renderWith(<TaskDetailPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
    expect(startTimer.mock.calls[0][0]).toEqual({ taskId: 't1' })
  })

  it('timer koji je moj nudi pauzu i stop — svaki zove svoj API', async () => {
    pauseTimer.mockResolvedValue({ data: {} })
    stopTimer.mockResolvedValue({ data: {} })
    getTask.mockResolvedValue({ data: task({ status: 'IN_PROGRESS' }) })
    getTimerMe.mockResolvedValue({
      data: { session: { taskId: 't1', pausedAt: null }, elapsedMinutes: 12 },
    })
    renderWith(<TaskDetailPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Pauza' }))
    expect(pauseTimer).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stopTimer).toHaveBeenCalledTimes(1)
  })

  it('pauziran timer nudi nastavak', async () => {
    resumeTimer.mockResolvedValue({ data: {} })
    getTask.mockResolvedValue({ data: task({ status: 'PAUSED' }) })
    getTimerMe.mockResolvedValue({
      data: { session: { taskId: 't1', pausedAt: '2026-11-03T10:00:00.000Z' }, elapsedMinutes: 12 },
    })
    renderWith(<TaskDetailPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Nastavi' }))
    expect(resumeTimer).toHaveBeenCalledTimes(1)
  })

  it('završavanje zadatka šalje id zadatka', async () => {
    completeTask.mockResolvedValue({ data: {} })
    setUser(['tasks.read', 'tasks.write'])
    getTask.mockResolvedValue({ data: task({ status: 'IN_PROGRESS' }) })
    renderWith(<TaskDetailPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Završi' }))
    expect(completeTask.mock.calls[0][0]).toBe('t1')
  })
})
