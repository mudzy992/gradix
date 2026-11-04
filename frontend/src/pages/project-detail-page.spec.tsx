import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectDetailPage } from './project-detail-page'

const api = vi.hoisted(() => ({ getProject: vi.fn(), listPhases: vi.fn(), listTasks: vi.fn(), permissions: new Set<string>() }))
vi.mock('@/lib/api-ops', () => ({ getProject: api.getProject, listPhases: api.listPhases, listTasks: api.listTasks }))
vi.mock('@/hooks/use-me', () => ({ useHasPermission: (permission: string) => api.permissions.has(permission) }))
vi.mock('@/components/ops/project-tabs', () => ({ ProjectTabs: ({ activeTab }: { activeTab: string }) => <span>active: {activeTab}</span> }))
vi.mock('@/components/ops/project-public-card', () => ({ ProjectPublicCard: () => null }))

function renderPage(path = '/projects/p1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/projects/:id" element={<ProjectDetailPage />} />
  </Routes></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  api.permissions.clear()
  api.getProject.mockReset().mockResolvedValue({ data: { id: 'p1', name: 'Most', status: 'PLANNING', progressPercent: 0 } })
  api.listPhases.mockReset().mockResolvedValue({ data: [] })
  api.listTasks.mockReset().mockResolvedValue({ data: [] })
})

describe('ProjectDetailPage Gantt and tabs', () => {
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
