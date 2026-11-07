import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_KEYS } from '@/lib/settings-keys'
import type { SettingRow } from '@/lib/api-types'
import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { SettingsPage } from '@/pages/settings-page'

/**
 * FE-13 — postavke. Drži dvije stvari koje su bile opasne:
 * 1) forma firme se prikazuje **samo** kad su podaci učitani (prije se prazna forma slala i gazila
 *    naziv/JIB/adresu kad `GET` padne), uz grešku i ponovni pokušaj;
 * 2) registar postavki ima **labele i prevedene opise** (prije je uz polje stajao goli tehnički ključ
 *    i engleski opis), brojevi se ne pretvaraju u `0` kad se polje isprazni, a „Sačuvaj“ je
 *    onemogućen dok nema izmjena.
 */
const getTenantCompany = vi.fn()
const patchTenantCompany = vi.fn()
const uploadFile = vi.fn()
const listSettings = vi.fn()
const putSettings = vi.fn()

vi.mock('@/lib/api', () => ({
  getTenantCompany: () => getTenantCompany(),
  patchTenantCompany: (body: unknown) => patchTenantCompany(body),
  uploadFile: (file: File) => uploadFile(file),
  listSettings: () => listSettings(),
  putSettings: (body: unknown) => putSettings(body),
}))

vi.mock('@/lib/api-ops', () => ({
  uploadPublicAsset: vi.fn(),
}))

function setting(overrides: Partial<SettingRow> = {}): SettingRow {
  return {
    key: 'app.currency',
    scope: 'PUBLIC',
    description: 'Default currency code',
    value: 'BAM',
    ...overrides,
  }
}

const ROWS: SettingRow[] = [
  setting(),
  setting({ key: 'timer.maxOpenHours', scope: 'PRIVATE', description: 'Auto-close hours', value: 12 }),
  setting({ key: 'features.email', scope: 'PRIVATE', description: 'Email stubs', value: false }),
  setting({ key: 'smtp.password', scope: 'SECRET', description: 'SMTP password', value: '***' }),
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getTenantCompany.mockReset().mockResolvedValue({
    data: {
      id: 'c1',
      name: 'Gradix d.o.o.',
      slug: 'gradix',
      isActive: true,
      legalName: 'Gradix društvo s ograničenom odgovornošću',
      address: 'Ferhadija 1',
      city: 'Sarajevo',
      country: 'BA',
      taxId: '4200000000',
      phone: null,
      email: null,
      logoPath: null,
      logoAssetId: null,
    },
  })
  patchTenantCompany.mockReset().mockResolvedValue({})
  uploadFile.mockReset().mockResolvedValue({ data: { path: 'uploads/logo.png' } })
  listSettings.mockReset().mockResolvedValue({ data: ROWS })
  putSettings.mockReset().mockResolvedValue({})
  useAuthStore.setState({
    user: {
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      employeeCode: null,
      email: 'admin@gradix.local',
      roles: ['ADMIN'],
      permissions: ['settings.read', 'settings.write', 'public.write'],
      companyId: 'c1',
      company: null,
      hourlyRate: null,
      mustChangePassword: false,
      locale: 'bs',
    },
    accessToken: 't',
    ready: true,
  })
  useCompanyStore.setState({ selectedId: 'c1' })
})

