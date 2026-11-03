import { describe, expect, it } from 'vitest'
import type { MeUser } from '@/lib/api-types'
import {
  NAV_ITEMS,
  NAV_SECTIONS,
  activeNavPath,
  isNavItemVisible,
  navLabelKeyFor,
} from '@/components/layout/navigation'

/**
 * FE-05 — navigacija je jedno mjesto gdje se odlučuje šta korisnik vidi. Testovi drže tri stvari:
 * (1) dashboard i javne stavke vidljive svima, (2) permission/tenant pravilo se **ne** zaobilazi
 * (prečice na dashboardu koriste istu funkciju), (3) aktivna stavka je najduži prefiks.
 */
function user(overrides: Partial<MeUser> = {}): MeUser {
  return {
    id: 'u1',
    firstName: 'Amar',
    lastName: 'Hodžić',
    employeeCode: null,
    email: 'amar@example.com',
    roles: ['ADMIN'],
    permissions: [],
    companyId: 'c1',
    company: null,
    hourlyRate: null,
    mustChangePassword: false,
    locale: 'bs',
    ...overrides,
  }
}

const item = (to: string) => NAV_ITEMS.find((entry) => entry.to === to)!

describe('isNavItemVisible()', () => {
  it('dashboard je vidljiv i bez korisnika (nema permission ni tenant uslov)', () => {
    expect(isNavItemVisible(item('/dashboard'), null)).toBe(true)
  })

  it('stavka sa permission-om je skrivena dok korisnik nema to pravo', () => {
    expect(isNavItemVisible(item('/projects'), user())).toBe(false)
    expect(isNavItemVisible(item('/projects'), user({ permissions: ['projects.read'] }))).toBe(true)
  })

  it('`anyPermission` propušta ako ima bilo koje od navedenih prava', () => {
    expect(isNavItemVisible(item('/tasks'), user({ permissions: ['tasks.read'] }))).toBe(true)
    expect(isNavItemVisible(item('/tasks'), user({ permissions: ['tasks.dispatch'] }))).toBe(true)
    expect(isNavItemVisible(item('/tasks'), user({ permissions: ['trips.read'] }))).toBe(false)
  })

  it('obračun ima svoje pravilo: supervizor ga vidi i bez `payroll.read`', () => {
    expect(isNavItemVisible(item('/payroll'), user({ roles: ['SITE_SUPERVISOR'] }))).toBe(true)
    expect(isNavItemVisible(item('/payroll'), user({ roles: ['WORKER'] }))).toBe(false)
    expect(isNavItemVisible(item('/payroll'), user({ roles: ['WORKER'], permissions: ['payroll.read'] }))).toBe(
      true,
    )
  })

  it('firme su plateau-only: vide se bez tenanta, ali traže `platform.companies`', () => {
    expect(isNavItemVisible(item('/companies'), user())).toBe(false)
    expect(isNavItemVisible(item('/companies'), user({ permissions: ['platform.companies'] }))).toBe(true)
  })
})

describe('activeNavPath() / navLabelKeyFor()', () => {
  it('najduži prefiks pobjeđuje (`/fleet/map` gasi `/fleet`)', () => {
    expect(activeNavPath('/fleet/map')).toBe('/fleet/map')
    expect(activeNavPath('/fleet')).toBe('/fleet')
  })

  it('detalj zapisa drži svoju listu aktivnom', () => {
    expect(activeNavPath('/projects/abc-123')).toBe('/projects')
  })

  it('nepoznata ruta nema aktivnu stavku ni naslov', () => {
    expect(activeNavPath('/nepostoji')).toBeNull()
    expect(navLabelKeyFor('/nepostoji')).toBeNull()
  })

  it('naslov dokumenta dolazi iz label ključa stavke', () => {
    expect(navLabelKeyFor('/dashboard')).toBe('nav.dashboard')
    expect(navLabelKeyFor('/projects/abc')).toBe('nav.projects')
  })
})

describe('NAV_SECTIONS', () => {
  it('rute su jedinstvene (duplikat bi tiho pojeo jednu stavku)', () => {
    const routes = NAV_ITEMS.map((entry) => entry.to)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('svaka stavka ima sekciju i label ključ', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.items.length).toBeGreaterThan(0)
      for (const entry of section.items) {
        expect(entry.labelKey).toMatch(/^nav\./)
        expect(entry.to.startsWith('/')).toBe(true)
      }
    }
  })
})
