import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LOGOUT_KEY } from '@/lib/constants'
import { clearSession } from '@/lib/api-client'
import { useLogoutSync } from '@/hooks/use-logout-sync'

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

describe('useLogoutSync', () => {
  it('odjava u drugom tabu čisti sesiju i vodi na prijavu', async () => {
    renderAt()

    window.dispatchEvent(new StorageEvent('storage', { key: LOGOUT_KEY, newValue: '1' }))

    expect(clearSession).toHaveBeenCalled()
    expect(await screen.findByText('prijava')).toBeInTheDocument()
  })

  it('druge promjene u pohrani ignoriše', () => {
    renderAt()

    window.dispatchEvent(new StorageEvent('storage', { key: 'gradix:company-id', newValue: 'c2' }))

    expect(clearSession).not.toHaveBeenCalled()
    expect(screen.getByText('početna')).toBeInTheDocument()
  })
})
