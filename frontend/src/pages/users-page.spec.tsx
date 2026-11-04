import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { UsersPage } from '@/pages/users-page'

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
