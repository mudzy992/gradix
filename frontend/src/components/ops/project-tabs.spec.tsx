import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRow } from '@/lib/ops-types'
import type { MeUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { clearRefreshToken, writeRefreshToken } from '@/lib/storage'
import { useCompanyStore } from '@/stores/company-store'
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
  let currentTab = tab
  let currentProject = 'p1'
  const view = () => (
    <QueryClientProvider client={client}><MemoryRouter><Tabs value={currentTab}>
      <ProjectTabs projectId={currentProject} project={{ ...project, id: currentProject }} activeTab={currentTab} />
    </Tabs></MemoryRouter></QueryClientProvider>
  )
  const rendered = render(view())
  return {
    client,
    container: rendered.container,
    unmount: rendered.unmount,
    changeTab: (next: string) => { currentTab = next; rendered.rerender(view()) },
    changeProject: (next: string) => { currentProject = next; rendered.rerender(view()) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.permissions.clear()
  useAuthStore.setState({ user: null })
  useCompanyStore.setState({ selectedId: null })
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
    client.setQueryData(['machines', 'project-pages', { projectId: 'p1', page: 1, limit: 100 }], { data: [{ id: 'm1', name: 'Tajna', status: 'ACTIVE' }] })
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
    api.listUsers.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [{ id: 'u1', firstName: 'Ana', lastName: 'Anić', isActive: true }] })
    renderTab('team')
    const alert = await screen.findByRole('alert')
    expect(screen.getByRole('combobox', { name: 'Dodaj' })).toBeDisabled()
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByRole('option', { name: 'Ana Anić' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Dodaj' })).toBeEnabled()
  })

  it('filtrira neaktivne i dodijeljene te šalje odabranu projektnu ulogu', async () => {
    api.permissions.add('projects.write')
    api.permissions.add('users.read')
    api.listAssignments.mockResolvedValue({ data: [{ id: 'a1', userId: 'u1', role: 'PM' }] })
    api.listUsers.mockResolvedValue({ data: [
      { id: 'u1', firstName: 'Već', lastName: 'Dodijeljen', isActive: true },
      { id: 'u2', firstName: 'Neaktivan', lastName: 'Korisnik', isActive: false },
      { id: 'u3', firstName: 'Ana', lastName: 'Anić', isActive: true },
    ] })
    api.createAssignment.mockReset().mockResolvedValue({})
    renderTab('team')
    expect(await screen.findByRole('option', { name: 'Ana Anić' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Već Dodijeljen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Neaktivan Korisnik' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Dodaj' }), 'u3')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Uloga na projektu' }), 'SS')
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))
    await waitFor(() => expect(api.createAssignment).toHaveBeenCalledWith('p1', { userId: 'u3', role: 'SS' }))
  })

  it('nudi pretragu i narednu stranicu korisnika iz API metapodataka', async () => {
    api.permissions.add('projects.write')
    api.permissions.add('users.read')
    api.listUsers.mockImplementation(({ page, q }: { page: number; q?: string }) => Promise.resolve({
      data: [{ id: `u${page}`, firstName: q || `Korisnik${page}`, lastName: 'Ime', isActive: true }],
      meta: { page, limit: 100, total: 150 },
    }))
    renderTab('team')
    expect(await screen.findByRole('option', { name: 'Korisnik1 Ime' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sljedeća' }))
    expect(await screen.findByRole('option', { name: 'Korisnik2 Ime' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Pretraži korisnike'), 'Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Traži' }))
    expect(await screen.findByRole('option', { name: 'Ana Ime' })).toBeInTheDocument()
    expect(api.listUsers).toHaveBeenLastCalledWith({ page: 1, q: 'Ana', limit: 100 })
  })

  it.each([
    ['tasks', 'tasks.read', 'listTasks', 'Stranice zadataka'],
    ['machines', 'fleet.read', 'listMachines', 'Stranice vozila'],
    ['trips', 'trips.read', 'listTrips', 'Stranice tura'],
    ['costs', 'fuel.reports', 'listFuel', 'Stranice goriva'],
  ] as const)('kartica %s učitava drugu stranicu', async (tab, permission, method, label) => {
    api.permissions.add(permission)
    api[method].mockImplementation(({ page }: { page: number }) => Promise.resolve({ data: [], meta: { page, limit: 20, total: 25 } }))
    renderTab(tab)
    const navigation = await screen.findByRole('navigation', { name: label })
    expect(navigation).toHaveTextContent('Stranica 1 od 2')
    await userEvent.click(within(navigation).getByRole('button', { name: 'Sljedeća' }))
    await waitFor(() => expect(api[method]).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p1', page: 2 })))
    expect(await screen.findByText('Stranica 2 od 2')).toBeInTheDocument()
  })

  it('poslije neuspjele stranice korisnika moguć je povratak bez metapodataka', async () => {
    api.permissions.add('projects.write')
    api.permissions.add('users.read')
    api.listUsers.mockImplementation(({ page }: { page: number }) => page === 1
      ? Promise.resolve({ data: [], meta: { page, limit: 100, total: 101 } })
      : Promise.reject(new Error('offline')))
    renderTab('team')
    const nav = await screen.findByRole('navigation', { name: 'Stranice korisnika' })
    await userEvent.click(within(nav).getByRole('button', { name: 'Sljedeća' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Korisnici se nisu učitali.')
    expect(screen.getByRole('navigation', { name: 'Stranice korisnika' })).toHaveTextContent('Stranica 2')
    await userEvent.click(screen.getByRole('button', { name: 'Prethodna' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('poslije greške druge stranice zadataka moguć je povratak', async () => {
    api.permissions.add('tasks.read')
    api.listTasks.mockImplementation(({ page }: { page: number }) => page === 1
      ? Promise.resolve({ data: [{ id: 't1', title: 'Prvi', status: 'PENDING' }], meta: { page, limit: 100, total: 101 } })
      : Promise.reject(new Error('offline')))
    renderTab('tasks')
    const nav = await screen.findByRole('navigation', { name: 'Stranice zadataka' })
    await userEvent.click(within(nav).getByRole('button', { name: 'Sljedeća' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Prethodna' }))
    expect(await screen.findByText('Prvi · Nedodijeljeno')).toBeInTheDocument()
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

  it('nakon neuspjelog povezivanja ponavlja povezivanje bez ponovnog uploada', async () => {
    api.permissions.add('projects.write')
    api.uploadFile.mockReset().mockResolvedValue({ data: { path: 'c1/plan.pdf' } })
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    renderTab('documents')
    const file = new File(['dokument'], 'plan.pdf', { type: 'application/pdf' })
    const input = screen.getByLabelText('Dodaj dokument')
    await userEvent.upload(input, file)
    expect(await screen.findByText(/Fajl „plan.pdf“ je učitan/)).toBeInTheDocument()
    expect(input).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Ponovi povezivanje' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledTimes(2))
    const firstBody = api.createDocument.mock.calls[0][1]
    expect(firstBody).toEqual({ path: 'c1/plan.pdf', fileName: 'plan.pdf', idempotencyKey: expect.any(String) })
    expect(api.createDocument).toHaveBeenLastCalledWith('p1', firstBody)
    await waitFor(() => expect(input).toBeEnabled())
    expect(api.uploadFile).toHaveBeenCalledOnce()
  })

  it('prije ponavljanja prepoznaje već povezani dokument nakon izgubljenog odgovora', async () => {
    api.permissions.add('projects.write')
    api.uploadFile.mockReset().mockResolvedValue({ data: { path: 'c1/plan.pdf' } })
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline'))
    api.listDocuments.mockResolvedValueOnce({ data: [] }).mockResolvedValue({ data: [{ id: 'd1', path: 'c1/plan.pdf', fileName: 'plan.pdf' }] })
    renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    expect(await screen.findByRole('button', { name: 'Ponovi povezivanje' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ponovi povezivanje' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument())
    expect(api.createDocument).toHaveBeenCalledOnce()
    expect(api.uploadFile).toHaveBeenCalledOnce()
  })

  it('ako provjera povezivanja ne uspije zadržava referencu i ne šalje novi upis', async () => {
    api.permissions.add('projects.write')
    api.uploadFile.mockReset().mockResolvedValue({ data: { path: 'c1/plan.pdf' } })
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline'))
    api.listDocuments.mockResolvedValueOnce({ data: [] }).mockRejectedValue(new Error('offline again'))
    renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    const retry = await screen.findByRole('button', { name: 'Ponovi povezivanje' })
    await userEvent.click(retry)
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith('offline again'))
    expect(retry).toBeEnabled()
    expect(api.createDocument).toHaveBeenCalledOnce()
    expect(api.uploadFile).toHaveBeenCalledOnce()
  })

  it('zadržava zakašnjeli neuspjeli upload uz izvorni projekat nakon navigacije', async () => {
    api.permissions.add('projects.write')
    let resolveUpload!: (value: { data: { path: string } }) => void
    api.uploadFile.mockReset().mockReturnValue(new Promise((resolve) => { resolveUpload = resolve }))
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    const { changeProject } = renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    changeProject('p2')
    resolveUpload({ data: { path: 'c1/plan.pdf' } })
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith('offline'))
    expect(api.createDocument.mock.calls[0][0]).toBe('p1')
    expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Dodaj dokument')).toBeEnabled()
    changeProject('p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Ponovi povezivanje' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledTimes(2))
    expect(api.createDocument.mock.calls[1][0]).toBe('p1')
    expect(api.createDocument.mock.calls[1][1]).toEqual(api.createDocument.mock.calls[0][1])
    expect(api.uploadFile).toHaveBeenCalledOnce()
  })

  it('stari uspjeh ne briše referencu drugog projekta niti osvježava pogrešan projekat', async () => {
    api.permissions.add('projects.write')
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/a.pdf' } }).mockResolvedValueOnce({ data: { path: 'c1/b.pdf' } })
    let resolveLink!: (value: object) => void
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline a')).mockRejectedValueOnce(new Error('offline b'))
      .mockReturnValueOnce(new Promise((resolve) => { resolveLink = resolve }))
    const { changeProject, client } = renderTab('documents')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['a'], 'a.pdf', { type: 'application/pdf' }))
    await screen.findByRole('button', { name: 'Ponovi povezivanje' })
    changeProject('p2')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['b'], 'b.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText(/Fajl „b.pdf“ je učitan/)).toBeInTheDocument()
    changeProject('p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Ponovi povezivanje' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledTimes(3))
    changeProject('p2')
    resolveLink({})
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['documents', 'p1'] }))
    expect(screen.getByText(/Fajl „b.pdf“ je učitan/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ponovi povezivanje' })).toBeEnabled()
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['documents', 'p2'] })
  })

  it('promjena firme tokom uploada sprečava povezivanje u novom kontekstu', async () => {
    api.permissions.add('projects.write')
    useAuthStore.setState({ user: { id: 'u1', roles: ['PLATFORM_ADMIN'], companyId: null } as MeUser })
    useCompanyStore.setState({ selectedId: 'c1' })
    let resolveUpload!: (value: { data: { path: string } }) => void
    api.uploadFile.mockReset().mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve }))
    api.createDocument.mockReset()
    renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    act(() => useCompanyStore.setState({ selectedId: 'c2' }))
    resolveUpload({ data: { path: 'c1/plan.pdf' } })
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith(expect.stringContaining('Sesija ili firma')))
    expect(api.createDocument).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument()
  })

  it('promjena korisnika tokom provjere ne šalje retry i ne pokazuje tuđu referencu', async () => {
    api.permissions.add('projects.write')
    const user = { id: 'u1', roles: ['SUPER_ADMIN'], companyId: 'c1' } as MeUser
    useAuthStore.setState({ user })
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/plan.pdf' } })
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline'))
    let resolveList!: (value: { data: never[] }) => void
    api.listDocuments.mockResolvedValueOnce({ data: [] }).mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve }))
    renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ponovi povezivanje' }))
    await waitFor(() => expect(api.listDocuments).toHaveBeenCalledTimes(2))
    act(() => useAuthStore.setState({ user: { ...user, id: 'u2' } }))
    resolveList({ data: [] })
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith(expect.stringContaining('Sesija ili firma')))
    expect(api.createDocument).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument()
    act(() => useAuthStore.setState({ user }))
    expect(await screen.findByRole('button', { name: 'Ponovi povezivanje' })).toBeInTheDocument()
  })

  it('zakašnjeli uspjeh ne osvježava keš u drugoj sesiji', async () => {
    api.permissions.add('projects.write')
    const user = { id: 'u1', roles: ['SUPER_ADMIN'], companyId: 'c1' } as MeUser
    useAuthStore.setState({ user })
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/plan.pdf' } })
    let resolveLink!: (value: object) => void
    api.createDocument.mockReset().mockReturnValueOnce(new Promise((resolve) => { resolveLink = resolve }))
    const { client } = renderTab('documents')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledOnce())
    act(() => useAuthStore.setState({ user: { ...user, id: 'u2' } }))
    resolveLink({})
    await waitFor(() => expect(screen.getByLabelText('Dodaj dokument')).toBeEnabled())
    expect(invalidate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument()
  })

  it('nova sesija istog korisnika ne preuzima staru referencu', async () => {
    api.permissions.add('projects.write')
    const user = { id: 'u1', roles: ['SUPER_ADMIN'], companyId: 'c1' } as MeUser
    useAuthStore.setState({ user })
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/plan.pdf' } })
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline'))
    renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    expect(await screen.findByRole('button', { name: 'Ponovi povezivanje' })).toBeInTheDocument()
    try {
      act(() => {
        writeRefreshToken('test-session-token', false)
        useAuthStore.setState({ user: { ...user } })
      })
      expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument()
    } finally {
      clearRefreshToken()
    }
  })

  it('nepotvrđeno povezivanje preživljava unmount i povratak bez ponovnog uploada', async () => {
    api.permissions.add('projects.write')
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/plan.pdf' } })
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    const first = renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    await screen.findByRole('button', { name: 'Ponovi povezivanje' })
    first.unmount()
    renderTab('documents', first.client)
    await userEvent.click(await screen.findByRole('button', { name: 'Ponovi povezivanje' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledTimes(2))
    expect(api.createDocument.mock.calls[1][1]).toEqual(api.createDocument.mock.calls[0][1])
    expect(api.uploadFile).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument())
  })

  it('upload koji traje i dalje blokira novi nakon povratka, zatim nudi oporavak', async () => {
    api.permissions.add('projects.write')
    let resolveUpload!: (value: { data: { path: string } }) => void
    api.uploadFile.mockReset().mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve }))
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline'))
    const first = renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    first.unmount()
    renderTab('documents', first.client)
    expect(screen.getByLabelText('Dodaj dokument')).toBeDisabled()
    expect(screen.getByText('Učitavanje dokumenta je u toku…')).toHaveAttribute('role', 'status')
    resolveUpload({ data: { path: 'c1/plan.pdf' } })
    expect(await screen.findByRole('button', { name: 'Ponovi povezivanje' })).toBeEnabled()
    expect(api.uploadFile).toHaveBeenCalledOnce()
  })

  it('povezivanje koje traje preživljava unmount, blokira retry i čisti zapis po uspjehu', async () => {
    api.permissions.add('projects.write')
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/plan.pdf' } })
    let resolveLink!: (value: object) => void
    api.createDocument.mockReset().mockReturnValueOnce(new Promise((resolve) => { resolveLink = resolve }))
    const first = renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledOnce())
    first.unmount()
    renderTab('documents', first.client)
    expect(await screen.findByRole('button', { name: 'Ponovi povezivanje' })).toBeDisabled()
    expect(screen.getByLabelText('Dodaj dokument')).toBeDisabled()
    resolveLink({})
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Dodaj dokument')).toBeEnabled()
    expect(api.createDocument).toHaveBeenCalledOnce()
  })

  it('brisanje keša tokom uploada ne dozvoljava zakašnjelom odgovoru da vrati stanje ili pošalje povezivanje', async () => {
    api.permissions.add('projects.write')
    let resolveUpload!: (value: { data: { path: string } }) => void
    api.uploadFile.mockReset().mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve }))
    api.createDocument.mockReset()
    const first = renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    first.unmount()
    first.client.clear()
    resolveUpload({ data: { path: 'c1/plan.pdf' } })
    await waitFor(() => expect(api.toastError).toHaveBeenCalled())
    renderTab('documents', first.client)
    expect(screen.getByLabelText('Dodaj dokument')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument()
    expect(api.createDocument).not.toHaveBeenCalled()
  })

  it('dva istovremena prikaza istog projekta dijele blokadu retryja', async () => {
    api.permissions.add('projects.write')
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/plan.pdf' } })
    let resolveLink!: (value: object) => void
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(new Promise((resolve) => { resolveLink = resolve }))
    const first = renderTab('documents')
    const second = renderTab('documents', first.client)
    const firstView = within(first.container)
    const secondView = within(second.container)
    await userEvent.upload(firstView.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    await userEvent.click(await firstView.findByRole('button', { name: 'Ponovi povezivanje' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledTimes(2))
    expect(secondView.getByRole('button', { name: 'Ponovi povezivanje' })).toBeDisabled()
    resolveLink({})
    await waitFor(() => expect(secondView.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument())
    expect(api.uploadFile).toHaveBeenCalledOnce()
  })

  it('promjena firme A → B → A tokom uploada ne šalje povezivanje', async () => {
    api.permissions.add('projects.write')
    useAuthStore.setState({ user: { id: 'u1', roles: ['PLATFORM_ADMIN'], companyId: null } as MeUser })
    useCompanyStore.setState({ selectedId: 'c1' })
    let resolveUpload!: (value: { data: { path: string } }) => void
    api.uploadFile.mockReset().mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve }))
    api.createDocument.mockReset()
    renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    act(() => {
      useCompanyStore.getState().setSelectedId('c2')
      useCompanyStore.getState().setSelectedId('c1')
    })
    resolveUpload({ data: { path: 'c1/plan.pdf' } })
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith(expect.stringContaining('Sesija ili firma')))
    expect(api.createDocument).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Dodaj dokument')).toBeEnabled()
  })

  it('A → B → A tokom provjere čuva staru referencu za novi namjerni retry', async () => {
    api.permissions.add('projects.write')
    useAuthStore.setState({ user: { id: 'u1', roles: ['PLATFORM_ADMIN'], companyId: null } as MeUser })
    useCompanyStore.setState({ selectedId: 'c1' })
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/plan.pdf' } })
    api.createDocument.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    let resolveList!: (value: { data: never[] }) => void
    api.listDocuments.mockResolvedValueOnce({ data: [] }).mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve })).mockResolvedValue({ data: [] })
    renderTab('documents')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ponovi povezivanje' }))
    await waitFor(() => expect(api.listDocuments).toHaveBeenCalledTimes(2))
    act(() => {
      useCompanyStore.getState().setSelectedId('c2')
      useCompanyStore.getState().setSelectedId('c1')
    })
    resolveList({ data: [] })
    await waitFor(() => expect(api.toastError).toHaveBeenCalledWith(expect.stringContaining('Sesija ili firma')))
    expect(api.createDocument).toHaveBeenCalledOnce()
    const retry = screen.getByRole('button', { name: 'Ponovi povezivanje' })
    await waitFor(() => expect(retry).toBeEnabled())
    await userEvent.click(retry)
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledTimes(2))
    expect(api.createDocument.mock.calls[1][1]).toEqual(api.createDocument.mock.calls[0][1])
    expect(api.uploadFile).toHaveBeenCalledOnce()
  })

  it('uspjeh nakon promjene A → B → A ne osvježava keš u novom kontekstu', async () => {
    api.permissions.add('projects.write')
    useAuthStore.setState({ user: { id: 'u1', roles: ['PLATFORM_ADMIN'], companyId: null } as MeUser })
    useCompanyStore.setState({ selectedId: 'c1' })
    api.uploadFile.mockReset().mockResolvedValueOnce({ data: { path: 'c1/plan.pdf' } })
    let resolveLink!: (value: object) => void
    api.createDocument.mockReset().mockReturnValueOnce(new Promise((resolve) => { resolveLink = resolve }))
    const { client } = renderTab('documents')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledOnce())
    act(() => {
      useCompanyStore.getState().setSelectedId('c2')
      useCompanyStore.getState().setSelectedId('c1')
    })
    resolveLink({})
    await waitFor(() => expect(screen.getByLabelText('Dodaj dokument')).toBeEnabled())
    expect(invalidate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Ponovi povezivanje' })).not.toBeInTheDocument()
  })

  it('ne šalje upload ako nije moguće generisati sigurni ključ', async () => {
    api.permissions.add('projects.write')
    api.uploadFile.mockReset()
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('secure UUID unavailable') })
    try {
      renderTab('documents')
      await userEvent.upload(screen.getByLabelText('Dodaj dokument'), new File(['x'], 'plan.pdf', { type: 'application/pdf' }))
      await waitFor(() => expect(api.toastError).toHaveBeenCalledWith('secure UUID unavailable'))
      expect(api.uploadFile).not.toHaveBeenCalled()
    } finally {
      randomUUID.mockRestore()
    }
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
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledWith('p1', { path: 'p/f', fileName: 'plan.pdf', idempotencyKey: expect.any(String) }))
  })
})
