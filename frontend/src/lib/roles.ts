import type { AppRole } from '@/lib/constants'
import { ROLES } from '@/lib/constants'
import type { MeUser } from '@/lib/api-types'

export function assignableRoles(user: MeUser): AppRole[] {
  const hide = new Set<AppRole>(['PLATFORM_ADMIN'])
  if (!user.roles.includes('PLATFORM_ADMIN') && !user.roles.includes('SUPER_ADMIN')) {
    hide.add('SUPER_ADMIN')
  }
  return ROLES.filter((role) => !hide.has(role))
}

export function displayName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim()
}
