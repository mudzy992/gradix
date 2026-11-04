import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CostRow, PartnerRow, StockRow, WarehouseRow } from '@/lib/api-erp'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { ErpPage } from '@/pages/erp-page'

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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ErpPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
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
    expect(createStockMovement).toHaveBeenCalledWith({ warehouseId: 'w1', materialId: 'm1', qty: '7.25' })
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
