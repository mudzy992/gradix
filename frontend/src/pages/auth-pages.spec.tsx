import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { clearRefreshToken, writeRefreshToken } from '@/lib/storage'
import { LoginPage } from '@/pages/login-page'
import { ForgotPage } from '@/pages/forgot-page'
import { ResetPage } from '@/pages/reset-page'
import { ChangePasswordPage } from '@/pages/change-password-page'

/**
 * FE-07 — auth ekrani. Testovi drže ono što je prije bilo slomljeno ili nepokriveno:
 * `h1` na svakom ekranu, poruka **uz polje** (ne samo toast), trajna greška servera,
 * potvrda slanja kao stanje ekrana i prekidač vidljivosti lozinke.
 */
const login = vi.fn()
const forgotPassword = vi.fn()
const changePassword = vi.fn()
const logout = vi.fn()

vi.mock('@/lib/api', () => ({
  login: (body: unknown) => login(body),
  forgotPassword: (email: string) => forgotPassword(email),
  changePassword: (body: unknown) => changePassword(body),
  logout: (token: string) => logout(token),
}))

function renderPage(element: React.ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>)
}

beforeEach(() => {
  login.mockReset()
  forgotPassword.mockReset()
  changePassword.mockReset()
  logout.mockReset()
  useAuthStore.setState({ user: null, accessToken: null, ready: true })
})

describe('LoginPage', () => {
  it('ima jedno h1 i traži oba polja prije poziva API-ja', async () => {
    renderPage(<LoginPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Prijava' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Prijavi se' }))

    await waitFor(() => expect(screen.getAllByText('Obavezno polje.')).toHaveLength(2))
    expect(screen.getByLabelText('Email ili telefon')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Lozinka')).toHaveAttribute('aria-invalid', 'true')
    expect(login).not.toHaveBeenCalled()
  })

  it('greška servera ostaje na ekranu (role="alert"), ne u toastu koji nestane', async () => {
    login.mockRejectedValueOnce(new Error('Previše pokušaja. Pokušajte kasnije.'))
    renderPage(<LoginPage />)

    await userEvent.type(screen.getByLabelText('Email ili telefon'), 'admin@gradix.local')
    await userEvent.type(screen.getByLabelText('Lozinka'), 'tajna12345')
    await userEvent.click(screen.getByRole('button', { name: 'Prijavi se' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/previše pokušaja/i)
  })

  it('prekidač vidljivosti mijenja tip polja i nosi stanje (aria-pressed)', async () => {
    renderPage(<LoginPage />)
    const password = screen.getByLabelText('Lozinka')
    expect(password).toHaveAttribute('type', 'password')

    const toggle = screen.getByRole('button', { name: 'Prikaži lozinku' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(toggle)
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Sakrij lozinku' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('identifikator bez „@“ ide kao telefon (isti ekran, druga grana API-ja)', async () => {
    login.mockResolvedValueOnce({
      data: {
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'u1', firstName: 'A', lastName: 'B', locale: 'bs' },
      },
    })
    renderPage(<LoginPage />)

    await userEvent.type(screen.getByLabelText('Email ili telefon'), '+38761111222')
    await userEvent.type(screen.getByLabelText('Lozinka'), 'tajna12345')
    await userEvent.click(screen.getByRole('button', { name: 'Prijavi se' }))

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    expect(login.mock.calls[0][0]).toEqual({ phone: '+38761111222', password: 'tajna12345' })
  })

  it('uspješna prijava postavlja sesiju u store', async () => {
    login.mockResolvedValueOnce({
      data: {
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'u1', firstName: 'A', lastName: 'B', locale: 'bs' },
      },
    })
    renderPage(<LoginPage />)

    await userEvent.type(screen.getByLabelText('Email ili telefon'), 'admin@gradix.local')
    await userEvent.type(screen.getByLabelText('Lozinka'), 'tajna12345')
    await userEvent.click(screen.getByRole('button', { name: 'Prijavi se' }))

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('access'))
    expect(login.mock.calls[0][0]).toEqual({ email: 'admin@gradix.local', password: 'tajna12345' })
  })
})

