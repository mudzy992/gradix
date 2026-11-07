import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bell } from './bell'

const listNotifications = vi.fn()
vi.mock('@/lib/api', () => ({
  listNotifications: (args: unknown) => listNotifications(args),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}))
vi.mock('@/hooks/use-tenant-ready', () => ({ useTenantReady: () => true }))
vi.mock('@/hooks/use-public-settings', () => ({
  useDisplayPrefs: () => ({ timeZone: 'UTC', dateFormat: 'dd.MM.yyyy' }),
}))

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><Bell /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  listNotifications.mockReset()
})

describe('Bell', () => {
  it('ne prikazuje praznu listu dok se obavijesti učitavaju', async () => {
    listNotifications.mockImplementation((args: { unread?: boolean }) =>
      args.unread ? Promise.resolve({ data: [], meta: { total: 0 } }) : new Promise(() => {}),
    )
    renderBell()
    await userEvent.click(screen.getByRole('button', { name: 'Obavijesti' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Učitavanje')
    expect(screen.queryByText('Nema obavijesti')).not.toBeInTheDocument()
  })

  it('grešku prikazuje umjesto prazne liste i omogućava ponovni pokušaj', async () => {
    let attempts = 0
    listNotifications.mockImplementation((args: { unread?: boolean }) => {
      if (args.unread) return Promise.resolve({ data: [], meta: { total: 0 } })
      attempts += 1
      return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ data: [] })
    })
    renderBell()
    await userEvent.click(screen.getByRole('button', { name: 'Obavijesti' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Obavijesti nije moguće učitati.')
    expect(screen.queryByText('Nema obavijesti')).not.toBeInTheDocument()
    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByText('Nema obavijesti')).toBeInTheDocument()
    expect(attempts).toBe(2)
  })
})
