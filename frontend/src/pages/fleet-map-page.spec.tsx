import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MachineRow } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { FleetMapPage } from '@/pages/fleet-map-page'

/**
 * FE-09 — mapa flote. `react-leaflet` se zamjenjuje jednostavnim `div`-ovima: u jsdom-u nema
 * layouta ni WebGL-a, a ovdje se ne testira crtanje nego **sadržaj** (prevedeni status/izvor GPS-a,
 * tekstualna lista ispod mape, stanja).
 */
const listMachines = vi.fn()

vi.mock('@/lib/api-fleet', () => ({
  listMachines: (query: unknown) => listMachines(query),
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => <div data-testid="pin">{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

function machine(overrides: Partial<MachineRow> = {}): MachineRow {
  return {
    id: 'm1',
    name: 'Kiper 1',
    code: 'CAM-1',
    type: 'TRUCK',
    status: 'ACTIVE',
    currentWorkingHours: '12.000',
    lastLat: '43.8563000',
    lastLng: '18.4131000',
    lastGpsAt: '2026-11-03T08:00:00.000Z',
    lastGpsSource: 'IOT',
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FleetMapPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listMachines.mockReset()
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ADMIN'],
      permissions: ['fleet.read', 'fleet.map'],
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

describe('FleetMapPage', () => {
  it('prikazuje preveden status i izvor GPS-a, bez sirovih enuma', async () => {
    listMachines.mockResolvedValue({ data: [machine()], meta: { total: 1 } })
    renderPage()

    expect(await screen.findByText('Na mapi: 1')).toBeInTheDocument()
    const pin = screen.getByTestId('pin')
    expect(pin).toHaveTextContent('Kiper 1 · Aktivna · IoT uređaj')
    expect(screen.queryByText(/ACTIVE/)).not.toBeInTheDocument()
    expect(screen.queryByText(/IOT/)).not.toBeInTheDocument()
  })

  it('mapa ima tekstualnu listu istih mašina (čitljivo bez vida)', async () => {
    listMachines.mockResolvedValue({ data: [machine()], meta: { total: 1 } })
    renderPage()

    const section = await screen.findByRole('region', { name: 'Mašine sa GPS pozicijom' })
    // Tekst je razbijen na više čvorova (naziv · status), pa se provjerava sadržaj stavke.
    expect(await within(section).findByRole('listitem')).toHaveTextContent('Kiper 1 · Aktivna')
  })

  it('mašina bez GPS-a ne pravi pin i objašnjava prazno stanje', async () => {
    listMachines.mockResolvedValue({ data: [machine({ lastLat: null, lastLng: null })], meta: { total: 1 } })
    renderPage()

    expect(await screen.findByText('Nijedna mašina još nema GPS poziciju.')).toBeInTheDocument()
    expect(screen.queryByTestId('pin')).not.toBeInTheDocument()
  })

  it('greška je trajna i nudi ponovni pokušaj', async () => {
    listMachines.mockRejectedValueOnce(new Error('mreža'))
    listMachines.mockResolvedValueOnce({ data: [machine()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Flota se nije učitala.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Na mapi: 1')).toBeInTheDocument()
  })
})
