import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRow } from '@/lib/ops-types'
import { Tabs } from '@/components/ui/tabs'
import { ProjectTabs } from './project-tabs'

const api = vi.hoisted(() => ({
  listPhases: vi.fn(), listAssignments: vi.fn(), listUsers: vi.fn(), listDocuments: vi.fn(),
  listMachines: vi.fn(), listTrips: vi.fn(), listTasks: vi.fn(), listFuel: vi.fn(),
  createPhase: vi.fn(), createAssignment: vi.fn(), removeAssignment: vi.fn(),
  createDocument: vi.fn(), uploadFile: vi.fn(), patchProjectStatus: vi.fn(), toastError: vi.fn(),
  permissions: new Set<string>(),
}))
vi.mock('@/lib/api-ops', () => ({
  listPhases: api.listPhases, listAssignments: api.listAssignments, listDocuments: api.listDocuments,
  listTasks: api.listTasks, createPhase: api.createPhase, createAssignment: api.createAssignment,
  removeAssignment: api.removeAssignment, createDocument: api.createDocument, patchProjectStatus: api.patchProjectStatus,
}))
vi.mock('@/lib/api-fleet', () => ({ listMachines: api.listMachines, listTrips: api.listTrips, listFuel: api.listFuel }))
vi.mock('@/lib/api', () => ({ listUsers: api.listUsers, uploadFile: api.uploadFile }))
vi.mock('@/hooks/use-me', () => ({ useHasPermission: (permission: string) => api.permissions.has(permission) }))
vi.mock('@/components/ops/quantities-tab', () => ({ QuantitiesTab: () => null }))
vi.mock('@/components/ops/project-diary-tab', () => ({ ProjectDiaryTab: () => null }))
vi.mock('sonner', () => ({ toast: { error: api.toastError } }))

const project = { id: 'p1', name: 'Most', status: 'PLANNING' } as ProjectRow
function renderTab(tab: string, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  const view = (current: string) => (
    <QueryClientProvider client={client}><MemoryRouter><Tabs value={current}>
      <ProjectTabs projectId="p1" project={project} activeTab={current} />
    </Tabs></MemoryRouter></QueryClientProvider>
  )
  const rendered = render(view(tab))
  return { client, changeTab: (next: string) => rendered.rerender(view(next)) }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.permissions.clear()
  for (const fn of [api.listPhases, api.listAssignments, api.listUsers, api.listDocuments, api.listMachines, api.listTrips, api.listTasks, api.listFuel]) {
    fn.mockReset().mockResolvedValue({ data: [] })
  }
})

describe('ProjectTabs', () => {
  it('učitava samo aktivnu karticu i ne traži korisnike bez prava', async () => {
    api.permissions.add('projects.write')
    const { changeTab } = renderTab('phases')
    await waitFor(() => expect(api.listPhases).toHaveBeenCalledOnce())
    expect(api.listAssignments).not.toHaveBeenCalled()
    expect(api.listUsers).not.toHaveBeenCalled()
    expect(api.listFuel).not.toHaveBeenCalled()
    changeTab('team')
    await waitFor(() => expect(api.listAssignments).toHaveBeenCalledOnce())
    expect(api.listUsers).not.toHaveBeenCalled()
    expect(screen.getByText('Za dodavanje člana potrebno je pravo pregleda korisnika.')).toBeInTheDocument()
  })

  it('greška liste nije prazno stanje i ponovni pokušaj osvježava karticu', async () => {
    api.listDocuments.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] })
    renderTab('documents')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Podaci kartice se nisu učitali.')
    expect(screen.queryByText('Nema podataka.')).not.toBeInTheDocument()
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Nema podataka.')).toBeInTheDocument()
    expect(api.listDocuments).toHaveBeenCalledTimes(2)
  })

  it('ne prikazuje keširane podatke nakon gubitka prava', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['machines', { projectId: 'p1' }], [{ id: 'm1', name: 'Tajna', status: 'ACTIVE' }])
    renderTab('machines', client)
    expect(screen.getByText('Nemate pravo pristupa ovim podacima.')).toBeInTheDocument()
    expect(screen.queryByText(/Tajna/)).not.toBeInTheDocument()
    expect(api.listMachines).not.toHaveBeenCalled()
  })

  it('uklanjanje člana prikazuje grešku bez neobrađenog odbijanja', async () => {
    api.permissions.add('projects.write')
    api.listAssignments.mockResolvedValue({ data: [{ id: 'a1', userId: 'u1', user: { firstName: 'Ana', lastName: 'Anić' }, role: 'WORKER' }] })
    api.removeAssignment.mockReset().mockRejectedValue(new Error('offline'))
    renderTab('team')
    const button = await screen.findByRole('button', { name: 'Ukloni člana Ana Anić' })
    expect(screen.getByText('Ana Anić · Radnik')).toBeInTheDocument()
    await userEvent.click(button)
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith('offline'))
    expect(api.removeAssignment).toHaveBeenCalledWith('p1', 'u1')
    expect(screen.getByText('Ana Anić · Radnik')).toBeInTheDocument()
  })

  it('prikazuje preveden status zadatka i učitava samo zadatke', async () => {
    api.permissions.add('tasks.read')
    api.listTasks.mockResolvedValue({ data: [{ id: 't1', title: 'Iskop', status: 'IN_PROGRESS' }] })
    renderTab('tasks')
    expect(await screen.findByText('Iskop · U toku')).toBeInTheDocument()
    expect(api.listPhases).not.toHaveBeenCalled()
    expect(api.listTasks).toHaveBeenCalledOnce()
  })

  it('greška učitavanja korisnika onemogućava izbor i omogućava ponovni pokušaj', async () => {
    api.permissions.add('projects.write')
    api.permissions.add('users.read')
    api.listUsers.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [{ id: 'u1', firstName: 'Ana', lastName: 'Anić' }] })
    renderTab('team')
    const alert = await screen.findByRole('alert')
    expect(screen.getByRole('combobox', { name: 'Dodaj' })).toBeDisabled()
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByRole('option', { name: 'Ana Anić' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Dodaj' })).toBeEnabled()
  })

  it('status koristi prevedene oznake i blokiran je do kraja izmjene', async () => {
    api.permissions.add('projects.write')
    let resolve!: () => void
    api.patchProjectStatus.mockReset().mockReturnValue(new Promise<void>((done) => { resolve = done }))
    renderTab('costs')
    const button = screen.getByRole('button', { name: 'U toku' })
    await userEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(api.patchProjectStatus).toHaveBeenCalledWith('p1', 'IN_PROGRESS')
    resolve()
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('upload dokumenta je blokiran dok traje i isti fajl se može ponovo izabrati nakon greške', async () => {
    api.permissions.add('projects.write')
    let reject!: (error: Error) => void
    api.uploadFile.mockReset().mockReturnValueOnce(new Promise((_, fail) => { reject = fail })).mockResolvedValueOnce({ data: { path: 'p/f' } })
    api.createDocument.mockReset().mockResolvedValue({})
    renderTab('documents')
    const input = screen.getByLabelText('Dodaj dokument')
    const file = new File(['dokument'], 'plan.pdf', { type: 'application/pdf' })
    await userEvent.upload(input, file)
    await waitFor(() => expect(input).toBeDisabled())
    reject(new Error('offline'))
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith('offline'))
    await waitFor(() => expect(input).toBeEnabled())
    await userEvent.upload(input, file)
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledWith('p1', { path: 'p/f', fileName: 'plan.pdf' }))
  })
})
