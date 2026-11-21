import { canAssignRoles, canManageRoles } from './role-hierarchy';

describe('canManageRoles', () => {
  it('ADMIN ne smije dirati SUPER_ADMIN-a (eskalacija kroz reset lozinke)', () => {
    expect(canManageRoles(['ADMIN'], ['SUPER_ADMIN'])).toBe(false);
    expect(canManageRoles(['ADMIN', 'WORKER'], ['SUPER_ADMIN'])).toBe(false);
  });

  it('SUPER_ADMIN smije dirati SUPER_ADMIN-a i sve niže role', () => {
    expect(canManageRoles(['SUPER_ADMIN'], ['SUPER_ADMIN'])).toBe(true);
    expect(canManageRoles(['SUPER_ADMIN'], ['ADMIN', 'ACCOUNTANT'])).toBe(true);
  });

  it('PLATFORM_ADMIN smije dirati svakoga, ali se ne dodjeljuje', () => {
    expect(canManageRoles(['PLATFORM_ADMIN'], ['PLATFORM_ADMIN'])).toBe(true);
    expect(canAssignRoles(['PLATFORM_ADMIN'], ['PLATFORM_ADMIN'])).toBe(false);
  });

  it('niko osim platform admina ne dira nalog sa PLATFORM_ADMIN rolom', () => {
    expect(canManageRoles(['SUPER_ADMIN'], ['PLATFORM_ADMIN'])).toBe(false);
  });

  it('obične role su dozvoljene svakome sa users.write', () => {
    expect(canManageRoles(['ADMIN'], ['WORKER', 'MECHANIC'])).toBe(true);
    expect(canManageRoles(['PROJECT_MANAGER'], ['WORKER'])).toBe(true);
  });
});

describe('canAssignRoles', () => {
  it('SUPER_ADMIN dodjeljuje samo SUPER_ADMIN/PLATFORM_ADMIN', () => {
    expect(canAssignRoles(['SUPER_ADMIN'], ['SUPER_ADMIN'])).toBe(true);
    expect(canAssignRoles(['ADMIN'], ['SUPER_ADMIN'])).toBe(false);
  });

  it('ostale role smije dodijeliti ADMIN', () => {
    expect(canAssignRoles(['ADMIN'], ['WORKER', 'ADMIN'])).toBe(true);
  });
});
