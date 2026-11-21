import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { ApiError, type MeUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { BootGate } from './boot-gate'

const refresh = vi.fn()
const getMe = vi.fn()
const readToken = vi.fn()
const forceLogin = vi.fn()
vi.mock('@/lib/api-client', () => ({ refreshSession: () => refresh(), forceLogin: () => forceLogin() }))
vi.mock('@/lib/api', () => ({ getMe: () => getMe() }))
vi.mock('@/lib/storage', () => ({ readRefreshToken: () => readToken(), getSessionGeneration: () => 1 }))

const user: MeUser = {
  id: 'u1', firstName: 'A', lastName: 'B', employeeCode: null, email: 'a@example.test',
  roles: ['ADMIN'], permissions: [], companyId: 'c1', company: null, hourlyRate: null,
  mustChangePassword: false, locale: 'bs',
}

beforeEach(async () => {
  refresh.mockReset()
  getMe.mockReset()
  forceLogin.mockReset()
  readToken.mockReset().mockReturnValue('saved')
  useAuthStore.setState({ user: null, accessToken: null, ready: false })
  await i18n.changeLanguage('bs')
})

describe('BootGate recoverable session', () => {
  it('prikazuje uzrok 429 i stvarno ponavlja obnovu uz uspješan profil', async () => {
    refresh.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 'limited', 429)).mockResolvedValueOnce(true)
    getMe.mockResolvedValue({ data: user })
    render(<BootGate><p>Prikaz aplikacije</p></BootGate>)
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('errors.RATE_LIMITED'))
    expect(screen.queryByText('Prikaz aplikacije')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ponovi obnovu' }))
    expect(await screen.findByText('Prikaz aplikacije')).toBeInTheDocument()
    expect(useAuthStore.getState().user?.id).toBe('u1')
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(forceLogin).not.toHaveBeenCalled()
  })

  it('omogućava nastavak bez oporavka nakon prekida mreže', async () => {
    refresh.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', 0))
    render(<BootGate><p>Prikaz aplikacije</p></BootGate>)
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('errors.NETWORK_ERROR'))
    await userEvent.click(screen.getByRole('button', { name: 'Nastavi bez obnove' }))
    expect(await screen.findByText('Prikaz aplikacije')).toBeInTheDocument()
    expect(forceLogin).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('neispravan refresh nastavlja normalno prema prijavi bez recoverable ekrana', async () => {
    refresh.mockResolvedValue(false)
    render(<BootGate><p>Prikaz aplikacije</p></BootGate>)
    await waitFor(() => expect(screen.getByText('Prikaz aplikacije')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
