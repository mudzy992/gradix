import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { PublicBrandFields } from '@/components/settings/public-brand-fields'

/**
 * FE-14 — logo za javni sajt. Drži: upload mijenja logo i traži osvježavanje, greška učitavanja
 * podataka firme je vidljiva (prije je kartica izgledala prazno), a fajl se ne može odabrati dok
 * upload traje (prije se mogao pokrenuti više puta zaredom).
 */
const getTenantCompany = vi.fn()
const uploadPublicAsset = vi.fn()

vi.mock('@/lib/api', () => ({
  getTenantCompany: () => getTenantCompany(),
}))

vi.mock('@/lib/api-ops', () => ({
  uploadPublicAsset: (file: File, kind: string) => uploadPublicAsset(file, kind),
}))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PublicBrandFields />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getTenantCompany.mockReset().mockResolvedValue({
    data: { id: 'c1', name: 'Demo Gradnja', slug: 'demo', logoAssetId: null, logoPath: null },
  })
  uploadPublicAsset.mockReset().mockResolvedValue({ data: { id: 'asset-1' } })
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'a@b.c',
      roles: ['ADMIN'],
      permissions: ['public.write'],
      companyId: 'c1',
      company: { slug: 'demo' } as never,
      hourlyRate: null,
      mustChangePassword: false,
      locale: 'bs',
    },
    accessToken: 't',
    ready: true,
  })
})

describe('PublicBrandFields', () => {
  it('upload javnog loga zove `uploadPublicAsset` sa vrstom LOGO', async () => {
    const { container } = renderCard()

    // Region i polje nose isti naziv („Javni logo“), pa `getByLabelText` nađe dva elementa — ciljamo id.
    const input = container.querySelector<HTMLInputElement>('#public-logo') as HTMLInputElement
    // Polje je onemogućeno dok `GET /company` traje (prije se mogao odabrati fajl bez podataka firme).
    await waitFor(() => expect(input).not.toBeDisabled())
    const file = new File(['logo'], 'logo.png', { type: 'image/png' })
    await userEvent.upload(input, file)

    expect(uploadPublicAsset).toHaveBeenCalledWith(file, 'LOGO')
  })

  it('prikazuje postavljeni logo i link na javni sajt', async () => {
    getTenantCompany.mockResolvedValue({
      data: { id: 'c1', name: 'Demo Gradnja', slug: 'demo', logoAssetId: 'asset-9', logoPath: null },
    })
    renderCard()

    expect(await screen.findByText('Logo je postavljen.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Otvori javni sajt' })).toHaveAttribute('href', '/p/demo')
  })

  it('kad podaci firme padnu kartica se skriva (poruku nosi kartica „Firma“, bez duplog alerta)', async () => {
    getTenantCompany.mockRejectedValueOnce(new Error('mreža'))
    const { container } = renderCard()

    await waitFor(() => expect(container.querySelector('#public-logo')).toBeNull())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
