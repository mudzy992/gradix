import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { SessionRecovery } from './session-recovery'

describe('SessionRecovery', () => {
  it('kod nepoznatog ishoda nudi samo novu prijavu, bez ponavljanja starog tokena', async () => {
    await i18n.changeLanguage('bs')
    render(<SessionRecovery error="AUTH_REFRESH_UNCERTAIN" onRetry={vi.fn()} onContinue={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/ponovo se prijavite/i)
    expect(screen.queryByRole('button', { name: /ponovi obnovu/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nastavi/i })).toBeInTheDocument()
  })

  it.each(['RATE_LIMITED', 'NETWORK_ERROR'] as const)('objašnjava %s i daje izbor retry/nastavak', async (error) => {
    await i18n.changeLanguage('bs')
    const retry = vi.fn()
    const proceed = vi.fn()
    render(<SessionRecovery error={error} onRetry={retry} onContinue={proceed} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Obnova sesije nije uspjela' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t(`errors.${error}`))
    await userEvent.click(screen.getByRole('button', { name: 'Ponovi obnovu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Nastavi bez obnove' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(proceed).toHaveBeenCalledOnce()
  })
})
