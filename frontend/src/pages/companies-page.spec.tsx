import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyRow } from '@/lib/api-types'
import { CompaniesPage } from '@/pages/companies-page'

/**
 * FE-13 — firme. Drži: zaglavlje kolone statusa (prije prazno `<th />`), reaktivaciju (prije je
 * nije bilo), `caption`, broj, prazno stanje i grešku sa ponovnim pokušajem.
 */
const listCompanies = vi.fn()
const patchCompanyPlatform = vi.fn()
const createCompany = vi.fn()

vi.mock('@/lib/api', () => ({
  listCompanies: (query: unknown) => listCompanies(query),
  patchCompanyPlatform: (id: string, body: unknown) => patchCompanyPlatform(id, body),
  createCompany: (body: unknown) => createCompany(body),
}))

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: 'c1',
    name: 'Gradix d.o.o.',
    slug: 'gradix',
    isActive: true,
    legalName: null,
    address: null,
    city: null,
    country: null,
    taxId: null,
    phone: null,
    email: null,
    logoPath: null,
    logoAssetId: null,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listCompanies.mockReset().mockResolvedValue({ data: [company()], meta: { total: 1 } })
  patchCompanyPlatform.mockReset().mockResolvedValue({})
  createCompany.mockReset().mockResolvedValue({ data: { temporaryPassword: 'Temp-1234' } })
})

describe('CompaniesPage', () => {
  it('kolona statusa ima zaglavlje i preveden status', async () => {
    renderPage()

    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(await within(table).findByText('Aktivan')).toBeInTheDocument()
    expect(within(table).getByText('Firme na platformi (1)')).toBeInTheDocument()
    expect(screen.getByText('Firmi: 1')).toBeInTheDocument()
  })

  it('deaktivirana firma se može ponovo aktivirati', async () => {
    listCompanies.mockResolvedValue({ data: [company({ isActive: false })], meta: { total: 1 } })
    renderPage()

    expect(await screen.findByText('Neaktivan')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aktiviraj' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potvrdi' }))

    expect(patchCompanyPlatform).toHaveBeenCalledWith('c1', { isActive: true })
  })

  it('deaktivacija traži potvrdu', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Deaktiviraj firmu' }))
    expect(patchCompanyPlatform).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potvrdi' }))

    expect(patchCompanyPlatform).toHaveBeenCalledWith('c1', { isActive: false })
  })

  it('greška liste je vidljiva i može se ponoviti', async () => {
    listCompanies.mockRejectedValueOnce(new Error('mreža'))
    listCompanies.mockResolvedValueOnce({ data: [company()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Firme se nisu učitale.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))

    expect(await screen.findByText('Gradix d.o.o.')).toBeInTheDocument()
  })


  it('nova firma: slug se validira uz polje prije API poziva', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Nova firma' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByLabelText('Naziv'), 'Nova gradnja')
    await userEvent.type(within(sheet).getByLabelText('Slug'), 'X')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sačuvaj' }))

    expect(createCompany).not.toHaveBeenCalled()
    expect(await within(sheet).findByText('Slug: 3–40 malih slova, brojeva i crtica.')).toBeInTheDocument()
  })

  it('nova firma se kreira sa prvim administratorom i prikaže privremenu lozinku', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Nova firma' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByLabelText('Naziv'), 'Nova gradnja')
    await userEvent.type(within(sheet).getByLabelText('Slug'), 'nova-gradnja')
    await userEvent.type(within(sheet).getByLabelText('Ime'), 'Amar')
    await userEvent.type(within(sheet).getByLabelText('Prezime'), 'Selimović')
    await userEvent.type(within(sheet).getByLabelText('Email'), 'amar@nova.ba')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sačuvaj' }))

    expect(createCompany).toHaveBeenCalledWith({
      name: 'Nova gradnja',
      slug: 'nova-gradnja',
      admin: { firstName: 'Amar', lastName: 'Selimović', email: 'amar@nova.ba' },
    })
    expect(await screen.findByText('Temp-1234')).toBeInTheDocument()
  })

  it('uređivanje firme mijenja samo naziv (ne šalje skriveni legalName)', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Uredi firmu' }))
    const sheet = await screen.findByRole('dialog')
    const name = within(sheet).getByLabelText('Naziv')
    await userEvent.clear(name)
    await userEvent.type(name, 'Gradix d.o.o. Sarajevo')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sačuvaj' }))

    expect(patchCompanyPlatform).toHaveBeenCalledWith('c1', { name: 'Gradix d.o.o. Sarajevo' })
  })

  it('prazna lista ima poruku', async () => {
    listCompanies.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    expect(await screen.findByText('Nema firmi.')).toBeInTheDocument()
    expect(screen.getByText('Firmi: 0')).toBeInTheDocument()
  })
})
