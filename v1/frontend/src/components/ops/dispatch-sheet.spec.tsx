import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DispatchSheet } from './dispatch-sheet'

const listProjects = vi.fn()
const listUsers = vi.fn()
const createTask = vi.fn()
vi.mock('@/lib/api-ops', () => ({
  listProjects: (query: unknown) => listProjects(query),
  createTask: (body: unknown) => createTask(body),
}))
vi.mock('@/lib/api', () => ({ listUsers: (query: unknown) => listUsers(query) }))

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  render(<QueryClientProvider client={client}><DispatchSheet open onSaved={onSaved} onOpenChange={onOpenChange} /></QueryClientProvider>)
  return { onSaved, onOpenChange }
}

beforeEach(() => {
  listProjects.mockReset()
  listUsers.mockReset()
  createTask.mockReset()
  listProjects.mockResolvedValue({ data: [{ id: 'p1', name: 'Most' }] })
  listUsers.mockResolvedValue({ data: [{ id: 'u1', firstName: 'Ana', lastName: 'Marić' }] })
})

describe('DispatchSheet', () => {
  it('prikazuje povezane greške za obavezni projekat i naziv', async () => {
    renderSheet()
    await screen.findByRole('option', { name: 'Most' })
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    const project = screen.getByLabelText('Projekti')
    const title = screen.getByLabelText('Naziv')
    await waitFor(() => expect(project).toHaveAttribute('aria-invalid', 'true'))
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(project).toHaveAttribute('aria-describedby', 'projectId-error')
    expect(title).toHaveAttribute('aria-describedby', 'title-error')
    expect(createTask).not.toHaveBeenCalled()
  })

  it('ne dozvoljava snimanje dok projekti ne stignu i nudi retry nakon greške', async () => {
    listProjects.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [{ id: 'p1', name: 'Most' }] })
    renderSheet()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Projekti se nisu učitali.')
    expect(screen.getByRole('button', { name: 'Sačuvaj' })).toBeDisabled()
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByRole('option', { name: 'Most' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sačuvaj' })).toBeEnabled()
  })

  it('šalje odabrane vrijednosti i sprječava ponovljeni submit u toku zahtjeva', async () => {
    let resolve!: () => void
    createTask.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const { onSaved, onOpenChange } = renderSheet()
    await screen.findByRole('option', { name: 'Most' })
    await screen.findByRole('option', { name: 'Ana Marić' })
    await userEvent.selectOptions(screen.getByLabelText('Projekti'), 'p1')
    await userEvent.type(screen.getByLabelText('Naziv'), '  Iskop  ')
    await userEvent.selectOptions(screen.getByLabelText('Dodijeljeni'), 'u1')
    const save = screen.getByRole('button', { name: 'Sačuvaj' })
    await userEvent.click(save)
    await waitFor(() => expect(save).toBeDisabled())
    expect(createTask).toHaveBeenCalledOnce()
    expect(createTask).toHaveBeenCalledWith({ projectId: 'p1', title: 'Iskop', assigneeIds: ['u1'] })
    resolve()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('pojašnjava grešku korisnika i dopušta zadatak bez dodjele', async () => {
    listUsers.mockRejectedValue(new Error('forbidden'))
    createTask.mockResolvedValue({})
    renderSheet()
    expect(await screen.findByRole('alert')).toHaveTextContent('Korisnici se nisu učitali.')
    await screen.findByRole('option', { name: 'Most' })
    expect(screen.getByLabelText('Dodijeljeni')).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Projekti'), 'p1')
    await userEvent.type(screen.getByLabelText('Naziv'), 'Iskop')
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    await waitFor(() => expect(createTask).toHaveBeenCalledWith({ projectId: 'p1', title: 'Iskop', assigneeIds: [] }))
  })
})
