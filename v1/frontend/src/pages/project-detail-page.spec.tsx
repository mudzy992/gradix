import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectDetailPage } from './project-detail-page'

const api = vi.hoisted(() => ({ getProject: vi.fn(), listPhases: vi.fn(), listTasks: vi.fn(), permissions: new Set<string>() }))
vi.mock('@/lib/api-ops', () => ({ getProject: api.getProject, listPhases: api.listPhases, listTasks: api.listTasks }))
vi.mock('@/hooks/use-me', () => ({ useHasPermission: (permission: string) => api.permissions.has(permission) }))
vi.mock('@/components/ops/project-tabs', () => ({ ProjectTabs: ({ activeTab }: { activeTab: string }) => <span>active: {activeTab}</span> }))
vi.mock('@/components/ops/project-public-card', () => ({ ProjectPublicCard: () => null }))

function LocationSearch() {
  return <output aria-label="Query">{useLocation().search}</output>
}

function renderPage(path = '/projects/p1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/projects/:id" element={<><ProjectDetailPage /><LocationSearch /></>} />
  </Routes></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  api.permissions.clear()
  api.getProject.mockReset().mockResolvedValue({ data: { id: 'p1', name: 'Most', status: 'PLANNING', progressPercent: 0 } })
  api.listPhases.mockReset().mockResolvedValue({ data: [] })
  api.listTasks.mockReset().mockResolvedValue({ data: [] })
})

describe('ProjectDetailPage Gantt and tabs', () => {
  it('promjena kartice čuva ostale query parametre, uključujući ponovljene', async () => {
    renderPage('/projects/p1?filter=active&tag=a&tag=b&tab=overview')
    await screen.findByRole('heading', { name: 'Most' })
    await userEvent.click(screen.getByRole('tab', { name: 'Dokumenti' }))
    const query = new URLSearchParams(screen.getByLabelText('Query').textContent ?? '')
    expect(query.get('tab')).toBe('documents')
    expect(query.get('filter')).toBe('active')
    expect(query.getAll('tag')).toEqual(['a', 'b'])
  })

  it('prikazuje nulti budžet iz API ugovora kao string, a ne nedostajuću vrijednost', async () => {
    api.getProject.mockResolvedValue({ data: { id: 'p1', name: 'Most', status: 'PLANNING', progressPercent: 0, plannedBudget: '0', currentSpend: '0' } })
    renderPage()
    expect(await screen.findByText('0 / 0')).toBeInTheDocument()
  })

  it('ne učitava pregled na drugoj kartici', async () => {
    api.permissions.add('tasks.read')
    renderPage('/projects/p1?tab=documents')
    expect(await screen.findByText('active: documents')).toBeInTheDocument()
    expect(api.listPhases).not.toHaveBeenCalled()
    expect(api.listTasks).not.toHaveBeenCalled()
  })

  it('ne dozvoljava direktan izbor sakrivene kartice količina i ne učitava zadatke bez prava', async () => {
    renderPage('/projects/p1?tab=quantities')
    expect(await screen.findByText('active: overview')).toBeInTheDocument()
    expect(await screen.findByText('Zadaci nisu prikazani jer nemate pravo pregleda zadataka.')).toBeInTheDocument()
    await waitFor(() => expect(api.listPhases).toHaveBeenCalledOnce())
    expect(api.listTasks).not.toHaveBeenCalled()
  })

  it('Gantt jasno označava i učitava drugu stranicu zadataka', async () => {
    api.permissions.add('tasks.read')
    api.listTasks.mockImplementation(({ page }: { page: number }) => Promise.resolve({
      data: [{ id: `t${page}`, title: `Zadatak ${page}`, plannedStart: '2026-01-01', plannedEnd: '2026-01-02' }],
      meta: { page, limit: 100, total: 101 },
    }))
    renderPage()
    expect(await screen.findByText(/Zadatak 1:/)).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Stranice zadataka na Ganttu' })
    expect(nav).toHaveTextContent('Stranica 1 od 2')
    expect(screen.getByText('Gantt prikazuje sve faze i zadatke samo sa izabrane stranice.')).toBeInTheDocument()
    await userEvent.click(within(nav).getByRole('button', { name: 'Sljedeća' }))
    expect(await screen.findByText(/Zadatak 2:/)).toBeInTheDocument()
    expect(screen.queryByText(/Zadatak 1:/)).not.toBeInTheDocument()
    expect(api.listTasks).toHaveBeenLastCalledWith({ projectId: 'p1', page: 2, limit: 100 })
  })

  it('poslije greške druge stranice Gantta moguće je vratiti se', async () => {
    api.permissions.add('tasks.read')
    api.listTasks.mockImplementation(({ page }: { page: number }) => page === 1
      ? Promise.resolve({ data: [], meta: { page, limit: 100, total: 101 } })
      : Promise.reject(new Error('offline')))
    renderPage()
    const nav = await screen.findByRole('navigation', { name: 'Stranice zadataka na Ganttu' })
    await userEvent.click(within(nav).getByRole('button', { name: 'Sljedeća' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Podaci kartice se nisu učitali.')
    await userEvent.click(screen.getByRole('button', { name: 'Prethodna' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('ne prikazuje neuspjeli Gantt kao prazan i omogućava ponovni pokušaj', async () => {
    api.permissions.add('tasks.read')
    api.listPhases.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] })
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Podaci kartice se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    await waitFor(() => expect(api.listPhases).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
