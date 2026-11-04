import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRow } from '@/lib/ops-types'
import { ProjectSheet } from './project-sheet'

const createProject = vi.fn()
const patchProject = vi.fn()
vi.mock('@/lib/api-ops', () => ({
  createProject: (body: unknown) => createProject(body),
  patchProject: (id: string, body: unknown) => patchProject(id, body),
}))

const existing = {
  id: 'p1', name: 'Most', code: 'P1', locality: 'Sarajevo', plannedBudget: '123', client: 'Grad',
  plannedStart: '2026-01-01T00:00:00.000Z', plannedEnd: '2026-02-01T00:00:00.000Z',
} as ProjectRow

function renderSheet(project: ProjectRow | null) {
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()
  render(<ProjectSheet open project={project} onOpenChange={onOpenChange} onSaved={onSaved} />)
  return { onOpenChange, onSaved }
}

beforeEach(() => {
  createProject.mockReset()
  patchProject.mockReset()
})

describe('ProjectSheet', () => {
  it('prazan naziv je označen i objašnjen uz polje', async () => {
    renderSheet(null)
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    const name = screen.getByLabelText('Naziv')
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(name).toHaveAttribute('aria-describedby', 'name-error')
    expect(screen.getByText('Obavezno polje.')).toBeInTheDocument()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('brisanje početka i kraja projekta šalje prazne stringove za backend clear', async () => {
    patchProject.mockResolvedValue({})
    const { onSaved, onOpenChange } = renderSheet(existing)
    await userEvent.clear(screen.getByLabelText('Planirani početak'))
    await userEvent.clear(screen.getByLabelText('Planirani kraj'))
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    await waitFor(() => expect(patchProject).toHaveBeenCalledOnce())
    expect(patchProject).toHaveBeenCalledWith('p1', expect.objectContaining({ plannedStart: '', plannedEnd: '' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('pri kreiranju izostavlja prazne datume i blokira dupli submit', async () => {
    let resolve!: () => void
    createProject.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    renderSheet(null)
    await userEvent.type(screen.getByLabelText('Naziv'), '  Novi projekat  ')
    const save = screen.getByRole('button', { name: 'Sačuvaj' })
    await userEvent.click(save)
    await waitFor(() => expect(save).toBeDisabled())
    expect(createProject).toHaveBeenCalledOnce()
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Novi projekat', plannedStart: undefined, plannedEnd: undefined }))
    resolve()
    await waitFor(() => expect(save).toBeEnabled())
  })
})
