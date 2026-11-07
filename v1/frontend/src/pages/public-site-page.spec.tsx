import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-types'
import type { PublicCompany, PublicProject } from '@/lib/api-public'
import { PublicSitePage } from '@/pages/public-site-page'

/**
 * FE-14 — javni sajt (`/p/:slug`, bez prijave). Drži: skeleton umjesto praznog ekrana, **razliku
 * između 404 i prave greške** uz ponovni pokušaj, preveden status projekta (prije sirov enum kad
 * projekat nema lokaciju), `dt`/`dd` u kontakt bloku, pad liste projekata koji ne ruši stranicu, te
 * SEO meta (`title`, `description`, `og:*`, `canonical`) i `<html lang>` koji prati izbor jezika.
 */
const getPublicCompany = vi.fn()
const listPublicProjects = vi.fn()

vi.mock('@/lib/api-public', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-public')>('@/lib/api-public')
  return {
    ...actual,
    getPublicCompany: (slug: string) => getPublicCompany(slug),
    listPublicProjects: (slug: string) => listPublicProjects(slug),
  }
})

function company(overrides: Partial<PublicCompany> = {}): PublicCompany {
  return {
    slug: 'demo',
    name: 'Demo Gradnja',
    tagline: 'Gradimo pouzdano.',
    city: 'Sarajevo',
    address: 'Ferhadija 1',
    phone: '+38733111222',
    logoAssetId: null,
    contact: 'info@demo.local',
    ...overrides,
  }
}

function project(overrides: Partial<PublicProject> = {}): PublicProject {
  return {
    id: 'p1',
    name: 'Sarajevo obilaznica',
    locality: null,
    status: 'PLANNING',
    coverAssetId: null,
    ...overrides,
  }
}

function renderPage(slug = 'demo') {
  return render(
    <MemoryRouter initialEntries={[`/p/${slug}`]}>
      <Routes>
        <Route path="/p/:slug" element={<PublicSitePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getPublicCompany.mockReset().mockResolvedValue({ data: company() })
  listPublicProjects.mockReset().mockResolvedValue({ data: [project()], meta: { page: 1, limit: 20, total: 1 } })
  // Redoslijed je važan: `head.innerHTML = ''` uklanja i `<title>`, pa bi naslov ostao prazan.
  document.head.innerHTML = ''
  document.title = 'Gradix'
  document.documentElement.lang = 'bs'
})

describe('PublicSitePage', () => {
  it('dok se učitava prikazuje skeleton sa aria-busy, ne prazan ekran', async () => {
    getPublicCompany.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()

    expect(await screen.findByText('Učitavanje…')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('prikazuje firmu, kontakt i preveden status projekta (bez sirovih enuma)', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Gradnja' })).toBeInTheDocument()
    expect(screen.getByText('Gradimo pouzdano.')).toBeInTheDocument()
    expect(screen.getByText('Ferhadija 1, Sarajevo')).toBeInTheDocument()
    expect(screen.getByText('info@demo.local')).toBeInTheDocument()
    // Status projekta je preveden i kad nema lokacije (prije: „PLANNING“).
    expect(await screen.findByText('U planu')).toBeInTheDocument()
    expect(screen.queryByText(/^(PLANNING|IN_PROGRESS|ON_HOLD|COMPLETED|CANCELLED)$/)).not.toBeInTheDocument()
  })

  it('telefon i e-mail su klikabilni (tel:/mailto:)', async () => {
    renderPage()

    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('link', { name: '+38733111222' })).toHaveAttribute('href', 'tel:+38733111222')
    expect(screen.getByRole('link', { name: 'info@demo.local' })).toHaveAttribute('href', 'mailto:info@demo.local')
  })

  it('kontakt koji nije e-mail ostaje tekst (bez lažnog mailto:)', async () => {
    getPublicCompany.mockResolvedValue({ data: company({ contact: 'Pon–Pet 08–16h' }) })
    renderPage()

    expect(await screen.findByText('Pon–Pet 08–16h')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Pon–Pet 08–16h' })).not.toBeInTheDocument()
  })

  it('kontakt blok koristi dt/dd (semantika definition liste)', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { level: 1 })
    const list = container.querySelector('dl')
    expect(list).not.toBeNull()
    expect(list?.querySelector('dt')?.textContent).toBe('Adresa')
    expect(list?.querySelector('dd')?.textContent).toBe('Ferhadija 1, Sarajevo')
  })

  it('postavlja SEO meta: title, description, og i canonical', async () => {
    renderPage()

    await screen.findByRole('heading', { level: 1 })
    // Efekat za meta podatke se izvršava poslije commita — `waitFor` drži test stabilnim.
    await waitFor(() => expect(document.title).toBe('Demo Gradnja — Gradimo pouzdano.'))
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Gradimo pouzdano.')
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      'Demo Gradnja — Gradimo pouzdano.',
    )
    expect(document.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('website')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/\/p\/demo$/)
  })

  it('prebacivanje jezika mijenja <html lang> i tekst, bez reloada', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1 })

    await waitFor(() => expect(document.documentElement.lang).toBe('bs'))
    await userEvent.click(screen.getByRole('button', { name: 'EN' }))

    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(screen.getByRole('heading', { level: 2, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByText('Planning')).toBeInTheDocument()
  })

  it('404 kaže „nije pronađeno“, a druga greška nudi ponovni pokušaj', async () => {
    getPublicCompany.mockRejectedValueOnce(new ApiError('NOT_FOUND', 'nema', 404))
    const { unmount } = renderPage()

    expect(await screen.findByText('Stranica nije pronađena.')).toBeInTheDocument()
    unmount()

    getPublicCompany.mockRejectedValueOnce(new ApiError('INTERNAL_ERROR', 'puklo', 500))
    getPublicCompany.mockResolvedValueOnce({ data: company() })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Stranica se trenutno ne može učitati.')
    expect(screen.queryByText('Stranica nije pronađena.')).not.toBeInTheDocument()

    await userEvent.click(within(alert).getByRole('button', { name: 'Pokušaj ponovo' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Gradnja' })).toBeInTheDocument()
  })

  it('429 (throttle) kaže „sačekajte“, a ne „nije pronađeno“ ni generičku grešku', async () => {
    getPublicCompany.mockRejectedValueOnce(new ApiError('TOO_MANY_REQUESTS', 'previše', 429))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Previše zahtjeva u kratkom roku.')
    expect(alert).toHaveTextContent('Sačekajte koji trenutak pa pokušajte ponovo.')
    expect(screen.queryByText('Stranica nije pronađena.')).not.toBeInTheDocument()
  })

  it('pad liste projekata ne sakriva firmu i kontakt', async () => {
    listPublicProjects.mockRejectedValue(new Error('mreža'))
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Gradnja' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Projekti se nisu učitali — kontakt podaci su tačni.')
    expect(screen.getByText('info@demo.local')).toBeInTheDocument()
  })

  it('bez projekata prikazuje prazno stanje', async () => {
    listPublicProjects.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } })
    renderPage()

    expect(await screen.findByText('Nema javnih projekata.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
