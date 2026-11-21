import { TaskAlertsService } from './dashboard-task-alerts.service';
import type { AuthUser } from '../../common/types/auth-user';
const admin = { id: 'u', tenantCompanyId: 'c', roles: ['ADMIN'] } as AuthUser;
describe('task deadline alerts', () => {
  it('pages tenant-scoped unfinished tasks and assigns severity without formatting', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'a',
        projectId: 'p',
        title: 'Late',
        status: 'PENDING',
        plannedEnd: new Date('2025-01-04T12:00:00Z'),
      },
      {
        id: 'b',
        projectId: 'p',
        title: 'Soon',
        status: 'ASSIGNED',
        plannedEnd: new Date('2025-01-07T12:00:00Z'),
      },
      {
        id: 'c',
        projectId: 'p',
        title: 'Later',
        status: 'PAUSED',
        plannedEnd: new Date('2025-01-12T12:00:00Z'),
      },
    ]);
    const findFirst = jest.fn().mockResolvedValue({ id: 'anchor' });
    const service = new TaskAlertsService({
      task: { findMany, findFirst },
    } as never);
    const page = await service.list(
      admin,
      { limit: 2, cursor: 'anchor' },
      new Date('2025-01-05T12:00:00Z'),
    );
    expect(page.data).toMatchObject([
      { id: 'a', severity: 'CRITICAL', plannedEnd: '2025-01-04T12:00:00.000Z' },
      { id: 'b', severity: 'HIGH' },
    ]);
    expect(page.meta).toEqual({ limit: 2, nextCursor: 'b' });
    const calls = findMany.mock.calls as unknown as Array<
      [{ where: { companyId: string }; take: number }]
    >;
    expect(calls[0][0]).toMatchObject({ where: { companyId: 'c' }, take: 3 });
  });
  it('rejects a foreign cursor and unauthorized roles before listing', async () => {
    const findMany = jest.fn();
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new TaskAlertsService({
      task: { findMany, findFirst },
    } as never);
    await expect(
      service.list({ ...admin, roles: ['SITE_SUPERVISOR'] }, {}),
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
