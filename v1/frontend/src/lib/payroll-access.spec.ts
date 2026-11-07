import { describe, expect, it } from 'vitest'
import type { MeUser } from '@/lib/api-types'
import { canDecidePayroll, canExportPayroll, canSeePayroll } from '@/lib/payroll-access'

/**
 * FE-08 — obračun ima **tri različita** prava (vidjeti / izvesti / odlučiti). Navigacija koristi
 * prvo, ekran obračuna drugo i treće; test drži da se ne spoje u jedno „ima payroll“.
 */
function user(overrides: Partial<MeUser> = {}): MeUser {
  return {
    id: 'u1',
    firstName: 'A',
    lastName: 'B',
    employeeCode: null,
    email: 'a@b.c',
    roles: ['WORKER'],
    permissions: [],
    companyId: 'c1',
    company: null,
    hourlyRate: null,
    mustChangePassword: false,
    locale: 'bs',
    ...overrides,
  }
}

describe('payroll pristup', () => {
  it('bez korisnika ništa nije dozvoljeno', () => {
    expect(canSeePayroll(null)).toBe(false)
    expect(canExportPayroll(null)).toBe(false)
    expect(canDecidePayroll(null)).toBe(false)
  })

  it('`payroll.read` daje pregled i izvoz, ali ne odluku', () => {
    const accountant = user({ roles: ['ACCOUNTANT'], permissions: ['payroll.read'] })
    expect(canSeePayroll(accountant)).toBe(true)
    expect(canExportPayroll(accountant)).toBe(true)
    expect(canDecidePayroll(accountant)).toBe(false)
  })

  it('nadzornik vidi obračun i bez `payroll.read`, ali ga ne izvozi', () => {
    const supervisor = user({ roles: ['SITE_SUPERVISOR'] })
    expect(canSeePayroll(supervisor)).toBe(true)
    expect(canExportPayroll(supervisor)).toBe(false)
    expect(canDecidePayroll(supervisor)).toBe(true)
  })

  it('radnik ne vidi obračun', () => {
    expect(canSeePayroll(user())).toBe(false)
  })
})
