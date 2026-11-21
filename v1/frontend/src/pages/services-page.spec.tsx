import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceRow } from '@/lib/api-polish'
import type { MachineRow } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { ServicesPage } from '@/pages/services-page'

/**
 * FE-11 — servisni nalozi. Drži: preveden status sa tonom (prije `PLANNED`/`IN_PROGRESS`), **naziv**
 * mašine umjesto CUID-a, trošak, broj/prazno/grešku i akcije koje mijenjaju nalog.
 */
const listServices = vi.fn()
const listMachines = vi.fn()
const startService = vi.fn()
const completeService = vi.fn()
const cancelService = vi.fn()
const createService = vi.fn()

vi.mock('@/lib/api-polish', () => ({
  listServices: (query: unknown) => listServices(query),
  startService: (id: string) => startService(id),
  completeService: (id: string) => completeService(id),
  cancelService: (id: string) => cancelService(id),
  createService: (body: unknown) => createService(body),
}))

vi.mock('@/lib/api-fleet', () => ({
  listMachines: (query: unknown) => listMachines(query),
}))

function service(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 's1',
    machineId: 'cmachine000000000000001',
    projectId: null,
    status: 'SCHEDULED',
    totalCost: '450.50',
    note: null,
    ...overrides,
  }
}

function machine(overrides: Partial<MachineRow> = {}): MachineRow {
  return {
    id: 'cmachine000000000000001',
    name: 'Kiper 1',
    code: 'CAM-1',
    type: 'TRUCK',
    status: 'ACTIVE',
    currentWorkingHours: '12.000',
    lastLat: null,
    lastLng: null,
    lastGpsAt: null,
    lastGpsSource: null,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ServicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listServices.mockReset()
  listMachines.mockReset().mockResolvedValue({ data: [machine()], meta: { total: 1 } })
  startService.mockReset().mockResolvedValue({})
  completeService.mockReset().mockResolvedValue({})
  cancelService.mockReset().mockResolvedValue({})
  createService.mockReset().mockResolvedValue({})
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['MECHANIC'],
      permissions: ['services.read', 'services.write', 'fleet.read'],
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

describe('ServicesPage', () => {
  it('prikazuje preveden status, naziv mašine i trošak', async () => {
    listServices.mockResolvedValue({ data: [service()], meta: { total: 1 } })
    renderPage()

    expect(await screen.findByText('Zakazan')).toBeInTheDocument()
    expect(screen.getByText('Kiper 1')).toBeInTheDocument()
    expect(screen.getByText('Trošak: 450,50')).toBeInTheDocument()
    expect(screen.getByText('Servisa: 1')).toBeInTheDocument()
    expect(screen.queryByText('SCHEDULED')).not.toBeInTheDocument()
    expect(screen.queryByText('cmachine000000000000001')).not.toBeInTheDocument()
  })

  it('prazna lista ima uputu', async () => {
    listServices.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    expect(await screen.findByText('Nema servisnih naloga.')).toBeInTheDocument()
    expect(screen.getByText(/Planirajte servis/)).toBeInTheDocument()
  })

  it('dok se učitava prikazuje skeleton sa aria-busy', () => {
    listServices.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('greška je trajna i nudi ponovni pokušaj', async () => {
    listServices.mockRejectedValueOnce(new Error('mreža'))
    listServices.mockResolvedValueOnce({ data: [service()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Servisni nalozi se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Zakazan')).toBeInTheDocument()
  })

  it('start mijenja nalog, a „Otkaži“ je dostupan samo u toku', async () => {
    listServices.mockResolvedValue({ data: [service()], meta: { total: 1 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
    expect(startService).toHaveBeenCalledWith('s1')
    expect(screen.queryByRole('button', { name: 'Otkaži' })).not.toBeInTheDocument()
  })

  it('nalog u toku nudi završetak i otkazivanje', async () => {
    listServices.mockResolvedValue({ data: [service({ status: 'IN_PROGRESS' })], meta: { total: 1 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Završi' }))
    expect(completeService).toHaveBeenCalledWith('s1')
    await userEvent.click(screen.getByRole('button', { name: 'Otkaži' }))
    expect(cancelService).toHaveBeenCalledWith('s1')
  })

  it('bez izabrane mašine forma ne odlazi na API', async () => {
    listServices.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Planiraj servis' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    expect(createService).not.toHaveBeenCalled()
    expect(await screen.findByText('Obavezno polje.')).toBeInTheDocument()
  })
})
