import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, Outlet, RouterProvider, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { holdSensitiveNavigation, isSensitiveNavigationBlocked } from '@/lib/sensitive-navigation'
import { useSensitiveNavigationBlock, useSensitiveNavigationGuard } from '@/hooks/use-sensitive-navigation'
import { useAuthStore } from '@/stores/auth-store'

function Layout() {
  useSensitiveNavigationGuard()
  const navigate = useNavigate()
  return <><Link to="/other">Go</Link><button onClick={() => void navigate(-1)}>Back</button><Outlet /></>
}
function Work() {
  const [open, setOpen] = useState(true)
  useSensitiveNavigationBlock(open)
  return <><p>Protected workflow</p><button onClick={() => setOpen(false)}>Finish</button></>
}
function mount() {
  const router = createMemoryRouter([{ element: <Layout />, children: [
    { path: '/work', element: <Work /> },
    { path: '/other', element: <p>Other page</p> },
    { path: '/login', element: <p>Login</p> },
  ] }], { initialEntries: ['/other', '/work'], initialIndex: 1 })
  const view = render(<RouterProvider router={router} />)
  return { router, ...view }
}
beforeEach(() => {
  useAuthStore.setState({ user: {
    id: 'u1', firstName: 'A', lastName: 'B', email: 'a@example.test', employeeCode: null,
    roles: ['ADMIN'], permissions: [], companyId: 'c1', company: null, hourlyRate: null,
    mustChangePassword: false, locale: 'bs',
  }, accessToken: 'token', ready: true })
})

describe('one-time credential navigation protection', () => {
  it('blocks links, back and programmatic route changes; finishing lets navigation proceed', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '')
    try {
      const { router } = mount()
      await userEvent.click(screen.getByRole('link', { name: 'Go' }))
      await waitFor(() => expect(error).toHaveBeenCalled())
      expect(router.state.location.pathname).toBe('/work')
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await waitFor(() => expect(error).toHaveBeenCalledTimes(2))
      expect(router.state.location.pathname).toBe('/work')
      await act(async () => { await router.navigate('/other') })
      await waitFor(() => expect(error).toHaveBeenCalledTimes(3))
      expect(screen.getByText('Protected workflow')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
      await userEvent.click(screen.getByRole('link', { name: 'Go' }))
      expect(await screen.findByText('Other page')).toBeInTheDocument()
    } finally { error.mockRestore() }
  })

  it('permits a security logout redirect even when a workflow is open', async () => {
    const { router } = mount()
    expect(isSensitiveNavigationBlocked()).toBe(true)
    act(() => useAuthStore.setState({ user: null }))
    await act(async () => { await router.navigate('/login', { replace: true }) })
    expect(await screen.findByText('Login')).toBeInTheDocument()
  })

  it('requests a browser unload warning with independent locks; logout and final release disable it', () => {
    const first = holdSensitiveNavigation()
    const second = holdSensitiveNavigation()
    const tryUnload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }
    try {
      expect(tryUnload()).toBe(true)
      first(); first()
      expect(tryUnload()).toBe(true)
      act(() => useAuthStore.setState({ user: null }))
      expect(tryUnload()).toBe(false)
    } finally { first(); second() }
    expect(isSensitiveNavigationBlocked()).toBe(false)
    expect(tryUnload()).toBe(false)
  })
})
