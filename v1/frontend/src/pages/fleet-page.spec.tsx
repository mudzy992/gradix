import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MachineRow } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { FleetPage } from '@/pages/fleet-page'

/**
 * FE-09 — flota. Drži ono što je prije falilo: preveden tip i status (prije `EXCAVATOR`,
 * `IN_SERVICE`), ton badge-a koji nosi značenje, sate kao „1.234,5 h“ umjesto `1234.500`,
 * stanja (skeleton/greška/prazno) i pristupačno ime `select`-a za dodjelu.
 */
const listMachines = vi.fn()
const listProjects = vi.fn()
const createMachine = vi.fn()
const assignMachine = vi.fn()
const unassignMachine = vi.fn()

vi.mock('@/lib/api-fleet', () => ({
  listMachines: (query: unknown) => listMachines(query),
  createMachine: (body: unknown) => createMachine(body),
  assignMachine: (id: string, body: unknown) => assignMachine(id, body),
  unassignMachine: (id: string) => unassignMachine(id),
}))

vi.mock('@/lib/api-ops', () => ({
  listProjects: (query: unknown) => listProjects(query),
}))

function machine(overrides: Partial<MachineRow> = {}): MachineRow {
  return {
    id: 'm1',
    name: 'Kiper 1',
    code: 'CAM-1',
    type: 'TRUCK',
    status: 'IDLE',
    currentWorkingHours: '1234.500',
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
        <FleetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function signIn(permissions: string[] = ['fleet.read', 'fleet.write', 'fleet.map']) {
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ADMIN'],
      permissions,
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
}

beforeEach(() => {
  listMachines.mockReset()
  listProjects.mockReset().mockResolvedValue({ data: [{ id: 'p1', name: 'Sarajevo obilaznica' }], meta: { total: 1 } })
  createMachine.mockReset()
  assignMachine.mockReset()
  unassignMachine.mockReset().mockResolvedValue({})
  signIn()
})

describe('FleetPage', () => {
  it('prikazuje preveden tip i status, sate u čitljivom formatu i ukupan broj', async () => {
    listMachines.mockResolvedValue({
      data: [machine({ status: 'IN_SERVICE', type: 'EXCAVATOR', currentWorkingHours: '1234.500' })],
      meta: { total: 1 },
    })
    renderPage()

    expect(await screen.findByText('Bager')).toBeInTheDocument()
    expect(screen.getByText('Na servisu')).toBeInTheDocument()
    expect(screen.getByText('1.234,5 h')).toBeInTheDocument()
    expect(screen.getByText('Mašina: 1')).toBeInTheDocument()
    expect(screen.queryByText('EXCAVATOR')).not.toBeInTheDocument()
    expect(screen.queryByText('IN_SERVICE')).not.toBeInTheDocument()
    expect(screen.queryByText('1234.500')).not.toBeInTheDocument()
  })

  it('dok se učitava prikazuje skeleton i aria-busy', () => {
    listMachines.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('prazna flota ima uputu, a ne praznu tabelu', async () => {
    listMachines.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    expect(await screen.findByText('Nema mašina u floti.')).toBeInTheDocument()
    expect(screen.getByText(/Dodajte prvu mašinu/)).toBeInTheDocument()
  })

  it('greška je trajna, sa ponovnim pokušajem koji opet pita API', async () => {
    listMachines.mockRejectedValueOnce(new Error('mreža'))
    listMachines.mockResolvedValueOnce({ data: [machine()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Flota se nije učitala.')

    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Kiper 1')).toBeInTheDocument()
    expect(listMachines).toHaveBeenCalledTimes(2)
  })

  it('select za dodjelu ima pristupačno ime sa nazivom mašine', async () => {
    listMachines.mockResolvedValue({ data: [machine({ status: 'IDLE' })], meta: { total: 1 } })
    renderPage()

    const select = await screen.findByLabelText('Dodijeli mašinu Kiper 1 na projekat')
    await userEvent.selectOptions(select, 'p1')
    expect(assignMachine).toHaveBeenCalledWith('m1', { projectId: 'p1' })
  })

  it('aktivna mašina nudi „Skini“ umjesto dodjele', async () => {
    listMachines.mockResolvedValue({ data: [machine({ status: 'ACTIVE' })], meta: { total: 1 } })
    renderPage()

    const unassign = await screen.findByRole('button', { name: 'Skini' })
    await userEvent.click(unassign)
    expect(unassignMachine).toHaveBeenCalledWith('m1')
  })

  it('forma za novu mašinu nudi prevedene tipove', async () => {
    listMachines.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Nova mašina' }))
    const type = await screen.findByLabelText('Tip')
    expect(within(type).getByRole('option', { name: 'Kamion' })).toBeInTheDocument()
    expect(within(type).getByRole('option', { name: 'Bager' })).toBeInTheDocument()
    expect(within(type).queryByRole('option', { name: 'TRUCK' })).not.toBeInTheDocument()
  })
})
