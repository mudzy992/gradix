import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOGOUT_KEY } from '@/lib/constants'
import { clearSession } from '@/lib/api-client'
import { useLogoutSync } from '@/hooks/use-logout-sync'
import { writeRefreshToken } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'

/**
 * FE-15 — odjava u jednom tabu mora odjaviti i ostale. Prije je sinhronizacija brisala store i token,
 * ali **ne i keš upita**, pa su tuđi/podaci prethodnog korisnika ostajali u pregledniku. Sada oba puta
 * zovu istu rutinu (`clearSession`).
 */
vi.mock('@/lib/api-client', () => ({
  clearSession: vi.fn(),
}))

function Harness() {
  useLogoutSync()
  return <p>početna</p>
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route path="/projects" element={<Harness />} />
        <Route path="/login" element={<p>prijava</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  writeRefreshToken('current-token', false)
  useAuthStore.setState({ user: { id: 'u1' } as never })
})

function event(value: string | null) {
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: LOGOUT_KEY, newValue: value })))
}

function payload(userId: string) {
  return JSON.stringify({ version: 1, userId, nonce: 'event-1' })
}

describe('useLogoutSync', () => {
  it('odjava istog korisnika čisti sesiju i vodi na prijavu', async () => {
    renderAt()
    event(payload('u1'))
    expect(clearSession).toHaveBeenCalledOnce()
    expect(await screen.findByText('prijava')).toBeInTheDocument()
  })

  it.each([payload('u2'), '1', '{', null, JSON.stringify({ version: 1, userId: 'u1' })])(
    'ignoriše drugi nalog, legacy ili neispravnu poruku %s', (value) => {
      renderAt()
      event(value)
      expect(clearSession).not.toHaveBeenCalled()
      expect(screen.getByText('početna')).toBeInTheDocument()
    },
  )

  it('ignoriše događaj upisan prije prijave nove sesije istog korisnika', () => {
    const old = payload('u1')
    localStorage.setItem(LOGOUT_KEY, old)
    writeRefreshToken('new-login', false)
    renderAt()
    event(old)
    expect(clearSession).not.toHaveBeenCalled()
    expect(screen.getByText('početna')).toBeInTheDocument()
  })

  it('druge promjene u pohrani ignoriše', () => {
    renderAt()
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'gradix:company-id', newValue: 'c2' })))
    expect(clearSession).not.toHaveBeenCalled()
  })
})
