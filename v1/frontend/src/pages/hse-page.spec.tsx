import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncidentRow } from '@/lib/ops-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { HsePage } from '@/pages/hse-page'

/**
 * FE-10 — HSE prijave. Drži: prevedenu ozbiljnost i status (prije `LOW`, `OPEN`, `ACK`), ton badge-a,
 * akcije samo uz `hse.write` (prije su ih vidjeli svi koji vide listu), stanja liste i poruku kad se
 * prijava ne može poslati.
 */
const listIncidents = vi.fn()
const listProjects = vi.fn()
const patchIncident = vi.fn()
const createIncident = vi.fn()

vi.mock('@/lib/api-ops', () => ({
  listIncidents: (query: unknown) => listIncidents(query),
  listProjects: (query: unknown) => listProjects(query),
  patchIncident: (id: string, status: string) => patchIncident(id, status),
  createIncident: (body: unknown) => createIncident(body),
}))

function incident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: 'i1',
    projectId: 'p1',
    severity: 'HIGH',
    description: 'Rad bez kacige na skeli',
    status: 'OPEN',
    createdAt: '2026-11-02T08:00:00.000Z',
    photos: [],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HsePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function signIn(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['WORKER'],
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
  listIncidents.mockReset()
  listProjects.mockReset().mockResolvedValue({ data: [], meta: { total: 0 } })
  patchIncident.mockReset().mockResolvedValue({})
  createIncident.mockReset().mockResolvedValue({})
  signIn(['hse.read', 'hse.write'])
})

describe('HsePage', () => {
  it('prikazuje prevedenu ozbiljnost i status, bez sirovih enuma', async () => {
    listIncidents.mockResolvedValue({ data: [incident()], meta: { total: 1 } })
    renderPage()

    expect(await screen.findByText('Visoka')).toBeInTheDocument()
    expect(screen.getByText('Otvorena')).toBeInTheDocument()
    expect(screen.getByText('Prijava: 1')).toBeInTheDocument()
    expect(screen.queryByText('HIGH')).not.toBeInTheDocument()
    expect(screen.queryByText('OPEN')).not.toBeInTheDocument()
  })

  it('dok se učitava prikazuje skeleton i aria-busy', () => {
    listIncidents.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('prazna lista ima uputu', async () => {
    listIncidents.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    expect(await screen.findByText('Nema HSE prijava.')).toBeInTheDocument()
    expect(screen.getByText(/Prijavite incident/)).toBeInTheDocument()
  })

  it('greška je trajna i nudi ponovni pokušaj', async () => {
    listIncidents.mockRejectedValueOnce(new Error('mreža'))
    listIncidents.mockResolvedValueOnce({ data: [incident()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('HSE prijave se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Visoka')).toBeInTheDocument()
  })

  it('bez `hse.write` nema dugmadi za potvrdu ni zatvaranje', async () => {
    signIn(['hse.read'])
    listIncidents.mockResolvedValue({ data: [incident()], meta: { total: 1 } })
    renderPage()

    await screen.findByText('Otvorena')
    expect(screen.queryByRole('button', { name: 'Potvrdi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zatvori' })).not.toBeInTheDocument()
  })

  it('potvrda mijenja status preko API-ja', async () => {
    listIncidents.mockResolvedValue({ data: [incident()], meta: { total: 1 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Potvrdi' }))
    expect(patchIncident).toHaveBeenCalledWith('i1', 'ACK')
  })

  it('prijava bez opisa ne odlazi na API i pokazuje grešku polja', async () => {
    listIncidents.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Prijava' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    expect(createIncident).not.toHaveBeenCalled()
    expect(await screen.findByText('Obavezno polje.')).toBeInTheDocument()
  })

  it('forma nudi prevedene nivoe ozbiljnosti', async () => {
    listIncidents.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Prijava' }))
    const severity = await screen.findByLabelText('Ozbiljnost')
    expect(within(severity).getByRole('option', { name: 'Niska' })).toBeInTheDocument()
    expect(within(severity).getByRole('option', { name: 'Visoka' })).toBeInTheDocument()
    expect(within(severity).queryByRole('option', { name: 'HIGH' })).not.toBeInTheDocument()
  })

  it('zatvaranje prijave mijenja status na CLOSED', async () => {
    listIncidents.mockResolvedValue({ data: [incident({ status: 'ACK' })], meta: { total: 1 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Zatvori' }))
    expect(patchIncident).toHaveBeenCalledWith('i1', 'CLOSED')
  })

  it('forma šalje opis, nivo i projekat', async () => {
    listIncidents.mockResolvedValue({ data: [], meta: { total: 0 } })
    listProjects.mockResolvedValue({ data: [{ id: 'p1', name: 'Sarajevo obilaznica' }], meta: { total: 1 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Prijava' }))
    await userEvent.type(await screen.findByLabelText('Opis'), 'Klizav prilaz')
    await userEvent.selectOptions(screen.getByLabelText('Ozbiljnost'), 'HIGH')
    await userEvent.selectOptions(await screen.findByLabelText('Projekat'), 'p1')
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))

    expect(createIncident).toHaveBeenCalledWith({
      description: 'Klizav prilaz',
      severity: 'HIGH',
      projectId: 'p1',
    })
  })
})
