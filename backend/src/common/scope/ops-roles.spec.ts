import type { AuthUser } from '../types/auth-user';
import { PERMISSIONS } from '../rbac/permission.constants';
import {
  canAmend,
  canDecommission,
  canListProjects,
  canPickProjects,
  canReadCatalog,
  canWatchProjectTimers,
  canWriteCatalog,
  hidesBudget,
  isCompanyWide,
} from './ops-roles';

function actor(roles: AuthUser['roles'], permissions: string[] = []): AuthUser {
  return {
    id: 'u1',
    email: 'u@example.com',
    firstName: 'U',
    lastName: 'One',
    employeeCode: null,
    companyId: 'c1',
    company: null,
    hourlyRate: null,
    isActive: true,
    mustChangePassword: false,
    locale: 'bs',
    roles,
    permissions: permissions as AuthUser['permissions'],
    tenantCompanyId: 'c1',
  };
}

describe('isCompanyWide', () => {
  it('samo kancelarijske role vide cijelu firmu', () => {
    expect(isCompanyWide(actor(['ADMIN']))).toBe(true);
    expect(isCompanyWide(actor(['ACCOUNTANT']))).toBe(true);
    expect(isCompanyWide(actor(['WORKER']))).toBe(false);
    expect(isCompanyWide(actor(['MECHANIC']))).toBe(false);
  });
});

describe('hidesBudget', () => {
  it('terenske role ne vide budžet', () => {
    expect(hidesBudget(actor(['WORKER']))).toBe(true);
    expect(hidesBudget(actor(['DRIVER']))).toBe(true);
    expect(hidesBudget(actor(['MACHINE_OPERATOR']))).toBe(true);
  });

  it('kancelarija i nadzor vide budžet', () => {
    expect(hidesBudget(actor(['ADMIN']))).toBe(false);
    expect(hidesBudget(actor(['PROJECT_MANAGER']))).toBe(false);
    expect(hidesBudget(actor(['SITE_SUPERVISOR']))).toBe(false);
  });

  it('poznato ponašanje: MECHANIC/ACCOUNTANT/ostale role vide budžet (deny-by-default bi bio stroži)', () => {
    expect(hidesBudget(actor(['MECHANIC']))).toBe(false);
    expect(hidesBudget(actor(['ACCOUNTANT']))).toBe(false);
  });
});

describe('project i katalog dozvole', () => {
  it('lista projekata: nadzor da, radnik ne', () => {
    expect(canListProjects(actor(['PROJECT_MANAGER']))).toBe(true);
    expect(canListProjects(actor(['WORKER']))).toBe(false);
  });

  it('timer nadzor: samo nadzorne role', () => {
    expect(canWatchProjectTimers(actor(['SITE_SUPERVISOR']))).toBe(true);
    expect(canWatchProjectTimers(actor(['DRIVER']))).toBe(false);
  });

  it('vozač/operator bira projekat, radnik ne', () => {
    expect(canPickProjects(actor(['DRIVER']))).toBe(true);
    expect(canPickProjects(actor(['MACHINE_OPERATOR']))).toBe(true);
    expect(canPickProjects(actor(['WORKER']))).toBe(false);
  });

  it('katalog: pisanje ide preko permisija, ne role', () => {
    expect(canWriteCatalog(actor(['DRIVER'], [PERMISSIONS.TRIPS_WRITE]))).toBe(
      true,
    );
    expect(canWriteCatalog(actor(['DRIVER']))).toBe(false);
    expect(canReadCatalog(actor(['DRIVER'], [PERMISSIONS.TRIPS_READ]))).toBe(
      true,
    );
    expect(canReadCatalog(actor(['WORKER']))).toBe(false);
  });

  it('dekomisija i amandmani: samo nadzorne role', () => {
    expect(canDecommission(actor(['ADMIN']))).toBe(true);
    expect(canDecommission(actor(['SITE_SUPERVISOR']))).toBe(false);
    expect(canAmend(actor(['SITE_SUPERVISOR']))).toBe(true);
    expect(canAmend(actor(['WORKER']))).toBe(false);
  });
});
