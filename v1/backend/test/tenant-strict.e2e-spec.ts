import {
  tenantModelsFromSchema,
  applyTenantStrict,
  hasCompanyConstraint,
} from './helpers/tenant-strict';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { createTestApp } from './helpers/create-app';

describe('TEST-01 strict tenant query detector', () => {
  it('discovers models from all Prisma schema files', () => {
    const models = tenantModelsFromSchema();
    expect(models.has('User')).toBe(true);
    expect(models.has('Project')).toBe(true);
    expect(models.has('Company')).toBe(false);
    expect(models.size).toBeGreaterThan(10);
  });
  it('requires an unconditional concrete companyId, not a partial OR, null or undefined', () => {
    expect(hasCompanyConstraint({ companyId: 'company-a' })).toBe(true);
    expect(
      hasCompanyConstraint({
        AND: [{ companyId: { equals: 'company-a' } }, { id: 'id' }],
      }),
    ).toBe(true);
    expect(
      hasCompanyConstraint({ OR: [{ companyId: 'company-a' }, { id: 'id' }] }),
    ).toBe(false);
    expect(hasCompanyConstraint({ companyId: undefined })).toBe(false);
    expect(hasCompanyConstraint({ companyId: null })).toBe(false);
  });
  it('injects strict Prisma into the E2E application only when enabled', async () => {
    const previous = process.env.TENANT_STRICT;
    try {
      process.env.TENANT_STRICT = '1';
      const strictApp = await createTestApp();
      try {
        await expect(
          strictApp
            .get(PrismaService)
            .user.findMany({ where: { id: 'unknown' } }),
        ).rejects.toThrow(/TENANT_STRICT.*User\.findMany/);
      } finally {
        await strictApp.close();
      }
      process.env.TENANT_STRICT = '0';
      const normalApp = await createTestApp();
      try {
        await expect(
          normalApp
            .get(PrismaService)
            .user.findMany({ where: { id: 'unknown' } }),
        ).resolves.toEqual([]);
      } finally {
        await normalApp.close();
      }
    } finally {
      if (previous === undefined) delete process.env.TENANT_STRICT;
      else process.env.TENANT_STRICT = previous;
    }
  });
  it('rejects unscoped queries including interactive transactions while allowing scoped ones', async () => {
    const base = new PrismaService();
    const db = applyTenantStrict(base, tenantModelsFromSchema());
    try {
      await expect(
        db.user.findMany({ where: { id: 'unknown' } }),
      ).rejects.toThrow(/TENANT_STRICT.*User\.findMany/);
      await expect(
        db.user.findMany({ where: { companyId: 'unknown' } }),
      ).resolves.toEqual([]);
      await expect(
        db.$transaction(async (tx) =>
          tx.user.findMany({ where: { id: 'unknown' } }),
        ),
      ).rejects.toThrow(/TENANT_STRICT.*User\.findMany/);
      await expect(
        db.user.create({
          data: { email: 'strict-test@example.invalid' },
        } as never),
      ).rejects.toThrow(/TENANT_STRICT.*User\.create/);
      await expect(
        db.user.upsert({
          where: { id: 'x' },
          create: { email: 'strict-test@example.invalid', companyId: 'x' },
          update: {},
        } as never),
      ).rejects.toThrow(/TENANT_STRICT.*User\.upsert/);
    } finally {
      await db.$disconnect();
    }
  });
});
