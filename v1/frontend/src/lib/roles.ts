import type { AppRole } from '@/lib/constants'
import { ROLES } from '@/lib/constants'
import type { MeUser } from '@/lib/api-types'

/** FE-15: `roles` može doći bez niza (djelimičan `me` poslije prebacivanja firme) — FE-13 lekcija. */
export function assignableRoles(user: MeUser): AppRole[] {
  const roles = user.roles ?? []
  const hide = new Set<AppRole>(['PLATFORM_ADMIN'])
  if (!roles.includes('PLATFORM_ADMIN') && !roles.includes('SUPER_ADMIN')) {
    hide.add('SUPER_ADMIN')
  }
  return ROLES.filter((role) => !hide.has(role))
}

export function displayName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim()
}