describe('SettingsPage', () => {
  it('prikazuje podatke firme tek kad su učitani (naziv, JIB, slug sa labelom)', async () => {
    renderPage()

    expect(await screen.findByDisplayValue('Gradix d.o.o.')).toBeInTheDocument()
    expect(screen.getByLabelText('Naziv')).toBeInTheDocument()
    expect(screen.getByLabelText('JIB / porezni broj')).toHaveValue('4200000000')
    expect(screen.getByLabelText('Slug')).toBeDisabled()
    expect(screen.getByLabelText('Logo')).toHaveAttribute('type', 'file')
  })

  it('pad podataka firme sakriva formu i nudi ponovni pokušaj (bez gazenja podataka)', async () => {
    getTenantCompany.mockRejectedValueOnce(new Error('mreža'))
    getTenantCompany.mockResolvedValueOnce({
      data: {
        id: 'c1',
        name: 'Gradix d.o.o.',
        slug: 'gradix',
        isActive: true,
        legalName: null,
        address: null,
        city: null,
        country: null,
        taxId: null,
        phone: null,
        email: null,
        logoPath: null,
        logoAssetId: null,
      },
    })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Podaci firme se nisu učitali.')
    const companyCard = screen.getByRole('region', { name: 'Firma' })
    expect(within(companyCard).queryByRole('button', { name: 'Sačuvaj' })).not.toBeInTheDocument()
    expect(within(companyCard).queryByLabelText('Naziv')).not.toBeInTheDocument()

    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByDisplayValue('Gradix d.o.o.')).toBeInTheDocument()
  })

  it('registar ima prevedene labele i opise, ne sirove ključeve', async () => {
    renderPage()
    const registry = await screen.findByRole('region', { name: 'Aplikacija' })
    expect(await within(registry).findByLabelText('Valuta')).toBeInTheDocument()
    expect(screen.getByText('Kod valute koji se prikazuje uz iznose.')).toBeInTheDocument()
    expect(within(registry).getByLabelText('Maksimalno trajanje timera (h)')).toHaveValue('12')
    expect(screen.queryByText('Default currency code')).not.toBeInTheDocument()
  })

  it('„Sačuvaj“ je onemogućen dok nema izmjena, pa se uključi', async () => {
    renderPage()
    const registry = await screen.findByRole('region', { name: 'Aplikacija' })
    expect(await within(registry).findByLabelText('Valuta')).toBeInTheDocument()

    const save = within(registry).getByRole('button', { name: 'Sačuvaj' })
    expect(save).toBeDisabled()
    expect(within(registry).getByText('Nema izmjena')).toBeInTheDocument()

    await userEvent.type(within(registry).getByLabelText('Valuta'), 'KM')
    expect(save).toBeEnabled()
  })

  it('čuvanje šalje samo izmijenjena polja i preskače prazna/secret', async () => {
    renderPage()
    const registry = await screen.findByRole('region', { name: 'Aplikacija' })
    expect(await within(registry).findByLabelText('Valuta')).toBeInTheDocument()

    await userEvent.clear(within(registry).getByLabelText('Valuta'))
    await userEvent.type(within(registry).getByLabelText('Valuta'), 'KM')
    await userEvent.clear(within(registry).getByLabelText('Maksimalno trajanje timera (h)'))
    await userEvent.click(within(registry).getByRole('button', { name: 'Sačuvaj' }))

    const body = putSettings.mock.calls[0][0] as Record<string, unknown>
    expect(body['app.currency']).toBe('KM')
    expect(body['features.email']).toBe(false)
    // Prazno numeričko polje se ne upisuje (prije: `Number('')` = 0), a prazan secret se ne dira.
    expect(body).not.toHaveProperty('timer.maxOpenHours')
    expect(body).not.toHaveProperty('smtp.password')
  })

  it('broj koji nije broj prijavi grešku umjesto tihog upisa nule', async () => {
    renderPage()
    const registry = await screen.findByRole('region', { name: 'Aplikacija' })
    expect(await within(registry).findByLabelText('Valuta')).toBeInTheDocument()

    const numberInput = within(registry).getByLabelText('Maksimalno trajanje timera (h)')
    await userEvent.clear(numberInput)
    await userEvent.type(numberInput, 'abc')
    await userEvent.click(within(registry).getByRole('button', { name: 'Sačuvaj' }))

    expect(putSettings).not.toHaveBeenCalled()
    expect(await screen.findByText('Polje „timer.maxOpenHours“ mora biti broj.')).toBeInTheDocument()
  })


  it('čuvanje šalje podatke firme i upload loga mijenja putanju', async () => {
    renderPage()
    const companyCard = await screen.findByRole('region', { name: 'Firma' })
    const name = await within(companyCard).findByLabelText('Naziv')

    await userEvent.clear(name)
    await userEvent.type(name, 'Gradix gradnja d.o.o.')
    await userEvent.click(within(companyCard).getByRole('button', { name: 'Sačuvaj' }))
    expect(patchTenantCompany).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gradix gradnja d.o.o.' }))

    const file = new File(['logo'], 'logo.png', { type: 'image/png' })
    await userEvent.upload(within(companyCard).getByLabelText('Logo'), file)
    expect(uploadFile).toHaveBeenCalledWith(file)
    expect(patchTenantCompany).toHaveBeenCalledWith({ logoPath: 'uploads/logo.png' })
  })

  it('bez izabrane firme platform admin vidi uputu umjesto formi', async () => {
    useAuthStore.setState({
      user: {
        id: 'u1',
        firstName: 'A',
        lastName: 'B',
        employeeCode: null,
        email: 'platform@gradix.local',
        roles: ['PLATFORM_ADMIN'],
        permissions: ['settings.read', 'settings.write', 'public.write'],
        companyId: null,
        company: null,
        hourlyRate: null,
        mustChangePassword: false,
        locale: 'bs',
      },
      accessToken: 't',
      ready: true,
    })
    useCompanyStore.setState({ selectedId: null })
    renderPage()

    expect(await screen.findByText('Izaberite firmu da uredite postavke.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Aplikacija' })).not.toBeInTheDocument()
  })

  it('bez `public.write` nema bloka javnog sajta', async () => {
    useAuthStore.setState({
      user: {
        id: 'u1',
        firstName: 'A',
        lastName: 'B',
        employeeCode: null,
        email: 'admin@gradix.local',
        roles: ['ADMIN'],
        permissions: ['settings.read', 'settings.write'],
        companyId: 'c1',
        company: null,
        hourlyRate: null,
        mustChangePassword: false,
        locale: 'bs',
      },
      accessToken: 't',
      ready: true,
    })
    renderPage()

    expect(await screen.findByRole('region', { name: 'Firma' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Javni logo' })).not.toBeInTheDocument()
  })

  it('svi ključevi iz registra imaju prijevod u bs i en', () => {
    for (const lng of ['bs', 'en'] as const) {
      for (const key of SETTINGS_KEYS) {
        expect(i18n.exists(`settings.keys.${key}.label`, { lng }), `${lng}: ${key}`).toBe(true)
        expect(i18n.exists(`settings.keys.${key}.description`, { lng }), `${lng}: ${key}`).toBe(true)
      }
    }
  })
})
