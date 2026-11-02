import type { AuthUser } from '../types/auth-user';
import { requireTenantCompany } from './tenant';

const actor = (tenantCompanyId: string | null) =>
  ({ id: 'u1', roles: ['ADMIN'], tenantCompanyId }) as unknown as AuthUser;

describe('requireTenantCompany', () => {
  it('vraća tenant iz zahtjeva', () => {
    expect(requireTenantCompany(actor('c1'))).toBe('c1');
  });

  it('bez tenanta baca 403 TENANT_HEADER_REQUIRED (ne 500)', () => {
    expect(() => requireTenantCompany(actor(null))).toThrow(/X-Company-Id/);
    try {
      requireTenantCompany(actor(null));
    } catch (error) {
      expect((error as { status?: number }).status).toBe(403);
      expect((error as { code?: string }).code).toBe('TENANT_HEADER_REQUIRED');
    }
  });
});
