import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MeUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { CommandPalette } from './command-palette'
const base: MeUser = { id: 'u', firstName: 'Demo', lastName: 'Admin', employeeCode: null, email: 'a@example.test', roles: ['ADMIN'], permissions: ['projects.read', 'tasks.read', 'users.write', 'documents.read'], companyId: 'c', company: null, hourlyRate: null, mustChangePassword: false, locale: 'bs' }
function Location() { return <p data-testid="location">{useLocation().pathname}</p> }
function setup() { return render(<MemoryRouter initialEntries={['/dashboard']}><input aria-label="Prije palete" /><CommandPalette /><Location /></MemoryRouter>) }
beforeEach(() => { useAuthStore.setState({ user: base, accessToken: 'token', ready: true }); useCompanyStore.setState({ selectedId: null, revision: 0 }) })
describe('command palette', () => {
  it('opens with Ctrl+K, filters, navigates with the keyboard and closes', async () => {
    const user = userEvent.setup()
    setup()
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: 'Brza navigacija' })).toBeInTheDocument()
    const search = screen.getByRole('combobox', { name: 'Pretraži stranice' })
    expect(search).toHaveFocus()
    await user.type(search, 'projekti')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/projects')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('shows only destinations permitted for the current role', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ user: { ...base, roles: ['WORKER'], permissions: ['tasks.read'] } })
    setup()
    await user.click(screen.getByRole('button', { name: 'Otvori brzu navigaciju' }))
    expect(screen.getByRole('option', { name: 'Zadaci' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Projekti' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Korisnici' })).not.toBeInTheDocument()
  })
  it('does not expose tenant destinations to a platform user without a selected company', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ user: { ...base, companyId: null, roles: ['PLATFORM_ADMIN'], permissions: [...base.permissions, 'platform.companies'] } })
    setup()
    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByRole('option', { name: 'Firme' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Projekti' })).not.toBeInTheDocument()
  })
  it('removes destinations when permissions change while open', async () => {
    const user = userEvent.setup()
    setup()
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('option', { name: 'Projekti' })).toBeInTheDocument()
    await act(async () => { useAuthStore.setState({ user: { ...base, permissions: [] } }) })
    expect(screen.queryByRole('option', { name: 'Projekti' })).not.toBeInTheDocument()
  })
  it('matches diacritics and keeps the active descendant valid while navigating', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ user: { ...base, permissions: [...base.permissions, 'reports.read'] } })
    setup()
    await user.keyboard('{Control>}k{/Control}')
    const search = screen.getByRole('combobox')
    await user.type(search, 'izvjestaji')
    const option = screen.getByRole('option', { name: 'Izvještaji' })
    expect(search).toHaveAttribute('aria-activedescendant', option.id)
    await user.keyboard('{ArrowUp}')
    expect(option).toHaveAttribute('aria-selected', 'true')
  })
  it('does not open on top of another modal', async () => {
    const user = userEvent.setup()
    setup()
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('data-state', 'open')
    document.body.append(modal)
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    modal.remove()
  })
  it('shows a genuine no-results state and restores keyboard focus on Escape', async () => {
    const user = userEvent.setup()
    setup()
    const before = screen.getByLabelText('Prije palete')
    before.focus()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'nepostojeće')
    expect(screen.getByText('Nema rezultata.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(before).toHaveFocus())
  })
})
