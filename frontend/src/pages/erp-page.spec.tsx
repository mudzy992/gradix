import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CostRow, PartnerRow, StockRow, WarehouseRow } from '@/lib/api-erp'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { ErpPage } from '@/pages/erp-page'
import { isSensitiveNavigationBlocked } from '@/lib/sensitive-navigation'
import { clearRefreshToken } from '@/lib/storage'
import { STOCK_MOVEMENT_PENDING_QUERY } from '@/lib/constants'
import { toast } from 'sonner'

/**
 * FE-12 — ERP-lite. Drži: prevedene tipove/kategorije/izvore (prije `CLIENT`, `MATERIAL`, `PAYROLL`),
 * formatirane iznose, labele na poljima, prazna stanja i grešku sa ponovnim pokušajem. Uz to: upit se
 * izvršava **po tabu** (prije su sva četiri išla odmah).
 */
const listPartners = vi.fn()
const listCostEntries = vi.fn()
const listWarehouses = vi.fn()
const listStock = vi.fn()
const listMaterials = vi.fn()
const createPartner = vi.fn()
const createCostEntry = vi.fn()
const fromPayroll = vi.fn()
const createWarehouse = vi.fn()
const createStockMovement = vi.fn()

vi.mock('@/lib/api-erp', () => ({
  listPartners: () => listPartners(),
  listCostEntries: () => listCostEntries(),
  listWarehouses: () => listWarehouses(),
  listStock: () => listStock(),
  createPartner: (body: unknown) => createPartner(body),
  createCostEntry: (body: unknown) => createCostEntry(body),
  fromPayroll: (body: unknown) => fromPayroll(body),
  createWarehouse: (body: unknown) => createWarehouse(body),
  createStockMovement: (body: unknown) => createStockMovement(body),
}))

vi.mock('@/lib/api-fleet', () => ({
  listMaterials: () => listMaterials(),
}))

function partner(overrides: Partial<PartnerRow> = {}): PartnerRow {
  return {
    id: 'pa1',
    type: 'CLIENT',
    name: 'Općina Ilidža',
    taxId: null,
    note: null,
    isActive: true,
    ...overrides,
  }
}

function cost(overrides: Partial<CostRow> = {}): CostRow {
  return {
    id: 'c1',
    amount: '1234.500000',
    category: 'MATERIAL',
    date: '2026-11-02T00:00:00.000Z',
    note: null,
    source: 'PAYROLL',
    sourceId: null,
    projectId: null,
    ...overrides,
  }
}

function warehouse(overrides: Partial<WarehouseRow> = {}): WarehouseRow {
  return {
    id: 'w1',
    name: 'Depo Ilidža',
    type: 'YARD',
    projectId: null,
    ...overrides,
  }
}

function stockLine(overrides: Partial<StockRow> = {}): StockRow {
  return {
    warehouseId: 'w1',
    warehouseName: 'Depo Ilidža',
    warehouseType: 'YARD',
    materialId: 'm1',
    materialName: 'Šljunak',
    qty: '12.500',
    ...overrides,
  }
}

function renderPage(existingClient?: QueryClient) {
  const client = existingClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ErpPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, client }
}

beforeEach(() => {
  listPartners.mockReset().mockResolvedValue({ data: [partner()], meta: { total: 1 } })
  listCostEntries.mockReset().mockResolvedValue({ data: [cost()], meta: { total: 1 } })
  listWarehouses.mockReset().mockResolvedValue({ data: [warehouse()], meta: { total: 1 } })
  listStock.mockReset().mockResolvedValue({ data: [stockLine()], meta: { total: 1 } })
  listMaterials.mockReset().mockResolvedValue({
    data: [{ id: 'm1', name: 'Šljunak', unit: 'M3' }],
    meta: { total: 1 },
  })
  createPartner.mockReset().mockResolvedValue({})
  createCostEntry.mockReset().mockResolvedValue({})
  fromPayroll.mockReset().mockResolvedValue({})
  createWarehouse.mockReset().mockResolvedValue({})
  createStockMovement.mockReset().mockResolvedValue({})
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ADMIN'],
      permissions: ['erp.read', 'erp.write', 'fleet.read'],
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
})

