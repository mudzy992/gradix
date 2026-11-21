import { DocumentAlertsService } from './dashboard-document-alerts.service';
import type { AuthUser } from '../../common/types/auth-user';

const admin = { id: 'u', tenantCompanyId: 'c', roles: ['ADMIN'] } as AuthUser;
describe('document alerts', () => {
  it('returns an ordered bounded page without file paths or notes', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        id: 'a',
        kind: 'COMPANY',
        type: 'Licence',
        expiresAt: new Date('2025-01-04T00:00:00Z'),
      },
      {
        id: 'b',
        kind: 'WORKER',
        type: 'Permit',
        expiresAt: new Date('2025-01-05T00:00:00Z'),
      },
      {
        id: 'c',
        kind: 'MACHINE',
        type: 'Cert',
        expiresAt: new Date('2025-01-08T00:00:00Z'),
      },
    ]);
    const service = new DocumentAlertsService({
      setting: { findUnique: jest.fn().mockResolvedValue({ value: 'UTC' }) },
      $queryRaw: query,
    } as never);
    const page = await service.list(
      admin,
      { limit: 2 },
      new Date('2025-01-05T12:00:00Z'),
    );
    expect(page.data).toMatchObject([
      { id: 'a', severity: 'CRITICAL', daysUntilExpiry: -1 },
      { id: 'b', severity: 'HIGH', daysUntilExpiry: 0 },
    ]);
    expect(page.meta.nextCursor).toEqual(expect.any(String));
    const calls = query.mock.calls as unknown as Array<
      [{ text: string; values: unknown[] }]
    >;
    expect(calls[0][0].text).not.toContain('filePath');
    expect(calls[0][0].text).not.toContain('note');
    expect(calls[0][0].values).toContain('c');
  });
  it('fails closed on missing tenant, non-admin and invalid cursor', async () => {
    const query = jest.fn();
    const service = new DocumentAlertsService({
      setting: { findUnique: jest.fn().mockResolvedValue({ value: 'UTC' }) },
      $queryRaw: query,
    } as never);
    await expect(
      service.list({ ...admin, roles: ['SITE_SUPERVISOR'] }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.list({ ...admin, tenantCompanyId: null }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.list(admin, { cursor: 'invalid' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
});
