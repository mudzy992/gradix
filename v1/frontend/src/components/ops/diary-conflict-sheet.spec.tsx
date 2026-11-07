import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiaryConflictSheet } from '@/components/ops/diary-conflict-sheet'

/**
 * FE-10 — konflikt dnevnika. Drži ono što je prije falilo: **koji datum** je u konfliktu, „—“ za
 * prazan tekst i jasnu poruku (umjesto tihog „klikni i ništa se ne dogodi“) kad detalji nemaju
 * projekat/datum.
 */
const resolveDiaryConflict = vi.fn()

vi.mock('@/lib/api-ops', () => ({
  resolveDiaryConflict: (body: unknown) => resolveDiaryConflict(body),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (message: string) => toastError(message), success: vi.fn() },
}))

function details(incoming: Record<string, unknown> | undefined, existing?: Record<string, unknown>) {
  return { conflictData: { existing, incoming } }
}

beforeEach(() => {
  resolveDiaryConflict.mockReset().mockResolvedValue({})
  toastError.mockReset()
})

describe('DiaryConflictSheet', () => {
  it('u naslovu pokazuje datum konflikta i oba teksta', () => {
    render(
      <DiaryConflictSheet
        details={details(
          { projectId: 'p1', date: '2026-11-03', workDescription: 'Novi tekst' },
          { workDescription: 'Stari tekst' },
        )}
        open
        onOpenChange={() => {}}
        onResolved={() => {}}
      />,
    )

    expect(screen.getByText('Konflikt dnevnika — 2026-11-03')).toBeInTheDocument()
    expect(screen.getByText('Stari tekst')).toBeInTheDocument()
    expect(screen.getByText('Novi tekst')).toBeInTheDocument()
  })

  it('prazan tekst prikazuje crticu, ne prazninu', () => {
    render(
      <DiaryConflictSheet
        details={details({ projectId: 'p1', date: '2026-11-03' }, {})}
        open
        onOpenChange={() => {}}
        onResolved={() => {}}
      />,
    )

    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('spaja tekst i javlja da je konflikt riješen', async () => {
    const onResolved = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <DiaryConflictSheet
        details={details(
          { projectId: 'p1', date: '2026-11-03', workDescription: 'Novi tekst' },
          { workDescription: 'Stari tekst' },
        )}
        open
        onOpenChange={onOpenChange}
        onResolved={onResolved}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Spoji tekst' }))
    expect(resolveDiaryConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'DIARY',
        projectId: 'p1',
        date: '2026-11-03',
        choice: 'MERGE',
        mergeWork: 'Stari tekst\n\nNovi tekst',
      }),
    )
    expect(onResolved).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('bez projekta/datuma odluka je onemogućena i objašnjena', async () => {
    render(
      <DiaryConflictSheet details={details({ workDescription: 'Tekst' })} open onOpenChange={() => {}} onResolved={() => {}} />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/nema projekat ili datum/)
    expect(screen.getByRole('button', { name: 'Uzmi novo (B)' })).toBeDisabled()
    expect(resolveDiaryConflict).not.toHaveBeenCalled()
  })

  it('dugme „Otkaži“ zatvara sheet bez odluke', async () => {
    const onOpenChange = vi.fn()
    render(
      <DiaryConflictSheet
        details={details({ projectId: 'p1', date: '2026-11-03', workDescription: 'Tekst' })}
        open
        onOpenChange={onOpenChange}
        onResolved={() => {}}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Otkaži' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(resolveDiaryConflict).not.toHaveBeenCalled()
  })

  it('„Zadrži postojeće“ i „Uzmi novo“ šalju odgovarajući izbor', async () => {
    const base = {
      details: details({ projectId: 'p1', date: '2026-11-03', workDescription: 'Novi' }, { workDescription: 'Stari' }),
      open: true,
      onOpenChange: () => {},
      onResolved: () => {},
    }
    render(<DiaryConflictSheet {...base} />)
    await userEvent.click(screen.getByRole('button', { name: 'Zadrži postojeće (A)' }))
    expect(resolveDiaryConflict).toHaveBeenLastCalledWith(expect.objectContaining({ choice: 'A' }))

    await userEvent.click(screen.getByRole('button', { name: 'Uzmi novo (B)' }))
    expect(resolveDiaryConflict).toHaveBeenLastCalledWith(expect.objectContaining({ choice: 'B' }))
  })
})
