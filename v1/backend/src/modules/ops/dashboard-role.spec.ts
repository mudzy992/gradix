import type { AuthUser } from '../../common/types/auth-user';
import type { Permission } from '../../common/rbac/permission.constants';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AppRole } from '../../common/rbac/roles';
import { resolveDashboardView } from './dashboard-role';

function actor(roles: AppRole[], permissions: Permission[] = []): AuthUser {
  return {
    id: 'u1',
    email: 'u1@gradix.local',
    firstName: 'Test',
    lastName: 'Korisnik',
    employeeCode: null,
    companyId: 'c1',
    company: { id: 'c1', name: 'Firma', slug: 'firma' },
    hourlyRate: null,
    isActive: true,
    mustChangePassword: false,
    locale: 'bs',
    roles,
    permissions,
    tenantCompanyId: 'c1',
  };
}

describe('resolveDashboardView (BE-12)', () => {
  it('company-wide role uvijek dobija admin dashboard', () => {
    expect(resolveDashboardView(actor(['ADMIN', 'WORKER']))).toBe('admin');
    expect(resolveDashboardView(actor(['SUPER_ADMIN']))).toBe('admin');
  });

  it('PM/SS nadjačava terenske role (više rola = širi dashboard)', () => {
    expect(resolveDashboardView(actor(['PROJECT_MANAGER', 'WORKER']))).toBe(
      'pmSs',
    );
    expect(resolveDashboardView(actor(['SITE_SUPERVISOR', 'DRIVER']))).toBe(
      'pmSs',
    );
  });

  it('vozač ima prioritet nad radnikom, ali ne nad PM/SS', () => {
    expect(resolveDashboardView(actor(['DRIVER', 'WORKER']))).toBe('driver');
    expect(resolveDashboardView(actor(['WORKER']))).toBe('fieldWorker');
    expect(resolveDashboardView(actor(['MACHINE_OPERATOR']))).toBe(
      'fieldWorker',
    );
  });

  it('mehaničar dobija svoj dashboard, ne projektni', () => {
    expect(resolveDashboardView(actor(['MECHANIC']))).toBe('mechanic');
    expect(
      resolveDashboardView(
        actor(
          ['MECHANIC'],
          [PERMISSIONS.FLEET_READ, PERMISSIONS.SERVICES_READ],
        ),
      ),
    ).toBe('mechanic');
  });

  it('nepoznata rola ne pada — dobija projektni dashboard', () => {
    expect(resolveDashboardView(actor([]))).toBe('pmSs');
  });
});
