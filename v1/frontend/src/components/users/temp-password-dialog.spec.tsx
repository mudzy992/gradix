import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TempPasswordDialog } from '@/components/users/temp-password-dialog'
import { useCompanyStore } from '@/stores/company-store'

/**
 * FE-13 — privremena lozinka. Drži da kopiranje ne baca neuhvaćenu grešku kad `navigator.clipboard`
 * ne postoji (http / stari browser), nego označi tekst i kaže korisniku šta da radi.
 */
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message), success: vi.fn() } }))

const originalClipboard = navigator.clipboard

beforeEach(() => {
  toastError.mockReset()
})

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true })
})

describe('TempPasswordDialog', () => {
  it('kopira lozinku kad clipboard postoji', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<TempPasswordDialog password="Temp-1234" onClose={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Kopiraj' }))
    expect(writeText).toHaveBeenCalledWith('Temp-1234')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('bez clipboarda označi tekst i prijavi da kopiranje nije moguće', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    render(<TempPasswordDialog password="Temp-1234" onClose={() => {}} />)

    const code = await screen.findByText('Temp-1234')
    await userEvent.click(screen.getByRole('button', { name: 'Kopiraj' }))

    expect(toastError).toHaveBeenCalledWith(
      'Kopiranje nije dozvoljeno u ovom pregledu — označite lozinku i kopirajte ručno.',
    )
    expect(window.getSelection()?.toString()).toContain('Temp-1234')
    expect(code).toHaveClass('select-all')
  })

  it('dok je jednokratna lozinka prikazana ne dozvoljava promjenu firme', () => {
    useCompanyStore.setState({ selectedId: 'a' })
    const { rerender } = render(<TempPasswordDialog password="Temp-1234" onClose={() => {}} />)
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    expect(screen.getByText('Temp-1234')).toBeInTheDocument()
    expect(useCompanyStore.getState().selectedId).toBe('a')
    rerender(<TempPasswordDialog password={null} onClose={() => {}} />)
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(true)
  })

  it('„Potvrdi“ zatvara dijalog', async () => {
    const onClose = vi.fn()
    render(<TempPasswordDialog password="Temp-1234" onClose={onClose} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Potvrdi' }))
    expect(onClose).toHaveBeenCalled()
  })
})