describe('ForgotPage', () => {
  it('neispravan email prijavljuje uz polje, na našem jeziku', async () => {
    renderPage(<ForgotPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'nije-email')
    await userEvent.click(screen.getByRole('button', { name: 'Pošalji' }))

    expect(await screen.findByText('Unesite ispravan email.')).toBeInTheDocument()
    expect(forgotPassword).not.toHaveBeenCalled()
  })

  it('potvrda je stanje ekrana i može se poslati na drugu adresu', async () => {
    forgotPassword.mockResolvedValueOnce({ data: { ok: true } })
    renderPage(<ForgotPage />)

    await userEvent.type(screen.getByLabelText('Email'), 'ana@gradix.local')
    await userEvent.click(screen.getByRole('button', { name: 'Pošalji' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/ana@gradix\.local/)
    expect(forgotPassword).toHaveBeenCalledWith('ana@gradix.local')

    await userEvent.click(screen.getByRole('button', { name: 'Pošalji na drugu adresu' }))
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('greška servera je trajna i polje ostaje da se ispravi', async () => {
    forgotPassword.mockRejectedValueOnce(new Error('Mreža nije dostupna.'))
    renderPage(<ForgotPage />)

    await userEvent.type(screen.getByLabelText('Email'), 'ana@gradix.local')
    await userEvent.click(screen.getByRole('button', { name: 'Pošalji' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/mreža nije dostupna/i)
    expect(screen.getByLabelText('Email')).toHaveValue('ana@gradix.local')
  })
})

describe('ChangePasswordPage', () => {
  it('kratka lozinka daje poruku uz polje (prije je Zod bacao engleski tekst, nigdje prikazan)', async () => {
    renderPage(<ChangePasswordPage />)
    await userEvent.type(screen.getByLabelText('Trenutna lozinka'), 'stara12345')
    await userEvent.type(screen.getByLabelText('Nova lozinka'), 'kratka')
    await userEvent.click(screen.getByRole('button', { name: 'Promijeni lozinku' }))

    // Tekst je i hint i greška — mora se pojaviti najmanje dva puta.
    await waitFor(() => expect(screen.getAllByText('Najmanje 10 karaktera').length).toBeGreaterThan(1))
    expect(screen.getByLabelText('Nova lozinka')).toHaveAttribute('aria-invalid', 'true')
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('ispravna promjena zove API i čisti sesiju', async () => {
    changePassword.mockResolvedValueOnce({ data: { ok: true } })
    useAuthStore.setState({ accessToken: 'a', user: null, ready: true })
    renderPage(<ChangePasswordPage />)

    await userEvent.type(screen.getByLabelText('Trenutna lozinka'), 'stara12345')
    await userEvent.type(screen.getByLabelText('Nova lozinka'), 'novaLozinka123')
    await userEvent.click(screen.getByRole('button', { name: 'Promijeni lozinku' }))

    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1))
    expect(changePassword.mock.calls[0][0]).toEqual({
      currentPassword: 'stara12345',
      newPassword: 'novaLozinka123',
    })
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull())
  })

  it('odjava pošalje refresh token i očisti sesiju čak i ako API padne', async () => {
    logout.mockRejectedValueOnce(new Error('mreža'))
    writeRefreshToken('refresh-token', true)
    useAuthStore.setState({ accessToken: 'a', user: null, ready: true })
    renderPage(<ChangePasswordPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Odjava' }))

    await waitFor(() => expect(logout).toHaveBeenCalledWith('refresh-token'))
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull())
    clearRefreshToken()
  })

  it('prinudna promjena objašnjava zašto je ekran obavezan', () => {
    renderPage(<ChangePasswordPage forced />)
    expect(screen.getByText('Morate promijeniti privremenu lozinku.')).toBeInTheDocument()
  })

  it('odbijena promjena (npr. pogrešna trenutna lozinka) ostaje vidljiva', async () => {
    changePassword.mockRejectedValueOnce(new Error('Trenutna lozinka nije ispravna.'))
    renderPage(<ChangePasswordPage />)

    await userEvent.type(screen.getByLabelText('Trenutna lozinka'), 'pogresna123')
    await userEvent.type(screen.getByLabelText('Nova lozinka'), 'novaLozinka123')
    await userEvent.click(screen.getByRole('button', { name: 'Promijeni lozinku' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/trenutna lozinka nije ispravna/i)
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})

describe('ResetPage', () => {
  it('nema lažnu formu: objašnjava stanje i vodi nazad na prijavu', () => {
    renderPage(<ResetPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Reset lozinke' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nazad na prijavu' })).toHaveAttribute('href', '/login')
    expect(screen.getByText(/administrator/i)).toBeInTheDocument()
  })
})