describe('ErpPage', () => {
  it('partneri: preveden tip, broj i labela polja', async () => {
    renderPage()

    const list = await screen.findByRole('list')
    expect(await within(list).findByText('Općina Ilidža')).toBeInTheDocument()
    expect(within(list).getByText('Naručilac')).toBeInTheDocument()
    expect(screen.getByText('Partnera: 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Naziv partnera')).toBeInTheDocument()
    expect(screen.queryByText('CLIENT')).not.toBeInTheDocument()
    // Ostali tabovi ne učitavaju svoje upite dok se ne otvore.
    expect(listCostEntries).not.toHaveBeenCalled()
    expect(listStock).not.toHaveBeenCalled()
  })

  it('izbor tipa ili nacrt partnera blokira firmu i ERP karticu dok se ne odbaci', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '')
    try {
      renderPage()
      await userEvent.selectOptions(screen.getByLabelText('Tip'), 'SUPPLIER')
      expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
      expect(isSensitiveNavigationBlocked()).toBe(true)
      await userEvent.type(screen.getByLabelText('Naziv partnera'), 'JP Autoceste')
      await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
      expect(screen.getByRole('tab', { name: 'Partneri' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByLabelText('Naziv partnera')).toHaveValue('JP Autoceste')
      expect(error).toHaveBeenCalledWith(expect.stringContaining('nacrt partnera'))
      expect(listCostEntries).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
      expect(screen.getByLabelText('Tip')).toHaveValue('CLIENT')
      expect(isSensitiveNavigationBlocked()).toBe(false)
      act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
      await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
      expect(await screen.findByRole('heading', { name: 'Novi trošak' })).toBeInTheDocument()
    } finally { error.mockRestore() }
  })

  it('partner upis blokira izmjene i dupli submit; greška čuva nacrt i traži svjestan retry', async () => {
    let reject!: (error: Error) => void
    createPartner.mockReturnValueOnce(new Promise((_, fail) => { reject = fail })).mockResolvedValueOnce({})
    renderPage()
    const name = screen.getByLabelText('Naziv partnera')
    await userEvent.type(name, 'JP Autoceste')
    const button = screen.getByRole('button', { name: 'Novi partner' })
    const form = button.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(createPartner).toHaveBeenCalledTimes(1)
    expect(name).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Odbaci nacrt' })).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    expect(screen.getByRole('tab', { name: 'Partneri' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { reject(new Error('offline')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Partner možda već postoji')
    expect(name).toHaveValue('JP Autoceste')
    expect(button).toBeDisabled()
    fireEvent.submit(form)
    expect(createPartner).toHaveBeenCalledTimes(1)
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(button)
    expect(createPartner).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(name).toHaveValue(''))
    await waitFor(() => expect(isSensitiveNavigationBlocked()).toBe(false))
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('partneri: prazna lista ima poruku', async () => {
    listPartners.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    expect(await screen.findByText('Nema partnera.')).toBeInTheDocument()
  })

  it('troškovi: prevedena kategorija i izvor, formatiran iznos, odvojene forme', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Troškovi' }))

    const list = await screen.findByRole('list')
    expect(await within(list).findByText('1.234,50')).toBeInTheDocument()
    expect(within(list).getByText('Materijal')).toBeInTheDocument()
    expect(within(list).getByText('Iz obračuna')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Novi trošak' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Iz obračuna' })).toBeInTheDocument()
    expect(screen.getByLabelText('Kategorija troška')).toBeInTheDocument()
    expect(screen.getByLabelText('Datum troška')).toBeInTheDocument()
    expect(screen.queryByText('MATERIAL')).not.toBeInTheDocument()
    expect(screen.queryByText('PAYROLL')).not.toBeInTheDocument()
  })

  it('samostalan izbor kategorije i datuma troška štiti firmu i karticu, odbacivanje čisti sva polja', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '')
    try {
      renderPage()
      await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
      const category = screen.getByLabelText('Kategorija troška')
      const date = screen.getByLabelText('Datum troška')
      await userEvent.selectOptions(category, 'FUEL')
      expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
      expect(isSensitiveNavigationBlocked()).toBe(true)
      await userEvent.selectOptions(category, 'MATERIAL')
      expect(isSensitiveNavigationBlocked()).toBe(false)
      fireEvent.change(date, { target: { value: '2026-11-05' } })
      expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
      await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
      expect(screen.getByRole('tab', { name: 'Troškovi' })).toHaveAttribute('aria-selected', 'true')
      expect(error).toHaveBeenCalledWith(expect.stringContaining('nacrt troška'))
      expect(listWarehouses).not.toHaveBeenCalled()
      await userEvent.type(screen.getByLabelText('Iznos troška'), '450.50')
      await userEvent.selectOptions(category, 'SERVICE')
      await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
      expect(category).toHaveValue('MATERIAL')
      expect(date).toHaveValue('')
      expect(screen.getByLabelText('Iznos troška')).toHaveValue('')
      expect(isSensitiveNavigationBlocked()).toBe(false)
      act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
      await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
      expect(await screen.findByText('Depo Ilidža · Šljunak')).toBeInTheDocument()
    } finally { error.mockRestore() }
  })

  it('ručni trošak: pending i nepoznat ishod blokiraju dupli upis; svjestan retry čisti tek nakon uspjeha', async () => {
    let reject!: (error: Error) => void
    createCostEntry.mockReturnValueOnce(new Promise((_, fail) => { reject = fail })).mockResolvedValueOnce({})
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
    const amount = screen.getByLabelText('Iznos troška')
    const category = screen.getByLabelText('Kategorija troška')
    const date = screen.getByLabelText('Datum troška')
    await userEvent.type(amount, '450.50')
    await userEvent.selectOptions(category, 'FUEL')
    fireEvent.change(date, { target: { value: '2026-11-05' } })
    const button = screen.getByRole('button', { name: 'Novi trošak' })
    const form = button.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(createCostEntry).toHaveBeenCalledTimes(1)
    expect(createCostEntry).toHaveBeenCalledWith({ amount: '450.50', category: 'FUEL', date: '2026-11-05' })
    expect(amount).toBeDisabled()
    expect(category).toBeDisabled()
    expect(date).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Spremanje je u toku')
    expect(screen.getByRole('button', { name: 'Odbaci nacrt' })).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: 'Partneri' }))
    expect(screen.getByRole('tab', { name: 'Troškovi' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { reject(new Error('offline')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Trošak možda već postoji')
    expect(amount).toHaveValue('450.50')
    expect(category).toHaveValue('FUEL')
    expect(date).toHaveValue('2026-11-05')
    expect(button).toBeDisabled()
    fireEvent.submit(form)
    expect(createCostEntry).toHaveBeenCalledTimes(1)
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(button)
    expect(createCostEntry).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(amount).toHaveValue(''))
    expect(category).toHaveValue('MATERIAL')
    expect(date).toHaveValue('')
    await waitFor(() => expect(isSensitiveNavigationBlocked()).toBe(false))
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('ručni trošak: nepoznat ishod se može svjesno odbaciti bez novog upisa', async () => {
    createCostEntry.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
    await userEvent.type(screen.getByLabelText('Iznos troška'), '50')
    fireEvent.change(screen.getByLabelText('Datum troška'), { target: { value: '2026-11-05' } })
    await userEvent.click(screen.getByRole('button', { name: 'Novi trošak' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Trošak možda već postoji')
    await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Iznos troška')).toHaveValue('')
    expect(isSensitiveNavigationBlocked()).toBe(false)
    expect(createCostEntry).toHaveBeenCalledTimes(1)
  })

  it('obračun: promjena godine ili mjeseca štiti nacrt nezavisno od ručnog troška', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
    const year = screen.getByLabelText('Godina') as HTMLInputElement
    const month = screen.getByLabelText('Mjesec') as HTMLInputElement
    const initialYear = year.value
    const initialMonth = month.value
    const payrollForm = screen.getByRole('button', { name: 'Iz obračuna' }).closest('form')!
    const manualForm = screen.getByRole('button', { name: 'Novi trošak' }).closest('form')!
    fireEvent.change(year, { target: { value: initialYear === '2024' ? '2025' : '2024' } })
    expect(isSensitiveNavigationBlocked()).toBe(true)
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    expect(screen.getByRole('tab', { name: 'Troškovi' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.change(year, { target: { value: initialYear } })
    expect(isSensitiveNavigationBlocked()).toBe(false)
    fireEvent.change(month, { target: { value: initialMonth === '1' ? '2' : '1' } })
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.type(screen.getByLabelText('Iznos troška'), '10')
    await userEvent.click(within(payrollForm).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(month).toHaveValue(Number(initialMonth))
    expect(isSensitiveNavigationBlocked()).toBe(true)
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(within(manualForm).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(isSensitiveNavigationBlocked()).toBe(false)
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('obračun: pending blokira karticu i ponavljanje, nepoznat ishod zahtijeva potvrdu prije retryja', async () => {
    let reject!: (error: Error) => void
    fromPayroll.mockReturnValueOnce(new Promise((_, fail) => { reject = fail })).mockResolvedValueOnce({})
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
    const year = screen.getByLabelText('Godina')
    const month = screen.getByLabelText('Mjesec')
    fireEvent.change(year, { target: { value: '2024' } })
    fireEvent.change(month, { target: { value: '3' } })
    const button = screen.getByRole('button', { name: 'Iz obračuna' })
    const form = button.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(fromPayroll).toHaveBeenCalledTimes(1)
    expect(fromPayroll).toHaveBeenCalledWith({ year: 2024, month: 3 })
    expect(year).toBeDisabled()
    expect(month).toBeDisabled()
    expect(within(form).getByRole('button', { name: 'Odbaci nacrt' })).toBeDisabled()
    expect(within(form).getByRole('status')).toHaveTextContent('Spremanje je u toku')
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: 'Partneri' }))
    expect(screen.getByRole('tab', { name: 'Troškovi' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { reject(new Error('offline')) })
    expect(within(form).getByRole('alert')).toHaveTextContent('Trošak za odabrani period možda već postoji')
    expect(year).toHaveValue(2024)
    expect(month).toHaveValue(3)
    expect(button).toBeDisabled()
    fireEvent.submit(form)
    expect(fromPayroll).toHaveBeenCalledTimes(1)
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(within(form).getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(button)
    expect(fromPayroll).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(isSensitiveNavigationBlocked()).toBe(false))
    expect(year).toHaveValue(2024)
    expect(month).toHaveValue(3)
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('obračun: greška za početni period ostaje zaštićena i može se odbaciti; prazna polja nisu validna', async () => {
    fromPayroll.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
    const year = screen.getByLabelText('Godina') as HTMLInputElement
    const month = screen.getByLabelText('Mjesec') as HTMLInputElement
    const button = screen.getByRole('button', { name: 'Iz obračuna' })
    const form = button.closest('form')!
    await userEvent.click(button)
    expect(await within(form).findByRole('alert')).toHaveTextContent('nije potvrđeno')
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(within(form).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(isSensitiveNavigationBlocked()).toBe(false)
    fireEvent.change(year, { target: { value: '' } })
    expect(year.checkValidity()).toBe(false)
    fireEvent.change(year, { target: { value: '2024' } })
    fireEvent.change(month, { target: { value: '' } })
    expect(month.checkValidity()).toBe(false)
    fireEvent.change(month, { target: { value: '13' } })
    expect(month.checkValidity()).toBe(false)
    await userEvent.click(button)
    expect(fromPayroll).toHaveBeenCalledTimes(1)
  })

  it('uspjeh jednog od dva paralelna ERP upisa ne oslobađa drugu radnju', async () => {
    let finishManual!: (value: object) => void
    let finishPayroll!: (value: object) => void
    createCostEntry.mockReturnValueOnce(new Promise((resolve) => { finishManual = resolve }))
    fromPayroll.mockReturnValueOnce(new Promise((resolve) => { finishPayroll = resolve }))
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
    await userEvent.type(screen.getByLabelText('Iznos troška'), '50')
    fireEvent.change(screen.getByLabelText('Datum troška'), { target: { value: '2026-11-05' } })
    await userEvent.click(screen.getByRole('button', { name: 'Novi trošak' }))
    await userEvent.click(screen.getByRole('button', { name: 'Iz obračuna' }))
    expect(createCostEntry).toHaveBeenCalledTimes(1)
    expect(fromPayroll).toHaveBeenCalledTimes(1)
    await act(async () => { finishManual({}) })
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    expect(screen.getByRole('tab', { name: 'Troškovi' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { finishPayroll({}) })
    await waitFor(() => expect(isSensitiveNavigationBlocked()).toBe(false))
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('troškovi: prazna lista ima poruku, a greška nudi ponovni pokušaj', async () => {
    listCostEntries.mockRejectedValueOnce(new Error('mreža'))
    listCostEntries.mockResolvedValueOnce({ data: [], meta: { total: 0 } })
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Troškovi' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ERP podaci se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Nema troškova u ovom periodu.')).toBeInTheDocument()
  })

  it('lager: dugme „Knjiži“ umjesto „Količina“ i labele na poljima', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Lager' }))

    expect(await screen.findByText('Depo Ilidža · Šljunak')).toBeInTheDocument()
    expect(screen.getByText('Stavki lagera: 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Knjiži' })).toBeInTheDocument()
    expect(screen.getByLabelText('Naziv skladišta')).toBeInTheDocument()
    expect(screen.getByLabelText('Skladište')).toBeInTheDocument()
    expect(screen.getByLabelText('Materijal')).toBeInTheDocument()
    expect(screen.getByLabelText('Količina')).toBeInTheDocument()
    // Tip skladišta u formi je preveden.
    expect(
      within(screen.getByLabelText('Tip')).getByRole('option', {
        name: 'Cisterna',
      }),
    ).toBeInTheDocument()
  })

  it('skladište: samostalan izbor tipa štiti nacrt, firma i kartica čekaju odbacivanje', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '')
    try {
      renderPage()
      await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
      const type = screen.getByLabelText('Tip')
      await userEvent.selectOptions(type, 'CISTERN')
      expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
      expect(isSensitiveNavigationBlocked()).toBe(true)
      await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
      expect(screen.getByRole('tab', { name: 'Lager' })).toHaveAttribute('aria-selected', 'true')
      expect(error).toHaveBeenCalledWith(expect.stringContaining('nacrt skladišta'))
      expect(listCostEntries).not.toHaveBeenCalled()
      await userEvent.type(screen.getByLabelText('Naziv skladišta'), 'Novo skladište')
      await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
      expect(type).toHaveValue('SITE')
      expect(screen.getByLabelText('Naziv skladišta')).toHaveValue('')
      expect(isSensitiveNavigationBlocked()).toBe(false)
      act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
      await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
      expect(await screen.findByRole('heading', { name: 'Novi trošak' })).toBeInTheDocument()
    } finally { error.mockRestore() }
  })

  it('skladište: pending i nepoznat ishod blokiraju dupli upis do svjesne potvrde retryja', async () => {
    let reject!: (error: Error) => void
    createWarehouse.mockReturnValueOnce(new Promise((_, fail) => { reject = fail })).mockResolvedValueOnce({})
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const name = screen.getByLabelText('Naziv skladišta')
    const type = screen.getByLabelText('Tip')
    await userEvent.type(name, 'Skladište Ilidža')
    await userEvent.selectOptions(type, 'YARD')
    const button = screen.getByRole('button', { name: 'Novo skladište' })
    const form = button.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(createWarehouse).toHaveBeenCalledTimes(1)
    expect(createWarehouse).toHaveBeenCalledWith({ name: 'Skladište Ilidža', type: 'YARD' })
    expect(name).toBeDisabled()
    expect(type).toBeDisabled()
    expect(within(form).getByRole('status')).toHaveTextContent('Spremanje je u toku')
    expect(within(form).getByRole('button', { name: 'Odbaci nacrt' })).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: 'Partneri' }))
    expect(screen.getByRole('tab', { name: 'Lager' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { reject(new Error('offline')) })
    expect(within(form).getByRole('alert')).toHaveTextContent('Skladište možda već postoji')
    expect(name).toHaveValue('Skladište Ilidža')
    expect(type).toHaveValue('YARD')
    expect(button).toBeDisabled()
    fireEvent.submit(form)
    expect(createWarehouse).toHaveBeenCalledTimes(1)
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(within(form).getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(button)
    expect(createWarehouse).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(name).toHaveValue(''))
    expect(type).toHaveValue('SITE')
    await waitFor(() => expect(isSensitiveNavigationBlocked()).toBe(false))
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('skladište: nepoznat ishod može se odbaciti bez automatskog ponavljanja', async () => {
    createWarehouse.mockRejectedValueOnce(new Error('offline'))
    listWarehouses.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(screen.getByLabelText('Naziv skladišta'), 'Skladište Ilidža')
    const form = screen.getByRole('button', { name: 'Novo skladište' }).closest('form')!
    await userEvent.click(within(form).getByRole('button', { name: 'Novo skladište' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Skladište možda već postoji')
    await userEvent.click(within(form).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Naziv skladišta')).toHaveValue('')
    expect(isSensitiveNavigationBlocked()).toBe(false)
    expect(createWarehouse).toHaveBeenCalledTimes(1)
  })

  it('kretanje: samostalan izbor i količina štite firmu i karticu; odbacivanje ne dira nacrt skladišta', async () => {
    listWarehouses.mockResolvedValue({ data: [warehouse(), warehouse({ id: 'w2', name: 'Depo Vogošća' })] })
    listMaterials.mockResolvedValue({ data: [{ id: 'm1', name: 'Šljunak' }, { id: 'm2', name: 'Pijesak' }] })
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const warehouseSelect = await screen.findByLabelText('Skladište')
    const materialSelect = screen.getByLabelText('Materijal')
    const movementForm = screen.getByRole('button', { name: 'Knjiži' }).closest('form')!
    const warehouseForm = screen.getByRole('button', { name: 'Novo skladište' }).closest('form')!
    await userEvent.selectOptions(warehouseSelect, 'w2')
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.selectOptions(warehouseSelect, 'w1')
    expect(isSensitiveNavigationBlocked()).toBe(false)
    await userEvent.selectOptions(materialSelect, 'm2')
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.type(screen.getByLabelText('Količina'), '15.25')
    await userEvent.type(screen.getByLabelText('Naziv skladišta'), 'Drugi nacrt')
    await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
    expect(screen.getByRole('tab', { name: 'Lager' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(within(movementForm).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(materialSelect).toHaveValue('m1')
    expect(screen.getByLabelText('Količina')).toHaveValue('')
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(within(warehouseForm).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(isSensitiveNavigationBlocked()).toBe(false)
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('kretanje: pending i nepoznat ishod ne dozvoljavaju duplo knjiženje bez svjesne potvrde', async () => {
    let reject!: (error: Error) => void
    createStockMovement.mockReturnValueOnce(new Promise((_, fail) => { reject = fail })).mockResolvedValueOnce({})
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const qty = await screen.findByLabelText('Količina')
    const warehouseSelect = screen.getByLabelText('Skladište')
    const materialSelect = screen.getByLabelText('Materijal')
    await userEvent.type(qty, '-5')
    const button = screen.getByRole('button', { name: 'Knjiži' })
    const form = button.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(createStockMovement).toHaveBeenCalledTimes(1)
    expect(createStockMovement).toHaveBeenCalledWith({ warehouseId: 'w1', materialId: 'm1', qty: '-5', idempotencyKey: expect.any(String) })
    const original = createStockMovement.mock.calls[0][0] as { idempotencyKey: string }
    expect(original.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(qty).toBeDisabled()
    expect(warehouseSelect).toBeDisabled()
    expect(materialSelect).toBeDisabled()
    expect(within(form).getByRole('status')).toHaveTextContent('Spremanje je u toku')
    expect(within(form).getByRole('button', { name: 'Odbaci nacrt' })).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: 'Partneri' }))
    expect(screen.getByRole('tab', { name: 'Lager' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { reject(new Error('offline')) })
    expect(within(form).getByRole('alert')).toHaveTextContent('Kretanje je možda već upisano')
    expect(qty).toHaveValue('-5')
    expect(qty).toBeDisabled()
    expect(button).toBeDisabled()
    fireEvent.submit(form)
    expect(createStockMovement).toHaveBeenCalledTimes(1)
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(within(form).getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    expect(qty).toBeDisabled()
    await userEvent.click(button)
    expect(createStockMovement).toHaveBeenCalledTimes(2)
    expect(createStockMovement.mock.calls[1][0]).toEqual(createStockMovement.mock.calls[0][0])
    await waitFor(() => expect(qty).toHaveValue(''))
    await waitFor(() => expect(isSensitiveNavigationBlocked()).toBe(false))
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(createStockMovement).toHaveBeenCalledTimes(2)
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('kretanje čuva izabrane ID-e pri osvježavanju i ne šalje zamjenski ID ako odabir nestane', async () => {
    const w1 = warehouse()
    const w2 = warehouse({ id: 'w2', name: 'Depo Vogošća' })
    const m1 = { id: 'm1', name: 'Šljunak', unit: 'M3' }
    const m2 = { id: 'm2', name: 'Pijesak', unit: 'M3' }
    listWarehouses.mockResolvedValue({ data: [w1, w2] })
    listMaterials.mockResolvedValue({ data: [m1, m2] })
    const { client } = renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const warehouseSelect = await screen.findByLabelText('Skladište')
    const materialSelect = screen.getByLabelText('Materijal')
    await userEvent.selectOptions(warehouseSelect, 'w2')
    await userEvent.selectOptions(materialSelect, 'm2')
    await userEvent.type(screen.getByLabelText('Količina'), '15')
    const form = screen.getByRole('button', { name: 'Knjiži' }).closest('form')!
    act(() => {
      client.setQueryData(['erp-warehouses'], [w2, w1])
      client.setQueryData(['materials'], [m2, m1])
    })
    expect(warehouseSelect).toHaveValue('w2')
    expect(materialSelect).toHaveValue('m2')
    act(() => {
      client.setQueryData(['erp-warehouses'], [])
      client.setQueryData(['materials'], [m1])
    })
    expect(await within(form).findByRole('alert')).toHaveTextContent('više nije dostupno')
    expect(warehouseSelect).toHaveValue('w2')
    expect(materialSelect).toHaveValue('m2')
    expect(screen.getByLabelText('Količina')).toHaveValue('15')
    expect(within(form).getByRole('button', { name: 'Knjiži' })).toBeDisabled()
    fireEvent.submit(form)
    expect(createStockMovement).not.toHaveBeenCalled()
    expect(isSensitiveNavigationBlocked()).toBe(true)
    act(() => { client.setQueryData(['erp-warehouses'], [w1]) })
    await within(warehouseSelect).findByRole('option', { name: 'Depo Ilidža' })
    await userEvent.selectOptions(warehouseSelect, 'w1')
    await userEvent.selectOptions(materialSelect, 'm1')
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(isSensitiveNavigationBlocked()).toBe(false)
    expect(warehouseSelect).toHaveValue('w1')
    expect(materialSelect).toHaveValue('m1')
  })

  it('kretanje zadržava nepoznat ishod ako obje liste nestanu tokom upisa i dozvoljava odbacivanje', async () => {
    let reject!: (error: Error) => void
    createStockMovement.mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
    const { client } = renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const qty = await screen.findByLabelText('Količina')
    await userEvent.type(qty, '5')
    const form = screen.getByRole('button', { name: 'Knjiži' }).closest('form')!
    await userEvent.click(within(form).getByRole('button', { name: 'Knjiži' }))
    act(() => {
      client.setQueryData(['erp-warehouses'], [])
      client.setQueryData(['materials'], [])
    })
    expect(await within(form).findByText(/više nije dostupno/)).toBeInTheDocument()
    await act(async () => { reject(new Error('offline')) })
    expect(within(form).getByText(/Kretanje je možda već upisano/)).toBeInTheDocument()
    expect(qty).toHaveValue('5')
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(within(form).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(screen.queryByRole('button', { name: 'Knjiži' })).not.toBeInTheDocument()
    expect(isSensitiveNavigationBlocked()).toBe(false)
    act(() => {
      client.setQueryData(['erp-warehouses'], [warehouse()])
      client.setQueryData(['materials'], [{ id: 'm1', name: 'Šljunak', unit: 'M3' }])
    })
    expect(await screen.findByLabelText('Količina')).toHaveValue('')
    expect(screen.getByLabelText('Skladište')).toHaveValue('w1')
    expect(createStockMovement).toHaveBeenCalledTimes(1)
  })

  it('kretanje zadržava isti ključ i zaključana polja kroz više neuspjelih pokušaja', async () => {
    createStockMovement.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const qty = await screen.findByLabelText('Količina')
    await userEvent.type(qty, '-2')
    const button = screen.getByRole('button', { name: 'Knjiži' })
    const form = button.closest('form')!
    await userEvent.click(button)
    await within(form).findByRole('alert')
    expect(within(form).getByRole('alert')).toHaveTextContent('Odbacivanje ne otkazuje')
    for (let attempts = 2; attempts <= 3; attempts++) {
      await userEvent.click(within(form).getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
      expect(qty).toBeDisabled()
      await userEvent.click(button)
      await waitFor(() => expect(createStockMovement).toHaveBeenCalledTimes(attempts))
      expect(createStockMovement.mock.calls[attempts - 1][0]).toEqual(createStockMovement.mock.calls[0][0])
      if (attempts === 2) await within(form).findByRole('alert')
    }
    await waitFor(() => expect(qty).toHaveValue(''))
  })

  it('kretanje koristi novi ključ tek za novi unos nakon uspjeha ili odbacivanja', async () => {
    createStockMovement.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const qty = await screen.findByLabelText('Količina')
    await userEvent.type(qty, '10')
    const button = screen.getByRole('button', { name: 'Knjiži' })
    const form = button.closest('form')!
    await userEvent.click(button)
    expect(await within(form).findByRole('alert')).toHaveTextContent('možda već upisano')
    const first = createStockMovement.mock.calls[0][0] as { idempotencyKey: string }
    await userEvent.click(within(form).getByRole('button', { name: 'Odbaci nacrt' }))
    await userEvent.type(qty, '10')
    await userEvent.click(button)
    await waitFor(() => expect(qty).toHaveValue(''))
    const second = createStockMovement.mock.calls[1][0] as { idempotencyKey: string }
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
    await userEvent.type(qty, '10')
    await userEvent.click(button)
    await waitFor(() => expect(createStockMovement).toHaveBeenCalledTimes(3))
    const third = createStockMovement.mock.calls[2][0] as { idempotencyKey: string }
    expect(third.idempotencyKey).not.toBe(second.idempotencyKey)
  })

  it('kretanje ne šalje ništa ako siguran UUID nije dostupan', async () => {
    const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('no secure random') })
    try {
      renderPage()
      await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
      const qty = await screen.findByLabelText('Količina')
      await userEvent.type(qty, '5')
      const form = screen.getByRole('button', { name: 'Knjiži' }).closest('form')!
      await userEvent.click(within(form).getByRole('button', { name: 'Knjiži' }))
      expect(within(form).getByRole('alert')).toHaveTextContent('Knjiženje nije poslano')
      expect(createStockMovement).not.toHaveBeenCalled()
      expect(qty).toHaveValue('5')
      expect(isSensitiveNavigationBlocked()).toBe(true)
    } finally { uuid.mockRestore() }
  })

  it('kretanje ne ponavlja stari ključ nakon promjene korisnika', async () => {
    createStockMovement.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '5')
    const button = screen.getByRole('button', { name: 'Knjiži' })
    const form = button.closest('form')!
    await userEvent.click(button)
    expect(await within(form).findByRole('alert')).toHaveTextContent('možda već upisano')
    act(() => {
      const previous = useAuthStore.getState().user!
      useAuthStore.setState({ user: { ...previous, id: 'u2' } })
    })
    await waitFor(() => expect(screen.getByLabelText('Količina')).toHaveValue(''))
    expect(screen.queryByText(/Knjiženje nije potvrđeno/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Razumijem, omogući novi pokušaj' })).not.toBeInTheDocument()
    expect(createStockMovement).toHaveBeenCalledTimes(1)
  })

  it('kretanje ne ponavlja ključ nakon promjene generacije sesije', async () => {
    createStockMovement.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '5')
    const button = screen.getByRole('button', { name: 'Knjiži' })
    const form = button.closest('form')!
    await userEvent.click(button)
    await within(form).findByRole('alert')
    clearRefreshToken()
    await userEvent.click(within(form).getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await waitFor(() => expect(screen.getByLabelText('Količina')).toHaveValue(''))
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    expect(createStockMovement).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Knjiženje nije potvrđeno/)).not.toBeInTheDocument()
  })

  it('kretanje ne prihvata zakašnjeli uspjeh nakon promjene i povratka firme platform administratora', async () => {
    let resolve!: (value: object) => void
    createStockMovement.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const previous = useAuthStore.getState().user!
    useAuthStore.setState({ user: { ...previous, roles: ['PLATFORM_ADMIN'] } })
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const qty = await screen.findByLabelText('Količina')
    await userEvent.type(qty, '5')
    const button = screen.getByRole('button', { name: 'Knjiži' })
    const form = button.closest('form')!
    await userEvent.click(button)
    act(() => {
      const revision = useCompanyStore.getState().revision
      useCompanyStore.setState({ selectedId: 'c2', revision: revision + 1 })
      useCompanyStore.setState({ selectedId: 'c1', revision: revision + 2 })
      resolve({})
    })
    await waitFor(() => expect(within(form).getByText(/Sesija ili firma su se promijenile/)).toBeInTheDocument())
    expect(qty).toHaveValue('5')
    expect(qty).toBeDisabled()
    await userEvent.click(within(form).getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(button)
    expect(createStockMovement).toHaveBeenCalledTimes(1)
  })

  it('nepotvrđeno kretanje preživi unmount i ponavlja isti payload', async () => {
    createStockMovement.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    const first = renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '8')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await screen.findByText(/Knjiženje nije potvrđeno/)
    const original = createStockMovement.mock.calls[0][0]
    first.unmount()
    renderPage(first.client)
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    expect(await screen.findByText(/Knjiženje nije potvrđeno/)).toBeInTheDocument()
    const qty = screen.getByLabelText('Količina')
    expect(qty).toHaveValue('8')
    expect(qty).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await waitFor(() => expect(qty).toHaveValue(''))
    expect(createStockMovement).toHaveBeenCalledTimes(2)
    expect(createStockMovement.mock.calls[1][0]).toEqual(original)
  })

  it('upis koji je u toku ostaje zaključan kroz unmount, a uspjeh oslobađa povratni prikaz', async () => {
    let resolve!: (value: object) => void
    createStockMovement.mockReturnValueOnce(new Promise((done) => { resolve = done })).mockResolvedValueOnce({})
    const first = renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '9')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    const original = createStockMovement.mock.calls[0][0] as { idempotencyKey: string }
    first.unmount()
    renderPage(first.client)
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    const qty = await screen.findByLabelText('Količina')
    await waitFor(() => expect(qty).toHaveValue('9'))
    expect(qty).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Knjiži' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: 'Knjiži' }).closest('form')!)
    expect(createStockMovement).toHaveBeenCalledTimes(1)
    await act(async () => resolve({}))
    await waitFor(() => expect(qty).toHaveValue(''))
    expect(qty).toBeEnabled()
    await userEvent.type(qty, '9')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    const next = createStockMovement.mock.calls[1][0] as { idempotencyKey: string }
    expect(next.idempotencyKey).not.toBe(original.idempotencyKey)
  })

  it('greška zahtjeva nakon unmounta prebacuje povratni prikaz u oporavak', async () => {
    let reject!: (error: Error) => void
    createStockMovement.mockReturnValueOnce(new Promise((_, fail) => { reject = fail })).mockResolvedValueOnce({})
    const first = renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '6')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    first.unmount()
    renderPage(first.client)
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await act(async () => reject(new Error('offline')))
    await screen.findByText(/Knjiženje nije potvrđeno/)
    expect(screen.getByLabelText('Količina')).toHaveValue('6')
    await userEvent.click(screen.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await waitFor(() => expect(createStockMovement).toHaveBeenCalledTimes(2))
    expect(createStockMovement.mock.calls[1][0]).toEqual(createStockMovement.mock.calls[0][0])
  })

  it('dva istovremena prikaza dijele sinhroni lock i ne mogu poslati paralelan retry', async () => {
    let reject!: (error: Error) => void
    let resolve!: (value: object) => void
    createStockMovement.mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
      .mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const first = renderPage()
    const second = renderPage(first.client)
    const a = within(first.container)
    const b = within(second.container)
    await userEvent.click(a.getByRole('tab', { name: 'Lager' }))
    await userEvent.click(b.getByRole('tab', { name: 'Lager' }))
    const firstQty = await a.findByLabelText('Količina')
    const secondQty = second.container.querySelector<HTMLInputElement>('#movement-qty')!
    await userEvent.type(firstQty, '5')
    fireEvent.change(secondQty, { target: { value: '12' } })
    await userEvent.click(a.getByRole('button', { name: 'Knjiži' }))
    // Even before observer notifications, the shared lock rejects this submission.
    fireEvent.submit(b.getByRole('button', { name: 'Knjiži' }).closest('form')!)
    expect(createStockMovement).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(secondQty).toHaveValue('5'))
    expect(secondQty).toBeDisabled()
    await act(async () => reject(new Error('offline')))
    await a.findByText(/Knjiženje nije potvrđeno/)
    await b.findByText(/Knjiženje nije potvrđeno/)
    await userEvent.click(a.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(b.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    act(() => {
      fireEvent.submit(a.getByRole('button', { name: 'Knjiži' }).closest('form')!)
      fireEvent.submit(b.getByRole('button', { name: 'Knjiži' }).closest('form')!)
    })
    expect(createStockMovement).toHaveBeenCalledTimes(2)
    expect(createStockMovement.mock.calls[1][0]).toEqual(createStockMovement.mock.calls[0][0])
    await act(async () => resolve({}))
    // The second view's separate draft was parked, not discarded.
    await waitFor(() => expect(secondQty).toHaveValue('12'))
    expect(secondQty).toBeEnabled()
  })

  it('prikaz koji ponovi tuđe kretanje vraća svoj privremeno parkirani nacrt', async () => {
    createStockMovement.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    const first = renderPage()
    const second = renderPage(first.client)
    const a = within(first.container)
    const b = within(second.container)
    await userEvent.click(a.getByRole('tab', { name: 'Lager' }))
    await userEvent.click(b.getByRole('tab', { name: 'Lager' }))
    const firstQty = await a.findByLabelText('Količina')
    const secondQty = second.container.querySelector<HTMLInputElement>('#movement-qty')!
    await userEvent.type(firstQty, '5')
    fireEvent.change(secondQty, { target: { value: '12' } })
    await userEvent.click(a.getByRole('button', { name: 'Knjiži' }))
    await b.findByText(/Knjiženje nije potvrđeno/)
    await userEvent.click(b.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(b.getByRole('button', { name: 'Knjiži' }))
    await waitFor(() => expect(secondQty).toHaveValue('12'))
    expect(secondQty).toBeEnabled()
    expect(createStockMovement.mock.calls[1][0]).toEqual(createStockMovement.mock.calls[0][0])
  })

  it('prikaz koji odbaci tuđe kretanje vraća svoj privremeno parkirani nacrt', async () => {
    createStockMovement.mockRejectedValueOnce(new Error('offline'))
    const first = renderPage()
    const second = renderPage(first.client)
    const a = within(first.container)
    const b = within(second.container)
    await userEvent.click(a.getByRole('tab', { name: 'Lager' }))
    await userEvent.click(b.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await a.findByLabelText('Količina'), '5')
    const secondQty = second.container.querySelector<HTMLInputElement>('#movement-qty')!
    fireEvent.change(secondQty, { target: { value: '12' } })
    await userEvent.click(a.getByRole('button', { name: 'Knjiži' }))
    await b.findByText(/Knjiženje nije potvrđeno/)
    await userEvent.click(b.getByRole('button', { name: 'Odbaci nacrt' }))
    await waitFor(() => expect(secondQty).toHaveValue('12'))
    expect(secondQty).toBeEnabled()
    expect(createStockMovement).toHaveBeenCalledTimes(1)
  })

  it('brisanje keša tokom upisa ne dozvoljava zakašnjelom odgovoru da vrati oporavak', async () => {
    let reject!: (error: Error) => void
    createStockMovement.mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
    const first = renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    expect(first.client.getQueriesData({ queryKey: [STOCK_MOVEMENT_PENDING_QUERY] }).some(([, value]) => value)).toBe(true)
    first.unmount()
    first.client.clear()
    clearRefreshToken()
    await act(async () => reject(new Error('offline')))
    expect(first.client.getQueriesData({ queryKey: [STOCK_MOVEMENT_PENDING_QUERY] })).toHaveLength(0)
    renderPage(first.client)
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    expect(await screen.findByLabelText('Količina')).toHaveValue('')
    expect(screen.queryByText(/Knjiženje nije potvrđeno/)).not.toBeInTheDocument()
  })

  it('promjena firme bez nacrta dopušta novi unos u novom kontekstu', async () => {
    const user = useAuthStore.getState().user!
    useAuthStore.setState({ user: { ...user, roles: ['PLATFORM_ADMIN'] } })
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await screen.findByLabelText('Količina')
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
    const qty = await screen.findByLabelText('Količina')
    await userEvent.type(qty, '8')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await waitFor(() => expect(createStockMovement).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Sesija ili firma su se promijenile/)).not.toBeInTheDocument()
  })

  it('oporavci firmi ne prenose ni privremeno parkirani nacrt u drugu firmu', async () => {
    const user = useAuthStore.getState().user!
    useAuthStore.setState({ user: { ...user, roles: ['PLATFORM_ADMIN'] } })
    createStockMovement.mockRejectedValue(new Error('offline'))
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await screen.findByText(/Knjiženje nije potvrđeno/)
    // Model an external/context race, bypassing the normal UI switch lock.
    act(() => useCompanyStore.setState((state) => ({ selectedId: 'c2', revision: state.revision + 1 })))
    await waitFor(() => expect(screen.getByLabelText('Količina')).toHaveValue(''))
    expect(screen.queryByText(/Knjiženje nije potvrđeno/)).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Količina'), '7')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await screen.findByText(/Knjiženje nije potvrđeno/)
    act(() => useCompanyStore.setState((state) => ({ selectedId: 'c1', revision: state.revision + 1 })))
    await waitFor(() => expect(screen.getByLabelText('Količina')).toHaveValue('5'))
    await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
    await waitFor(() => expect(screen.getByLabelText('Količina')).toHaveValue(''))
    act(() => useCompanyStore.setState((state) => ({ selectedId: 'c2', revision: state.revision + 1 })))
    await waitFor(() => expect(screen.getByLabelText('Količina')).toHaveValue('7'))
    await userEvent.click(screen.getByRole('button', { name: 'Odbaci nacrt' }))
    await waitFor(() => expect(screen.getByLabelText('Količina')).toHaveValue(''))
    expect(createStockMovement).toHaveBeenCalledTimes(2)
  })

  it('zakašnjeli odgovor firme A ne otključava upis koji je u toku u firmi B', async () => {
    const user = useAuthStore.getState().user!
    useAuthStore.setState({ user: { ...user, roles: ['PLATFORM_ADMIN'] } })
    let resolveA!: (value: object) => void
    let resolveB!: (value: object) => void
    createStockMovement.mockReturnValueOnce(new Promise((done) => { resolveA = done }))
      .mockReturnValueOnce(new Promise((done) => { resolveB = done }))
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    act(() => useCompanyStore.setState((state) => ({ selectedId: 'c2', revision: state.revision + 1 })))
    await waitFor(() => expect(screen.getByLabelText('Količina')).toHaveValue(''))
    await userEvent.type(screen.getByLabelText('Količina'), '7')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await act(async () => resolveA({}))
    const qty = screen.getByLabelText('Količina')
    expect(qty).toHaveValue('7')
    expect(qty).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Knjiži' })).toBeDisabled()
    expect(createStockMovement).toHaveBeenCalledTimes(2)
    await act(async () => resolveB({}))
    await waitFor(() => expect(qty).toHaveValue(''))
  })

  it('povratak platform administratora na istu firmu prikazuje oporavak ali ne ponavlja stari kontekst', async () => {
    const user = useAuthStore.getState().user!
    useAuthStore.setState({ user: { ...user, roles: ['PLATFORM_ADMIN'] } })
    createStockMovement.mockRejectedValueOnce(new Error('offline'))
    const first = renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(await screen.findByLabelText('Količina'), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await screen.findByText(/Knjiženje nije potvrđeno/)
    first.unmount()
    act(() => {
      expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true)
      expect(useCompanyStore.getState().setSelectedId('c1')).toBe(true)
    })
    renderPage(first.client)
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await screen.findByText(/Knjiženje nije potvrđeno/)
    await userEvent.click(screen.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    expect(screen.getByText(/Sesija ili firma su se promijenile/)).toBeInTheDocument()
    expect(createStockMovement).toHaveBeenCalledTimes(1)
  })

  it('paralelna kreiranja skladišta i kretanja ne otključavaju jedno drugo', async () => {
    let finishWarehouse!: (value: object) => void
    let finishMovement!: (value: object) => void
    createWarehouse.mockReturnValueOnce(new Promise((resolve) => { finishWarehouse = resolve }))
    createStockMovement.mockReturnValueOnce(new Promise((resolve) => { finishMovement = resolve }))
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Lager' }))
    await userEvent.type(screen.getByLabelText('Naziv skladišta'), 'Novi depo')
    await userEvent.type(await screen.findByLabelText('Količina'), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Novo skladište' }))
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    await act(async () => { finishWarehouse({}) })
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    expect(isSensitiveNavigationBlocked()).toBe(true)
    await userEvent.click(screen.getByRole('tab', { name: 'Troškovi' }))
    expect(screen.getByRole('tab', { name: 'Lager' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { finishMovement({}) })
    await waitFor(() => expect(isSensitiveNavigationBlocked()).toBe(false))
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('lager: bez skladišta objašnjava šta nedostaje i ne nudi knjiženje', async () => {
    listWarehouses.mockResolvedValue({ data: [], meta: { total: 0 } })
    listStock.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Lager' }))

    expect(await screen.findByText('Nema skladišta — dodajte prvo skladište.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Knjiži' })).not.toBeInTheDocument()
  })

  it('kreiranje troška šalje iznos, kategoriju i datum', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Troškovi' }))

    await userEvent.type(await screen.findByLabelText('Iznos troška'), '450.50')
    await userEvent.selectOptions(screen.getByLabelText('Kategorija troška'), 'FUEL')
    await userEvent.type(screen.getByLabelText('Datum troška'), '2026-11-02')
    await userEvent.click(screen.getByRole('button', { name: 'Novi trošak' }))

    expect(createCostEntry).toHaveBeenCalledWith({ amount: '450.50', category: 'FUEL', date: '2026-11-02' })
  })

  it('„Iz obračuna“ šalje godinu i mjesec', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Troškovi' }))

    const year = new Date().getFullYear()
    const month = new Date().getMonth() + 1
    await userEvent.click(await screen.findByRole('button', { name: 'Iz obračuna' }))

    expect(fromPayroll).toHaveBeenCalledWith({ year, month })
  })

  it('greška na formi ne ruši ekran (toast, bez reload-a)', async () => {
    createCostEntry.mockRejectedValueOnce(new Error('odbijeno'))
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Troškovi' }))

    await userEvent.type(await screen.findByLabelText('Iznos troška'), '10')
    await userEvent.type(screen.getByLabelText('Datum troška'), '2026-11-02')
    await userEvent.click(screen.getByRole('button', { name: 'Novi trošak' }))

    expect(createCostEntry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Novi trošak' })).toBeInTheDocument()
  })

  it('lager: kreiranje skladišta i knjiženje kretanja šalju očekivana polja', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Lager' }))

    await userEvent.type(await screen.findByLabelText('Naziv skladišta'), 'Cisterna 2')
    await userEvent.selectOptions(screen.getByLabelText('Tip'), 'CISTERN')
    await userEvent.click(screen.getByRole('button', { name: 'Novo skladište' }))
    expect(createWarehouse).toHaveBeenCalledWith({ name: 'Cisterna 2', type: 'CISTERN' })

    await userEvent.type(screen.getByLabelText('Količina'), '7.25')
    await userEvent.click(screen.getByRole('button', { name: 'Knjiži' }))
    expect(createStockMovement).toHaveBeenCalledWith({ warehouseId: 'w1', materialId: 'm1', qty: '7.25', idempotencyKey: expect.any(String) })
  })

  it('bez erp.write nema formi, samo pregled', async () => {
    useAuthStore.setState({
      user: {
        id: 'u1',
        firstName: 'A',
        lastName: 'B',
        employeeCode: null,
        email: 'a@b.c',
        roles: ['WORKER'],
        permissions: ['erp.read'],
        companyId: 'c1',
        company: null,
        hourlyRate: null,
        mustChangePassword: false,
        locale: 'bs',
      },
      accessToken: 't',
      ready: true,
    })
    renderPage()

    expect(await screen.findByText('Općina Ilidža')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novi partner' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Naziv partnera')).not.toBeInTheDocument()
  })

  it('kreiranje partnera šalje tip i naziv', async () => {
    renderPage()

    await userEvent.type(await screen.findByLabelText('Naziv partnera'), 'JP Autoceste')
    await userEvent.selectOptions(screen.getByLabelText('Tip'), 'SUPPLIER')
    await userEvent.click(screen.getByRole('button', { name: 'Novi partner' }))

    expect(createPartner).toHaveBeenCalledWith({
      type: 'SUPPLIER',
      name: 'JP Autoceste',
    })
  })
})
