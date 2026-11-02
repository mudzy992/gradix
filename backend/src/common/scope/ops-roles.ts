import { AuthUser } from '../types/auth-user';
import { AppRole } from '../rbac/roles';

export function hasRole(actor: AuthUser, ...roles: AppRole[]): boolean {
  return roles.some((role) => actor.roles.includes(role));
}

export function isCompanyWide(actor: AuthUser): boolean {
  return hasRole(actor, 'PLATFORM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT');
}

export function canListProjects(actor: AuthUser): boolean {
  return hasRole(
    actor,
    'PLATFORM_ADMIN',
    'SUPER_ADMIN',
    'ADMIN',
    'ACCOUNTANT',
    'PROJECT_MANAGER',
    'SITE_SUPERVISOR',
  );
}

export function canWatchProjectTimers(actor: AuthUser): boolean {
  return hasRole(
    actor,
    'PLATFORM_ADMIN',
    'SUPER_ADMIN',
    'ADMIN',
    'PROJECT_MANAGER',
    'SITE_SUPERVISOR',
  );
}

export function hidesBudget(actor: AuthUser): boolean {
  if (
    isCompanyWide(actor) ||
    hasRole(actor, 'PROJECT_MANAGER', 'SITE_SUPERVISOR')
  ) {
    return false;
  }
  return hasRole(actor, 'WORKER', 'MACHINE_OPERATOR', 'DRIVER');
}

export function canPickProjects(actor: AuthUser): boolean {
  return hasRole(actor, 'DRIVER', 'MACHINE_OPERATOR');
}

export function canWriteCatalog(actor: AuthUser): boolean {
  return (
    actor.permissions.includes('trips.write') ||
    actor.permissions.includes('settings.write')
  );
}

export function canReadCatalog(actor: AuthUser): boolean {
  return (
    actor.permissions.includes('trips.read') ||
    actor.permissions.includes('trips.write') ||
    actor.permissions.includes('settings.write')
  );
}

export function canDecommission(actor: AuthUser): boolean {
  return hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN');
}

export function canAmend(actor: AuthUser): boolean {
  return hasRole(
    actor,
    'SITE_SUPERVISOR',
    'ADMIN',
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
  );
}

export function canWritePlannedQty(actor: AuthUser): boolean {
  return hasRole(
    actor,
    'ADMIN',
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
    'PROJECT_MANAGER',
  );
}
