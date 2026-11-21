import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuantitiesTab } from './quantities-tab'
import { useCompanyStore } from '@/stores/company-store'

const listQuantities = vi.fn()
const createQuantity = vi.fn()
const patchQuantity = vi.fn()
vi.mock('@/lib/api-ops', () => ({
  listQuantities: (id: string) => listQuantities(id),
  createQuantity: (id: string, body: unknown) => createQuantity(id, body),
  patchQuantity: (id: string, rowId: string, body: unknown) => patchQuantity(id, rowId, body),
}))
vi.mock('@/hooks/use-me', () => ({ useHasPermission: () => true }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({ user: { roles: ['ADMIN'] } }),
}))

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><QuantitiesTab projectId="project-1" /></QueryClientProvider>)
}

beforeEach(() => {
  listQuantities.mockReset()
  createQuantity.mockReset()
  patchQuantity.mockReset()
  useCompanyStore.setState({ selectedId: 'a' })
})

describe('QuantitiesTab', () => {
  it('koristi izabranu jedinicu i dostupne nazive polja prilikom kreiranja', async () => {
    listQuantities.mockResolvedValue({ data: [] })
    createQuantity.mockResolvedValue({ data: {} })
    renderTab()
    await userEvent.type(screen.getByLabelText('Naziv'), 'Cijevi')
    await userEvent.type(screen.getByLabelText('Planirano'), '12')
    await userEvent.selectOptions(screen.getByLabelText('Jedinica mjere'), 'M2')
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    expect(createQuantity).toHaveBeenCalledWith('project-1', { name: 'Cijevi', unit: 'M2', plannedQty: '12' })
  })

  it('čuva nacrt i izbor jedinice dok se ne odbaci ili ne sačuva', async () => {
    listQuantities.mockResolvedValue({ data: [] })
    renderTab()
    await userEvent.selectOptions(screen.getByLabelText('Jedinica mjere'), 'M2')
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    await userEvent.type(screen.getByLabelText('Naziv'), 'Cijevi')
    expect(screen.getByLabelText('Naziv')).toHaveValue('Cijevi')
    await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
    expect(screen.getByLabelText('Naziv')).toHaveValue('')
    expect(screen.getByLabelText('Jedinica mjere')).toHaveValue('M3')
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
  })

  it('ne dozvoljava promjenu firme ili odbacivanje dok traje upis, a kod greške čuva nacrt', async () => {
    listQuantities.mockResolvedValue({ data: [] })
    let reject!: (error: Error) => void
    createQuantity.mockReturnValue(new Promise((_, fail) => { reject = fail }))
    renderTab()
    await userEvent.type(screen.getByLabelText('Naziv'), 'Cijevi')
    await userEvent.type(screen.getByLabelText('Planirano'), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    expect(screen.getByRole('button', { name: 'Odbaci nacrt' })).toBeDisabled()
    expect(screen.getByLabelText('Naziv')).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    await act(async () => { reject(new Error('offline')) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Odbaci nacrt' })).toBeEnabled())
    expect(screen.getByLabelText('Naziv')).toHaveValue('Cijevi')
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
  })

  it('poslije uspješnog upisa vraća prazna polja i podrazumijevanu jedinicu', async () => {
    listQuantities.mockResolvedValue({ data: [] })
    let resolve!: () => void
    createQuantity.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    renderTab()
    await userEvent.type(screen.getByLabelText('Naziv'), 'Cijevi')
    await userEvent.type(screen.getByLabelText('Planirano'), '12')
    await userEvent.selectOptions(screen.getByLabelText('Jedinica mjere'), 'M2')
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    await act(async () => { resolve() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sačuvaj' })).toBeEnabled())
    expect(screen.getByLabelText('Naziv')).toHaveValue('')
    expect(screen.getByLabelText('Jedinica mjere')).toHaveValue('M3')
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
  })

  it('prikazuje grešku i ponovo učitava podatke', async () => {
    listQuantities.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] })
    renderTab()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Količine se nisu učitale.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(listQuantities).toHaveBeenCalledTimes(2)
  })

  it('prevodi jedinicu i imenuje polje izvedene količine za svaki red', async () => {
    listQuantities.mockResolvedValue({ data: [{ id: 'q1', name: 'Cijevi', unit: 'PCS', plannedQty: '12', executedQty: '2' }] })
    renderTab()
    expect(await screen.findByText('Cijevi (kom)')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Izvedeno: Cijevi' })).toHaveValue('2')
    expect(screen.getByRole('region', { name: 'Količine' })).toBeInTheDocument()
  })

  it('vraća raniju izvedenu količinu ako spremanje ne uspije', async () => {
    listQuantities.mockResolvedValue({ data: [{ id: 'q1', name: 'Cijevi', unit: 'PCS', plannedQty: '12', executedQty: '2' }] })
    patchQuantity.mockRejectedValue(new Error('offline'))
    renderTab()
    const input = await screen.findByRole('textbox', { name: 'Izvedeno: Cijevi' })
    await userEvent.clear(input)
    await userEvent.type(input, '9')
    await userEvent.tab()
    await waitFor(() => expect(input).toHaveValue('2'))
    expect(patchQuantity).toHaveBeenCalledWith('project-1', 'q1', { executedQty: '9' })
  })

})
