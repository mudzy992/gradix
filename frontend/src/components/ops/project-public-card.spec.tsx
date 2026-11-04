import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectPublicCard } from './project-public-card'

const upload = vi.fn()
const patch = vi.fn()
const toastError = vi.fn()
vi.mock('@/lib/api-ops', () => ({
  uploadPublicAsset: (file: File, kind: string, projectId: string) => upload(file, kind, projectId),
  patchProjectPublic: (id: string, body: unknown) => patch(id, body),
}))
vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message), success: vi.fn() } }))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(<QueryClientProvider client={client}><ProjectPublicCard projectId="p1" isPublic={false} coverAssetId={null} /></QueryClientProvider>)
  return { invalidate }
}

beforeEach(() => {
  upload.mockReset()
  patch.mockReset()
  toastError.mockReset()
})

describe('ProjectPublicCard', () => {
  it('štiti upload dok traje i osvježava projekat po uspjehu', async () => {
    let resolve!: () => void
    upload.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const { invalidate } = renderCard()
    const file = new File(['slika'], 'slika.png', { type: 'image/png' })
    const input = screen.getByLabelText('Cover fotografija')
    await userEvent.upload(input, file)
    expect(upload).toHaveBeenCalledWith(file, 'COVER', 'p1')
    expect(input).toBeDisabled()
    expect(screen.getByRole('status')).toBeInTheDocument()
    resolve()
    await waitFor(() => expect(input).toBeEnabled())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project', 'p1'] })
  })

  it('poslije neuspjeha dozvoljava ponovni izbor istog fajla', async () => {
    upload.mockRejectedValueOnce(new Error('mreža')).mockResolvedValueOnce({})
    renderCard()
    const file = new File(['slika'], 'slika.png', { type: 'image/png' })
    const input = screen.getByLabelText('Cover fotografija')
    await userEvent.upload(input, file)
    await waitFor(() => expect(toastError).toHaveBeenCalledOnce())
    await waitFor(() => expect(input).toBeEnabled())
    await userEvent.upload(input, file)
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
  })

  it('promjena vidljivosti šalje vrijednost i osvježava projekat', async () => {
    patch.mockResolvedValue({})
    const { invalidate } = renderCard()
    await userEvent.click(screen.getByRole('switch', { name: 'Prikaži na javnom sajtu' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith('p1', { isPublic: true }))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project', 'p1'] }))
  })
})
