import { describe, expect, it } from 'vitest'
import type { MeUser } from '@/lib/api-types'
import { assignableRoles, displayName } from '@/lib/roles'
import { ROLES } from '@/lib/constants'

/**
 * FE-15 — `assignableRoles` je čitao `user.roles.includes` bez zaštite; djelimičan `me` odgovor
 * (bez `roles`) rušio je formu korisnika. Sada: bez `roles` nema dodatnih prava, a `PLATFORM_ADMIN`
 * nikad nije dodjeljiv iz obrasca firme.
 */
function user(roles: string[] | undefined): MeUser {
  return { id: 'u1', roles, firstName: 'A', lastName: 'B' } as unknown as MeUser
}

describe('assignableRoles', () => {
  it('običan administrator ne može dodijeliti PLATFORM_ADMIN ni SUPER_ADMIN', () => {
    const roles = assignableRoles(user(['ADMIN']))

    expect(roles).not.toContain('PLATFORM_ADMIN')
    expect(roles).not.toContain('SUPER_ADMIN')
    expect(roles).toContain('WORKER')
  })

  it('super administrator može dodijeliti SUPER_ADMIN, ali ne PLATFORM_ADMIN', () => {
    const roles = assignableRoles(user(['SUPER_ADMIN']))

    expect(roles).toContain('SUPER_ADMIN')
    expect(roles).not.toContain('PLATFORM_ADMIN')
  })

  it('platform administrator ne dobija sebe u listi (nema eskalacije iz UI-a)', () => {
    const roles = assignableRoles(user(['PLATFORM_ADMIN']))

    expect(roles).not.toContain('PLATFORM_ADMIN')
    expect(roles).toEqual(ROLES.filter((role) => role !== 'PLATFORM_ADMIN'))
  })

  it('nedostajući `roles` ne ruši funkciju', () => {
    expect(() => assignableRoles(user(undefined))).not.toThrow()
    expect(assignableRoles(user(undefined))).not.toContain('SUPER_ADMIN')
  })
})

describe('displayName', () => {
  it('spaja ime i prezime bez viška razmaka', () => {
    expect(displayName({ firstName: 'Demo', lastName: 'Admin' })).toBe('Demo Admin')
    expect(displayName({ firstName: 'Demo', lastName: '' })).toBe('Demo')
  })
})
