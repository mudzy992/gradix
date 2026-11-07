import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { UsersPage } from '@/pages/users-page'
import { isSensitiveNavigationBlocked } from '@/lib/sensitive-navigation'

/**
 * FE-13 — korisnici. Drži: status u tabeli (prije nije postojao), reaktivaciju (prije je nije bilo),
 * potvrdu prije reseta lozinke (prije jedan klik), grešku sa ponovnim pokušajem, prazno stanje i
 * broj/caption. Ovuđe se ne testira obrazac korisnika — on ima svoje ponašanje kroz API pozive.
 */
const listUsers = vi.fn()
const patchUser = vi.fn()
const resetUserPassword = vi.fn()
const createUser = vi.fn()

vi.mock('@/lib/api', () => ({
  listUsers: (query: unknown) => listUsers(query),
  patchUser: (id: string, body: unknown) => patchUser(id, body),
  resetUserPassword: (id: string) => resetUserPassword(id),
  createUser: (body: unknown) => createUser(body),
}))

function user(overrides: Partial<ListUser> = {}): ListUser {
  return {
    id: 'u2',
    firstName: 'Mirza',
    lastName: 'Hadžić',
    employeeCode: null,
    email: 'mirza@gradix.local',
    phone: null,
    companyId: 'c1',
    hourlyRate: null,
    isActive: true,
    mustChangePassword: false,
    locale: 'bs',
    roles: ['WORKER'],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listUsers.mockReset().mockResolvedValue({ data: [user()], meta: { total: 1 } })
  patchUser.mockReset().mockResolvedValue({})
  resetUserPassword.mockReset().mockResolvedValue({ data: { temporaryPassword: 'Temp-1234' } })
  createUser.mockReset().mockResolvedValue({ data: { temporaryPassword: 'Temp-1234' } })
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'admin@gradix.local',
      roles: ['ADMIN'],
      permissions: ['users.read', 'users.write', 'payroll.write'],
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

describe('UsersPage', () => {
  it('prikazuje status korisnika i oznaku „to ste vi“ bez akcija na sebi', async () => {
    listUsers.mockResolvedValue({
      data: [user(), user({ id: 'u1', firstName: 'A', lastName: 'B', roles: ['ADMIN'], isActive: false })],
      meta: { total: 2 },
    })
    renderPage()

    const table = await screen.findByRole('table')
    expect(await within(table).findByText('Aktivan')).toBeInTheDocument()
    expect(within(table).getByText('Neaktivan')).toBeInTheDocument()
    expect(within(table).getByText('(to ste vi)')).toBeInTheDocument()
    expect(within(table).getByText('Korisnici firme (2)')).toBeInTheDocument()
    expect(screen.getByText('Korisnika: 2')).toBeInTheDocument()

    // Na svom redu nema reset-a ni deaktivacije.
    const mine = within(table).getByText('(to ste vi)').closest('tr')
    expect(mine).not.toBeNull()
    expect(within(mine as HTMLElement).queryByRole('button', { name: 'Reset lozinke' })).not.toBeInTheDocument()
  })

  it('reaktivira deaktiviranog korisnika uz potvrdu', async () => {
    listUsers.mockResolvedValue({ data: [user({ isActive: false })], meta: { total: 1 } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Aktiviraj' }))
    expect(patchUser).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potvrdi' }))

    expect(patchUser).toHaveBeenCalledWith('u2', { isActive: true })
  })

  it('deaktivira korisnika uz potvrdu', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Deaktiviraj' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potvrdi' }))

    expect(patchUser).toHaveBeenCalledWith('u2', { isActive: false })
  })

  it('reset lozinke traži potvrdu i prikaže privremenu lozinku', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Reset lozinke' }))
    expect(resetUserPassword).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potvrdi' }))

    expect(resetUserPassword).toHaveBeenCalledWith('u2')
    expect(await screen.findByText('Temp-1234')).toBeInTheDocument()
  })

  it('reset zadržava potvrdu i blokira promjenu firme do prikaza i potvrde lozinke', async () => {
    let resolve!: (value: { data: { temporaryPassword: string } }) => void
    resetUserPassword.mockReturnValue(new Promise((done) => { resolve = done }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Reset lozinke' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(isSensitiveNavigationBlocked()).toBe(true)
    const confirm = within(dialog).getByRole('button', { name: 'Potvrdi' })
    // Two events before the pending render must not send two resets.
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm) })
    await waitFor(() => expect(confirm).toBeDisabled())
    expect(resetUserPassword).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: 'Otkaži' })).toBeDisabled()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Reset je u toku')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await act(async () => { resolve({ data: { temporaryPassword: 'Temp-1234' } }) })
    expect(await screen.findByText('Temp-1234')).toBeInTheDocument()
    expect(isSensitiveNavigationBlocked()).toBe(true)
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Potvrdi' }))
    expect(isSensitiveNavigationBlocked()).toBe(false)
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('ne ponavlja reset automatski nakon nepoznatog ishoda, a novi pokušaj zahtijeva novo otvaranje', async () => {
    resetUserPassword.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { temporaryPassword: 'Temp-5678' } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Reset lozinke' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potvrdi' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Moguće je da je lozinka već promijenjena')
    expect(within(dialog).getByRole('button', { name: 'Potvrdi' })).toBeDisabled()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Otkaži' }))
    expect(resetUserPassword).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Reset lozinke' }))
    const reopened = await screen.findByRole('alertdialog')
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(within(reopened).getByRole('button', { name: 'Potvrdi' }))
    expect(await screen.findByText('Temp-5678')).toBeInTheDocument()
    expect(resetUserPassword).toHaveBeenCalledTimes(2)
  })

  it('greška liste je trajna i nudi ponovni pokušaj', async () => {
    listUsers.mockRejectedValueOnce(new Error('mreža'))
    listUsers.mockResolvedValueOnce({ data: [user()], meta: { total: 1 } })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Korisnici se nisu učitali.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))

    const table = await screen.findByRole('table')
    expect(await within(table).findByText('Mirza Hadžić')).toBeInTheDocument()
  })

  it('prazna lista kaže da nema rezultata', async () => {
    listUsers.mockResolvedValue({ data: [], meta: { total: 0 } })
    renderPage()

    expect(await screen.findByText('Nema korisnika za ovaj filter.')).toBeInTheDocument()
    expect(screen.getByText('Korisnika: 0')).toBeInTheDocument()
  })


  it('kreiranje korisnika iz obrasca šalje uloge i prikaže privremenu lozinku', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Novi korisnik' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByLabelText('Ime'), 'Amar')
    await userEvent.type(within(sheet).getByLabelText('Prezime'), 'Selimović')
    await userEvent.type(within(sheet).getByLabelText('Email'), 'amar@gradix.local')
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Radnik' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sačuvaj' }))

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Amar', lastName: 'Selimović', email: 'amar@gradix.local', roles: ['WORKER'] }),
    )
    expect(await screen.findByText('Temp-1234')).toBeInTheDocument()
  })

  it('kreiranje korisnika ne zatvara obrazac niti šalje duplikat dok odgovor čeka', async () => {
    let resolve!: (value: { data: { temporaryPassword: string } }) => void
    createUser.mockReturnValue(new Promise((done) => { resolve = done }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Novi korisnik' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByLabelText('Ime'), 'Amar')
    await userEvent.type(within(sheet).getByLabelText('Prezime'), 'Selimović')
    await userEvent.type(within(sheet).getByLabelText('Email'), 'amar@gradix.local')
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Radnik' }))
    const form = within(sheet).getByRole('button', { name: 'Sačuvaj' }).closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1))
    expect(within(sheet).getByRole('status')).toHaveTextContent('Spremanje je u toku')
    expect(within(sheet).getByLabelText('Ime')).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Sačuvaj' })).toBeDisabled()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Zatvori' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await act(async () => { resolve({ data: { temporaryPassword: 'Temp-1234' } }) })
    expect(await screen.findByText('Temp-1234')).toBeInTheDocument()
    expect(isSensitiveNavigationBlocked()).toBe(true)
    expect(useCompanyStore.getState().setSelectedId('c2')).toBe(false)
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Potvrdi' }))
    expect(isSensitiveNavigationBlocked()).toBe(false)
    act(() => { expect(useCompanyStore.getState().setSelectedId('c2')).toBe(true) })
  })

  it('ne ponavlja neuspješno kreiranje korisnika bez izričitog potvrđivanja rizika', async () => {
    createUser.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { temporaryPassword: 'Temp-5678' } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Novi korisnik' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByLabelText('Ime'), 'Amar')
    await userEvent.type(within(sheet).getByLabelText('Prezime'), 'Selimović')
    await userEvent.type(within(sheet).getByLabelText('Email'), 'amar@gradix.local')
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Radnik' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sačuvaj' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('možda su već kreirani')
    expect(within(sheet).getByLabelText('Ime')).toHaveValue('Amar')
    expect(within(sheet).getByRole('button', { name: 'Sačuvaj' })).toBeDisabled()
    expect(createUser).toHaveBeenCalledTimes(1)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sačuvaj' }))
    expect(await screen.findByText('Temp-5678')).toBeInTheDocument()
    expect(createUser).toHaveBeenCalledTimes(2)
  })

  it('obrazac traži ulogu i provjerava satnicu uz polje', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Novi korisnik' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByLabelText('Ime'), 'Amar')
    await userEvent.type(within(sheet).getByLabelText('Prezime'), 'Selimović')
    await userEvent.type(within(sheet).getByLabelText('Email'), 'amar@gradix.local')
    await userEvent.type(within(sheet).getByLabelText('Satnica'), 'abc')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sačuvaj' }))

    expect(createUser).not.toHaveBeenCalled()
    expect(await within(sheet).findByText('Satnica mora biti broj veći od nule.')).toBeInTheDocument()

    await userEvent.clear(within(sheet).getByLabelText('Satnica'))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sačuvaj' }))
    expect(await within(sheet).findByText('Izaberite barem jednu ulogu.')).toBeInTheDocument()
  })

  it('uređivanje korisnika ne mijenja email (polje je zaključano uz objašnjenje)', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Uredi' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByLabelText('Email')).toBeDisabled()
    expect(within(sheet).getByText('Email se ne može mijenjati.')).toBeInTheDocument()
  })


  it('paginacija traži sljedeću stranu i gasi „Dalje“ na kraju', async () => {
    listUsers.mockResolvedValue({ data: [user()], meta: { total: 25 } })
    renderPage()

    expect(await screen.findByText('Korisnika: 25')).toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Dalje' })
    expect(next).toBeEnabled()
    await userEvent.click(next)

    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
  })

  it('pretraga i filter uloge imaju labele', async () => {
    renderPage()

    expect(await screen.findByLabelText('Pretraga korisnika')).toBeInTheDocument()
    expect(screen.getByLabelText('Uloga')).toBeInTheDocument()
  })
})
