import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogRow, TripRow } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { LogisticsPage } from '@/pages/logistics-page'

/**
 * FE-09 — logistika. Drži: preveden status ture (prije `LOADED`/`UNLOADED`), jedinicu materijala
 * (prije `M3`), stanja liste tura i prazne liste materijala/deponija, te labele na poljima za
 * dodavanje (prije samo `placeholder`).
 */
const listTrips = vi.fn()
const listMaterials = vi.fn()
const listDepots = vi.fn()
const createMaterial = vi.fn()
const createDepot = vi.fn()

vi.mock('@/lib/api-fleet', () => ({
  listTrips: (query: unknown) => listTrips(query),
  listMaterials: () => listMaterials(),
  listDepots: () => listDepots(),
  createMaterial: (body: unknown) => createMaterial(body),
  createDepot: (body: unknown) => createDepot(body),
}))

function trip(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: 't1',
    driverId: 'd1',
    projectId: 'p1',
    machineId: 'm1',
    materialId: 'mat1',
    quantity: '12.500',
    originText: 'Pozajmica Ilidža',
    unloadedAt: null,
    loadedAt: '2026-11-03T08:00:00.000Z',
    ...overrides,
  }
}

function catalog(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return { id: 'c1', name: 'Šljunak', unit: 'M3', ...overrides }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LogisticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listTrips.mockReset()
  listMaterials.mockReset().mockResolvedValue({ data: [catalog()], meta: { total: 1 } })
  listDepots.mockReset().mockResolvedValue({ data: [{ id: 'd1', name: 'Deponija Ilidža' }], meta: { total: 1 } })
  createMaterial.mockReset().mockResolvedValue(catalog())
  createDepot.mockReset().mockResolvedValue({ id: 'd2', name: 'Nova deponija' })
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ADMIN'],
      permissions: ['trips.read', 'trips.write'],
      companyId: 'c1',
      company: null,
      hourlyRate: null,
      mustChangePassword: false,
      locale: 'bs',
    },
    accessToken: 'ready',
    ready: true,
  })
  useCompanyStore.setState({ selectedId: 'c1' })
})

describe('LogisticsPage', () => {
  it('prikazuje preveden status ture i ukupan broj, bez sirovih enuma', async () => {
    listTrips.mockResolvedValue({
      data: [trip(), trip({ id: 't2', unloadedAt: '2026-11-03T09:00:00.000Z' })],
      meta: { total: 2 },
    })
    renderPage()

    expect(await screen.findByText('Utovareno')).toBeInTheDocument()
    expect(screen.getByText('Istovareno')).toBeInTheDocument()
    expect(screen.getByText('Tura: 2')).toBeInTheDocument()
    expect(screen.queryByText('LOADED')).not.toBeInTheDocument()
    expect(screen.queryByText('UNLOADED')).not.toBeInTheDocument()
  })

  it('prazna lista tura ima uputu', async () => {
    listTrips.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    expect(await screen.findByText('Nema evidentiranih tura.')).toBeInTheDocument()
    expect(screen.getByText(/Ture nastaju kad vozač/)).toBeInTheDocument()
  })

  it('greška tura je trajna i nudi ponovni pokušaj', async () => {
    listTrips.mockRejectedValueOnce(new Error('mreža'))
    listTrips.mockResolvedValueOnce({ data: [trip()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Ture se nisu učitale.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Utovareno')).toBeInTheDocument()
  })

  it('materijal prikazuje prevedenu jedinicu, a prazne deponije poruku', async () => {
    listTrips.mockResolvedValue({ data: [], meta: { total: 0 } })
    listDepots.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    const materials = await screen.findByRole('region', { name: 'Materijali' })
    expect(await within(materials).findByRole('listitem')).toHaveTextContent('Šljunak · m³')
    const depots = screen.getByRole('region', { name: 'Deponije' })
    expect(within(depots).getByText('Nema deponija.')).toBeInTheDocument()
  })

  it('štiti oba nezavisna nacrta i oslobađa izbor tek kada su oba odbačena', async () => {
    listTrips.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    const materials = screen.getByRole('region', { name: 'Materijali' })
    const depots = screen.getByRole('region', { name: 'Deponije' })
    await userEvent.selectOptions(screen.getByLabelText('Jedinica'), 'PCS')
    await userEvent.type(screen.getByLabelText('Naziv deponije'), 'Nova')
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(within(materials).getByRole('button', { name: 'Odbaci nacrt' }))
    expect(screen.getByLabelText('Jedinica')).toHaveValue('T')
    expect(screen.getByLabelText('Naziv deponije')).toHaveValue('Nova')
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(within(depots).getByRole('button', { name: 'Odbaci nacrt' }))
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('čeka kreiranje materijala, sprečava dupliranje i čuva nacrt kod greške', async () => {
    listTrips.mockResolvedValue({ data: [], meta: { total: 0 } })
    let reject!: (error: Error) => void
    createMaterial.mockReturnValue(new Promise((_, fail) => { reject = fail }))
    renderPage()
    const materials = screen.getByRole('region', { name: 'Materijali' })
    await userEvent.type(screen.getByLabelText('Naziv materijala'), 'Pijesak')
    await userEvent.click(within(materials).getByRole('button', { name: 'Sačuvaj' }))
    expect(within(materials).getByRole('button', { name: 'Sačuvaj' })).toBeDisabled()
    expect(within(materials).getByRole('button', { name: 'Odbaci nacrt' })).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    expect(createMaterial).toHaveBeenCalledOnce()
    await act(async () => { reject(new Error('offline')) })
    await waitFor(() => expect(within(materials).getByRole('button', { name: 'Odbaci nacrt' })).toBeEnabled())
    expect(screen.getByLabelText('Naziv materijala')).toHaveValue('Pijesak')
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(within(materials).getByRole('button', { name: 'Odbaci nacrt' }))
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('deponija blokira promjenu tokom zahtjeva i oslobađa je nakon uspjeha', async () => {
    listTrips.mockResolvedValue({ data: [], meta: { total: 0 } })
    let resolve!: () => void
    createDepot.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    renderPage()
    const depots = screen.getByRole('region', { name: 'Deponije' })
    await userEvent.type(screen.getByLabelText('Naziv deponije'), 'Nova')
    await userEvent.click(within(depots).getByRole('button', { name: 'Sačuvaj' }))
    expect(screen.getByLabelText('Naziv deponije')).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await act(async () => { resolve() })
    await waitFor(() => expect(screen.getByLabelText('Naziv deponije')).toBeEnabled())
    expect(screen.getByLabelText('Naziv deponije')).toHaveValue('')
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('polja za dodavanje imaju labele i šalju jedinicu', async () => {
    listTrips.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    const name = await screen.findByLabelText('Naziv materijala')
    await userEvent.type(name, 'Pijesak')
    await userEvent.selectOptions(screen.getByLabelText('Jedinica'), 'PCS')
    await userEvent.click(within(screen.getByRole('region', { name: 'Materijali' })).getByRole('button', { name: 'Sačuvaj' }))
    expect(createMaterial).toHaveBeenCalledWith({ name: 'Pijesak', unit: 'PCS' })

    await userEvent.type(screen.getByLabelText('Naziv deponije'), 'Deponija Vogošća')
    await userEvent.click(within(screen.getByRole('region', { name: 'Deponije' })).getByRole('button', { name: 'Sačuvaj' }))
    expect(createDepot).toHaveBeenCalledWith({ name: 'Deponija Vogošća' })
  })
})
