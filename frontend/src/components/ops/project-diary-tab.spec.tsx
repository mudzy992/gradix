import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectDiaryTab } from './project-diary-tab'
import { useCompanyStore } from '@/stores/company-store'

const listDiary = vi.fn()
const createDiary = vi.fn()
const patchDiary = vi.fn()
vi.mock('@/lib/api-ops', () => ({
  listDiary: (query: unknown) => listDiary(query),
  createDiary: (body: unknown) => createDiary(body),
  patchDiary: (id: string, body: unknown) => patchDiary(id, body),
  generateDiaryPdf: vi.fn(),
}))
vi.mock('@/hooks/use-me', () => ({ useHasPermission: () => true }))

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ProjectDiaryTab projectId="p1" /></QueryClientProvider>)
}

beforeEach(() => {
  listDiary.mockReset()
  createDiary.mockReset()
  patchDiary.mockReset()
  useCompanyStore.setState({ selectedId: 'a' })
})

describe('ProjectDiaryTab', () => {
  it('označava polja i prikazuje učitavanje umjesto prazne liste', () => {
    listDiary.mockReturnValue(new Promise(() => {}))
    renderTab()
    expect(screen.getByLabelText('Datum')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('Opis rada')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Učitavanje')
    expect(screen.queryByText('Nema unosa za ovaj projekat.')).not.toBeInTheDocument()
  })

  it('za početni datum koristi dan u vremenskoj zoni firme, ne UTC dan', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-31T23:30:00Z'))
      listDiary.mockReturnValue(new Promise(() => {}))
      renderTab()
      expect(screen.getByLabelText('Datum')).toHaveValue('2026-02-01')
    } finally {
      vi.useRealTimers()
    }
  })

  it('prikazuje grešku učitavanja i retry', async () => {
    listDiary.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] })
    renderTab()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Dnevnik se nije učitao.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Nema unosa za ovaj projekat.')).toBeInTheDocument()
  })

  it('ne šalje neizmijenjeno polje i vraća staru vrijednost nakon neuspjeha', async () => {
    listDiary.mockResolvedValue({ data: [{ id: 'd1', date: '2026-01-15', workDescription: 'Iskop', problemsNoted: 'Kiša' }] })
    patchDiary.mockRejectedValue(new Error('offline'))
    renderTab()
    const input = await screen.findByRole('textbox', { name: 'Problemi: 2026-01-15' })
    await userEvent.click(input)
    await userEvent.tab()
    expect(patchDiary).not.toHaveBeenCalled()
    await userEvent.clear(input)
    await userEvent.type(input, 'Led')
    await userEvent.tab()
    await waitFor(() => expect(input).toHaveValue('Kiša'))
    expect(patchDiary).toHaveBeenCalledWith('d1', { problemsNoted: 'Led' })
  })

  it('čuva datum i nacrt do izričitog odbacivanja', async () => {
    listDiary.mockResolvedValue({ data: [] })
    renderTab()
    await userEvent.type(screen.getByLabelText('Opis rada'), 'Iskop')
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    expect(screen.getByLabelText('Opis rada')).toHaveValue('Iskop')
    await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
    expect(screen.getByLabelText('Opis rada')).toHaveValue('')
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
  })

  it('samostalna promjena datuma smatra se nacrtom i može se odbaciti', async () => {
    listDiary.mockResolvedValue({ data: [] })
    renderTab()
    const date = screen.getByLabelText('Datum')
    const initial = (date as HTMLInputElement).value
    fireEvent.change(date, { target: { value: '2020-02-03' } })
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
    expect(date).toHaveValue(initial)
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
  })

  it('blokira ponovni submit dok upis traje', async () => {
    listDiary.mockResolvedValue({ data: [] })
    let resolve!: () => void
    createDiary.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    renderTab()
    await userEvent.type(screen.getByLabelText('Opis rada'), 'Iskop')
    const button = screen.getByRole('button', { name: 'Sačuvaj' })
    await userEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByLabelText('Opis rada')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Odbaci nacrt' })).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    expect(createDiary).toHaveBeenCalledOnce()
    resolve()
    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.getByLabelText('Opis rada')).toHaveValue('')
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
  })
})
