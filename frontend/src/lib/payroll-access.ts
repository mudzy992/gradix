import type { MeUser } from '@/lib/api-types'

const APPROVER_ROLES = new Set(['SITE_SUPERVISOR', 'PROJECT_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN'])

export function canSeePayroll(user: MeUser | null | undefined): boolean {
  if (!user) {
    return false
  }
  if (user.permissions.includes('payroll.read')) {
    return true
  }
  return user.roles.some((role) => role === 'SITE_SUPERVISOR' || role === 'PROJECT_MANAGER')
}

export function canExportPayroll(user: MeUser | null | undefined): boolean {
  return user?.permissions.includes('payroll.read') ?? false
}

export function canDecidePayroll(user: MeUser | null | undefined): boolean {
  return user?.roles.some((role) => APPROVER_ROLES.has(role)) ?? false
}
