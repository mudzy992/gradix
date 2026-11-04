import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenderRow } from '@/lib/api-polish'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { TendersPage } from '@/pages/tenders-page'

/**
 * FE-11 — tenderi. Drži: broj po koloni, prazno stanje kolone, prevedene nazive kolona, formatirane
 * iznose (prije `12000.00`) i stanja (skeleton/greška + retry).
 */
const listTenders = vi.fn()
const patchTender = vi.fn()
const convertTender = vi.fn()
const createTender = vi.fn()

vi.mock('@/lib/api-polish', () => ({
  listTenders: (query: unknown) => listTenders(query),
  patchTender: (id: string, body: unknown) => patchTender(id, body),
  convertTender: (id: string) => convertTender(id),
  createTender: (body: unknown) => createTender(body),
}))

function tender(overrides: Partial<TenderRow> = {}): TenderRow {
  return {
    id: 't1',
    title: 'Rekonstrukcija mosta',
    client: 'Općina Ilidža',
    submittedValue: '12000.00',
    status: 'DRAFT',
    convertedProjectId: null,
    comparison: '15230.50',
    attachments: [],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TendersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listTenders.mockReset()
  patchTender.mockReset().mockResolvedValue({})
  convertTender.mockReset().mockResolvedValue({})
  createTender.mockReset().mockResolvedValue({})
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['PROJECT_MANAGER'],
      permissions: ['tenders.read', 'tenders.write'],
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

describe('TendersPage', () => {
  it('prikazuje prevedene kolone, broj po koloni i formatirane iznose', async () => {
    listTenders.mockResolvedValue({ data: [tender()], meta: { total: 1 } })
    renderPage()

    const draft = await screen.findByRole('region', { name: /^Nacrt/ })
    expect(await within(draft).findByText('Rekonstrukcija mosta')).toBeInTheDocument()
    expect(within(draft).getByText('12.000,00 / 15.230,50')).toBeInTheDocument()
    expect(within(draft).getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Tendera: 1')).toBeInTheDocument()
    expect(screen.queryByText('DRAFT')).not.toBeInTheDocument()
    expect(screen.queryByText('12000.00')).not.toBeInTheDocument()
  })

  it('prazna kolona ima poruku, a ne tišinu', async () => {
    listTenders.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    const lost = await screen.findByRole('region', { name: /^Izgubljen/ })
    expect(await within(lost).findByText('Nema tendera u ovoj fazi.')).toBeInTheDocument()
  })

  it('dok se učitava prikazuje skeleton sa aria-busy', () => {
    listTenders.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('greška je trajna i nudi ponovni pokušaj', async () => {
    listTenders.mockRejectedValueOnce(new Error('mreža'))
    listTenders.mockResolvedValueOnce({ data: [tender()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Tenderi se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Rekonstrukcija mosta')).toBeInTheDocument()
  })

  it('dugme „Označi kao dobijen“ mijenja status poslanog tendera', async () => {
    listTenders.mockResolvedValue({ data: [tender({ status: 'SUBMITTED' })], meta: { total: 1 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Označi kao dobijen' }))
    expect(patchTender).toHaveBeenCalledWith('t1', { status: 'WON' })
  })

  it('bez naziva forma ne odlazi na API i pokazuje grešku uz polje', async () => {
    listTenders.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Novi tender' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    expect(createTender).not.toHaveBeenCalled()
    expect(await screen.findByText('Obavezno polje.')).toBeInTheDocument()
  })

  it('novi tender se šalje sa nazivom, klijentom i vrijednošću', async () => {
    listTenders.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Novi tender' }))
    await userEvent.type(await screen.findByLabelText('Naziv'), 'Nadvožnjak')
    await userEvent.type(screen.getByLabelText('Klijent'), 'JP Autoceste')
    await userEvent.type(screen.getByLabelText('Ponuđena vrijednost'), '99000')
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))

    expect(createTender).toHaveBeenCalledWith({
      title: 'Nadvožnjak',
      client: 'JP Autoceste',
      submittedValue: '99000',
    })
  })
})
