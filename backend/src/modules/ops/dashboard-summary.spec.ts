import { DashboardSummaryService } from './dashboard-summary.service';
import { decimal } from '../../../test/helpers/decimal';
import type { AuthUser } from '../../common/types/auth-user';
const admin = { id: 'a', tenantCompanyId: 'c', roles: ['ADMIN'] } as AuthUser;
describe('analytics summary', () => {
  it('returns exact budgets and spend without screen formatting', async () => {
    const aggregate = jest.fn().mockResolvedValue({
      _count: { _all: 2, plannedBudget: 1 },
      _sum: {
        plannedBudget: decimal('100.10'),
        currentSpend: decimal('99.99'),
      },
    });
    const tasks = jest.fn().mockResolvedValue(3);
    const timers = jest.fn().mockResolvedValue(4);
    const service = new DashboardSummaryService({
      project: { aggregate },
      task: { count: tasks },
      timerSession: { count: timers },
    } as never);
    expect(await service.get(admin)).toEqual({
      activeProjects: 2,
      openTasks: 3,
      openTimers: 4,
      projectsWithBudget: 1,
      knownPlannedBudget: '100.10',
      currentSpend: '99.99',
    });
    const calls = aggregate.mock.calls as unknown as Array<
      [{ where: { companyId: string } }]
    >;
    expect(calls[0][0].where.companyId).toBe('c');
  });
  it('preserves an absent budget and fails closed for non-admin and missing tenant', async () => {
    const aggregate = jest.fn().mockResolvedValue({
      _count: { _all: 0, plannedBudget: 0 },
      _sum: { plannedBudget: null, currentSpend: null },
    });
    const service = new DashboardSummaryService({
      project: { aggregate },
      task: { count: jest.fn().mockResolvedValue(0) },
      timerSession: { count: jest.fn().mockResolvedValue(0) },
    } as never);
    await expect(
      service.get({ ...admin, roles: ['ACCOUNTANT'] }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.get({ ...admin, tenantCompanyId: null }),
    ).rejects.toMatchObject({ status: 403 });
    expect(aggregate).not.toHaveBeenCalled();
    expect(await service.get(admin)).toMatchObject({
      activeProjects: 0,
      projectsWithBudget: 0,
      knownPlannedBudget: null,
      currentSpend: '0.00',
    });
  });
});
