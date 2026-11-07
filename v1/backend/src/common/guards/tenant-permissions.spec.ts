jest.mock('../../modules/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../modules/prisma/prisma.service';
import type { AuthUser } from '../types/auth-user';
import { TenantGuard } from './tenant.guard';
import { PermissionsGuard } from './permissions.guard';
import { ERROR_CODES } from '../errors/error-codes';
import { TENANT_ROUTE_KEY } from '../decorators/tenant-route.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

function actor(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'user@example.test',
    firstName: 'A',
    lastName: 'B',
    employeeCode: null,
    companyId: 'company-1',
    company: null,
    hourlyRate: null,
    isActive: true,
    mustChangePassword: false,
    locale: 'bs',
    roles: ['WORKER'],
    permissions: [],
    tenantCompanyId: null,
    ...overrides,
  };
}

function context(
  user?: AuthUser,
  headers: Record<string, string | string[]> = {},
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  } as unknown as ExecutionContext;
}
function handler() {}
function controller() {}

function setupTenant(
  isTenant: boolean,
  company: { id: string; name: string; slug: string } | null = null,
) {
  const getAllAndOverride = jest.fn().mockReturnValue(isTenant);
  const findUnique = jest.fn().mockResolvedValue(company);
  const guard = new TenantGuard(
    { getAllAndOverride } as unknown as Reflector,
    { company: { findUnique } } as unknown as PrismaService,
  );
  return { guard, getAllAndOverride, findUnique };
}

describe('TenantGuard', () => {
  it('allows unauthenticated requests through for the authentication guard to handle', async () => {
    const { guard, findUnique } = setupTenant(true);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects tenant spoofing by a non-platform user, including on non-tenant routes', async () => {
    for (const isTenant of [true, false]) {
      const { guard, findUnique } = setupTenant(isTenant);
      const user = actor();
      await expect(
        guard.canActivate(context(user, { 'x-company-id': 'other' })),
      ).rejects.toMatchObject({
        code: ERROR_CODES.TENANT_HEADER_FORBIDDEN,
        status: 400,
      });
      expect(user.tenantCompanyId).toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
    }
  });

  it('scopes tenant users to their own company and rejects missing company on tenant routes', async () => {
    const { guard, getAllAndOverride } = setupTenant(true);
    const user = actor();
    await expect(guard.canActivate(context(user))).resolves.toBe(true);
    expect(user.tenantCompanyId).toBe('company-1');
    expect(getAllAndOverride).toHaveBeenCalledWith(TENANT_ROUTE_KEY, [
      handler,
      controller,
    ]);
    await expect(
      guard.canActivate(context(actor({ companyId: null }))),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      status: 403,
    });
  });

  it('uses the first header value and does not assign an unknown company', async () => {
    const company = { id: 'company-2', name: 'Company 2', slug: 'second' };
    const { guard, findUnique } = setupTenant(true, company);
    const user = actor({ roles: ['PLATFORM_ADMIN'] });
    await expect(
      guard.canActivate(
        context(user, { 'x-company-id': ['company-2', 'other'] }),
      ),
    ).resolves.toBe(true);
    expect(user.tenantCompanyId).toBe('company-2');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('uses the account company on non-tenant routes without a header', async () => {
    const { guard, findUnique } = setupTenant(false);
    const user = actor();
    await expect(guard.canActivate(context(user))).resolves.toBe(true);
    expect(user.tenantCompanyId).toBe('company-1');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('requires a company header on a platform tenant route', async () => {
    const { guard, findUnique } = setupTenant(true);
    await expect(
      guard.canActivate(context(actor({ roles: ['PLATFORM_ADMIN'] }))),
    ).rejects.toMatchObject({
      code: ERROR_CODES.TENANT_HEADER_REQUIRED,
      status: 403,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('loads the requested company for platform users on both kinds of routes', async () => {
    const company = { id: 'company-2', name: 'Company 2', slug: 'second' };
    for (const isTenant of [true, false]) {
      const { guard, findUnique } = setupTenant(isTenant, company);
      const user = actor({ roles: ['PLATFORM_ADMIN'] });
      await expect(
        guard.canActivate(context(user, { 'x-company-id': 'company-2' })),
      ).resolves.toBe(true);
      expect(user.tenantCompanyId).toBe('company-2');
      expect(user.company).toEqual(company);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'company-2' },
        select: { id: true, name: true, slug: true },
      });
    }
  });

  it('rejects a platform user selecting a company that does not exist', async () => {
    const { guard } = setupTenant(true);
    const user = actor({ roles: ['PLATFORM_ADMIN'] });
    await expect(
      guard.canActivate(context(user, { 'x-company-id': 'missing' })),
    ).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
    expect(user.tenantCompanyId).toBeNull();
  });
});

describe('PermissionsGuard', () => {
  it('allows requests with no required permissions', () => {
    const guard = new PermissionsGuard({
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector);
    expect(guard.canActivate(context())).toBe(true);
  });

  it('requires an authenticated user and every declared permission', () => {
    const getAllAndOverride = jest
      .fn()
      .mockReturnValue(['projects.read', 'projects.write']);
    const guard = new PermissionsGuard({
      getAllAndOverride,
    } as unknown as Reflector);
    for (const request of [
      context(),
      context(actor({ permissions: ['projects.read'] })),
    ]) {
      try {
        guard.canActivate(request);
        throw new Error('Expected the guard to reject the request');
      } catch (error) {
        expect(error).toMatchObject({
          code: ERROR_CODES.FORBIDDEN,
          status: 403,
        });
      }
    }
    expect(
      guard.canActivate(
        context(actor({ permissions: ['projects.read', 'projects.write'] })),
      ),
    ).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(PERMISSIONS_KEY, [
      handler,
      controller,
    ]);
  });
});
