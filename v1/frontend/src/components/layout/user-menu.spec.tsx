import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserMenu } from '@/components/layout/user-menu'
import { LOGOUT_KEY, REFRESH_KEY } from '@/lib/constants'
import { readRefreshToken, writeRefreshToken } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'

const mocks = vi.hoisted(() => ({ logout: vi.fn(), logoutAll: vi.fn(), patchMe: vi.fn() }))
vi.mock('@/lib/api', () => mocks)

function user(id: string) {
  return {
    id, firstName: 'Test', lastName: 'Korisnik', employeeCode: null, email: 'test@example.com',
    roles: ['ADMIN'] as const, permissions: [], companyId: 'company', company: null, hourlyRate: null,
    mustChangePassword: false, locale: 'bs' as const,
  }
}

function setUser(id: string, token: string) {
  writeRefreshToken(token, true)
  useAuthStore.setState({ user: { ...user(id), roles: ['ADMIN'] }, accessToken: `access-${id}`, ready: true })
}

function mount() {
  render(<MemoryRouter initialEntries={['/projects']}><Routes>
    <Route path="/projects" element={<UserMenu />} />
    <Route path="/login" element={<p>prijava</p>} />
  </Routes></MemoryRouter>)
}

async function openAndSelect(label: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Test Korisnik' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: label }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  setUser('u1', 'refresh-old')
})

describe('user menu logout session races', () => {
  it.each([
    { label: 'Odjava', method: 'logout' as const },
    { label: 'Odjavi sve uređaje', method: 'logoutAll' as const },
  ])('$label does not clear a newer login after the old request settles', async ({ label, method }) => {
    let resolve!: () => void
    mocks[method].mockReturnValueOnce(new Promise<void>((done) => { resolve = done }))
    mount()
    await openAndSelect(label)
    expect(mocks[method]).toHaveBeenCalledOnce()
    act(() => setUser('u2', 'refresh-new'))
    await act(async () => { resolve() })
    expect(useAuthStore.getState().user?.id).toBe('u2')
    expect(useAuthStore.getState().accessToken).toBe('access-u2')
    expect(readRefreshToken()).toBe('refresh-new')
    expect(localStorage.getItem(LOGOUT_KEY)).toBeNull()
    expect(screen.queryByText('prijava')).not.toBeInTheDocument()
  })

  it('sends the bound token and preserves a different account token in shared storage', async () => {
    localStorage.setItem(REFRESH_KEY, 'refresh-other-account')
    mocks.logout.mockResolvedValueOnce({ data: { ok: true } })
    mount()
    await openAndSelect('Odjava')
    await waitFor(() => expect(screen.getByText('prijava')).toBeInTheDocument())
    expect(mocks.logout).toHaveBeenCalledWith('refresh-old')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-other-account')
  })

  it('logout-all broadcasts the authenticated user rather than a global event', async () => {
    mocks.logoutAll.mockResolvedValueOnce({ data: { ok: true } })
    mount()
    await openAndSelect('Odjavi sve uređaje')
    await waitFor(() => expect(screen.getByText('prijava')).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(LOGOUT_KEY)!)).toMatchObject({ version: 1, userId: 'u1' })
  })
})
