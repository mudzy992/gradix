import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComplianceDoc } from '@/lib/api-polish'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { DocumentsPage } from '@/pages/documents-page'

/**
 * FE-10 — dokumenti. Drži: stanje roka (istekao / ističe / vrijedi / bez roka) umjesto da korisnik
 * računa dane iz datuma, broj dokumenata, stanja liste (skeleton/greška/prazno) i poruku kad fajl
 * nije izabran (prije je forma tiho odustajala).
 */
const listDocs = vi.fn()
const listUsers = vi.fn()
const listMachines = vi.fn()
const uploadFile = vi.fn()
const createDoc = vi.fn()

vi.mock('@/lib/api-polish', () => ({
  listDocs: (kind: string) => listDocs(kind),
  createDoc: (kind: string, body: unknown) => createDoc(kind, body),
}))

vi.mock('@/lib/api', () => ({
  listUsers: (query: unknown) => listUsers(query),
  uploadFile: (file: File) => uploadFile(file),
}))

vi.mock('@/lib/api-fleet', () => ({
  listMachines: (query: unknown) => listMachines(query),
}))

function doc(overrides: Partial<ComplianceDoc> = {}): ComplianceDoc {
  return {
    id: 'd1',
    type: 'Potvrda o osposobljavanju',
    filePath: 'docs/1.pdf',
    expiresAt: '2026-12-31T00:00:00.000Z',
    note: null,
    userId: null,
    machineId: null,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listDocs.mockReset()
  listUsers.mockReset().mockResolvedValue({ data: [], meta: { total: 0 } })
  listMachines.mockReset().mockResolvedValue({ data: [], meta: { total: 0 } })
  uploadFile.mockReset().mockResolvedValue({ data: { path: 'docs/novi.pdf' } })
  createDoc.mockReset().mockResolvedValue({})
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ACCOUNTANT'],
      permissions: ['documents.read', 'documents.write'],
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

describe('DocumentsPage', () => {
  it('označava istekao dokument i prikazuje broj dokumenata', async () => {
    listDocs.mockResolvedValue({
      data: [
        doc({ id: 'd2', expiresAt: '2020-01-01T00:00:00.000Z' }),
        doc({ id: 'd3', expiresAt: null }),
      ],
      meta: { total: 2 },
    })
    renderPage()

    expect(await screen.findByText('Istekao')).toBeInTheDocument()
    expect(screen.getByText('Bez roka')).toBeInTheDocument()
    expect(screen.getByText('Dokumenta: 2')).toBeInTheDocument()
    // Relativni pomak je jasniji od samog datuma.
    expect(screen.getByText(/istekao prije \d+ d/)).toBeInTheDocument()
  })

  it('dokument koji ističe uskoro ima stanje „Ističe“ sa brojem dana', async () => {
    const soon = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString()
    listDocs.mockResolvedValue({ data: [doc({ expiresAt: soon })], meta: { total: 1 } })
    renderPage()

    expect(await screen.findByText('Ističe')).toBeInTheDocument()
    expect(screen.getByText('ističe za 6 d')).toBeInTheDocument()
  })

  it('prazna kategorija ima uputu, bez zaglavlja greške', async () => {
    listDocs.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()
    expect(await screen.findByText('Nema dokumenata u ovoj kategoriji.')).toBeInTheDocument()
    expect(screen.getByText(/Dodajte dokument/)).toBeInTheDocument()
  })

  it('greška je trajna i nudi ponovni pokušaj', async () => {
    listDocs.mockRejectedValueOnce(new Error('mreža'))
    listDocs.mockResolvedValueOnce({ data: [doc()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Dokumenti se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Vrijedi')).toBeInTheDocument()
  })

  it('tabela ima skeleton dok se učitava', () => {
    listDocs.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('bez fajla forma ne zove API i pokaže grešku uz polje', async () => {
    listDocs.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Novi dokument' }))
    await userEvent.type(await screen.findByLabelText('Tip'), 'Ugovor')
    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))

    expect(uploadFile).not.toHaveBeenCalled()
    expect(await screen.findByText('Obavezno polje.')).toBeInTheDocument()
  })

  it('prebacivanje na radnike nudi izbor radnika i šalje dokument sa fajlom', async () => {
    listDocs.mockResolvedValue({ data: [], meta: { total: 0 } })
    listUsers.mockResolvedValue({
      data: [{ id: 'u9', firstName: 'Amar', lastName: 'Hodžić' }],
      meta: { total: 1 },
    })
    renderPage()

    await userEvent.click(await screen.findByRole('tab', { name: 'Radnik' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Novi dokument' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Tip'), 'Ljekarsko uvjerenje')
    // „Radnik“ je i naziv taba i labela polja — traži se unutar forme.
    await userEvent.selectOptions(await within(dialog).findByLabelText('Radnik'), 'u9')
    await userEvent.type(within(dialog).getByLabelText('Ističe'), '2027-01-15')
    await userEvent.upload(within(dialog).getByLabelText('Fajl dokumenta'), new File(['x'], 'uvjerenje.pdf'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sačuvaj' }))

    expect(uploadFile).toHaveBeenCalled()
    expect(createDoc).toHaveBeenCalledWith('worker', {
      type: 'Ljekarsko uvjerenje',
      filePath: 'docs/novi.pdf',
      expiresAt: '2027-01-15',
      userId: 'u9',
      machineId: undefined,
    })
  })

  it('kategorija mašina učitava mašine za izbor', async () => {
    listDocs.mockResolvedValue({ data: [], meta: { total: 0 } })
    listMachines.mockResolvedValue({ data: [{ id: 'm1', name: 'Kiper 1' }], meta: { total: 1 } })
    renderPage()

    await userEvent.click(await screen.findByRole('tab', { name: 'Mašina' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Novi dokument' }))
    const dialog = await screen.findByRole('dialog')
    const machine = await within(dialog).findByLabelText('Mašina')
    expect(within(machine).getByRole('option', { name: 'Kiper 1' })).toBeInTheDocument()
  })
})
