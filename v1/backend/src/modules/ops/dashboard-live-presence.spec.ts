import { LivePresenceService } from './dashboard-live-presence.service';
import type { AuthUser } from '../../common/types/auth-user';
const admin = {
  id: 'admin',
  tenantCompanyId: 'c',
  roles: ['ADMIN'],
} as AuthUser;
describe('live presence', () => {
  it('is scoped and returns only bounded people without coordinates', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        userId: 'u1',
        firstName: 'A',
        lastName: 'B',
        projectId: 'p',
        lastSeenAt: new Date('2025-01-01T12:00:00Z'),
      },
      {
        userId: 'u2',
        firstName: 'C',
        lastName: 'D',
        projectId: 'p',
        lastSeenAt: new Date('2025-01-01T12:01:00Z'),
      },
    ]);
    const service = new LivePresenceService({ $queryRaw: query } as never);
    const page = await service.list(
      admin,
      { limit: 1 },
      new Date('2025-01-01T12:05:00Z'),
    );
    expect(page.data).toEqual([
      {
        userId: 'u1',
        firstName: 'A',
        lastName: 'B',
        projectId: 'p',
        lastSeenAt: '2025-01-01T12:00:00.000Z',
      },
    ]);
    expect(page.meta).toEqual({ limit: 1, nextCursor: 'u1' });
    const calls = query.mock.calls as unknown as Array<
      [{ text: string; values: unknown[] }]
    >;
    expect(calls[0][0].values).toContain('c');
    expect(calls[0][0].text).toContain('"companyId"');
  });
  it('fails closed for non-admin and missing tenant', async () => {
    const query = jest.fn();
    const service = new LivePresenceService({ $queryRaw: query } as never);
    await expect(
      service.list({ ...admin, roles: ['SITE_SUPERVISOR'] }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.list({ ...admin, tenantCompanyId: null }, {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });
});
