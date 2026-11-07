import { ActivityService } from './activity.service';
import type { AuthUser } from '../../common/types/auth-user';

const admin = {
  id: 'u',
  tenantCompanyId: 'c',
  roles: ['ADMIN'],
  permissions: ['users.read'],
} as AuthUser;
const rows = ['1', '2', '3'].map((id) => ({
  id,
  action: 'PROJECT_CREATED',
  entityType: 'Project',
  entityId: id,
  actorId: 'u',
  createdAt: new Date('2025-01-01T12:00:00Z'),
}));
describe('activity feed', () => {
  it('selects only non-payload fields and returns bounded, ordered cursor pages', async () => {
    const findMany = jest.fn().mockResolvedValue(rows);
    const findFirst = jest.fn().mockResolvedValue({ id: 'anchor' });
    const service = new ActivityService({
      auditEvent: { findMany, findFirst },
    } as never);
    const page = await service.list(admin, { limit: 2, cursor: 'anchor' });
    expect(page).toMatchObject({
      data: [{ id: '1', createdAt: '2025-01-01T12:00:00.000Z' }, { id: '2' }],
      meta: { limit: 2, nextCursor: '2' },
    });
    const calls = findMany.mock.calls as unknown as Array<
      [
        {
          where: unknown;
          select: Record<string, boolean>;
          take: number;
          cursor: unknown;
          skip: number;
        },
      ]
    >;
    expect(calls[0][0]).toMatchObject({
      where: { companyId: 'c' },
      take: 3,
      cursor: { id: 'anchor' },
      skip: 1,
    });
    expect(calls[0][0].select).not.toHaveProperty('payload');
  });
  it('rejects non-admin, missing tenant and non-visible cursor', async () => {
    const findMany = jest.fn();
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new ActivityService({
      auditEvent: { findMany, findFirst },
    } as never);
    await expect(
      service.list({ ...admin, roles: ['ACCOUNTANT'] }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.list({ ...admin, tenantCompanyId: null }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.list(admin, { cursor: 'foreign' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(findMany).not.toHaveBeenCalled();
  });
});
