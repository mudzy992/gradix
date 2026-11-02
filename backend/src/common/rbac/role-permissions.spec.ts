import { PERMISSIONS } from './permission.constants';
import { ROLES, type AppRole } from './roles';
import { resolvePermissions } from './role-permissions';

describe('resolvePermissions', () => {
  it('svaka rola iz ROLES ima definisanu mapu (nema tipfelera u enumu)', () => {
    for (const role of ROLES) {
      expect(resolvePermissions([role]).length).toBeGreaterThan(0);
    }
  });

  it('PLATFORM_COMPANIES dobija samo PLATFORM_ADMIN', () => {
    const platform = resolvePermissions(['PLATFORM_ADMIN']);
    expect(platform).toContain(PERMISSIONS.PLATFORM_COMPANIES);
    for (const role of ROLES.filter((item) => item !== 'PLATFORM_ADMIN')) {
      expect(resolvePermissions([role])).not.toContain(
        PERMISSIONS.PLATFORM_COMPANIES,
      );
    }
  });

  it('permisije se sabiraju bez duplikata (unija rola)', () => {
    const union = resolvePermissions(['WORKER', 'DRIVER']);
    expect(union).toContain(PERMISSIONS.TASKS_READ);
    expect(union).toContain(PERMISSIONS.TRIPS_WRITE);
    expect(new Set(union).size).toBe(union.length);
  });

  it('nepoznata rola ne daje nikakvu permisiju (deny-by-default)', () => {
    expect(resolvePermissions(['NEPOSTOJECA' as AppRole])).toEqual([]);
  });

  it('radnik ne dobija administrativne permisije', () => {
    const worker = resolvePermissions(['WORKER']);
    expect(worker).not.toContain(PERMISSIONS.USERS_WRITE);
    expect(worker).not.toContain(PERMISSIONS.SETTINGS_WRITE);
    expect(worker).not.toContain(PERMISSIONS.PAYROLL_WRITE);
    expect(worker).not.toContain(PERMISSIONS.ERP_WRITE);
  });
});
