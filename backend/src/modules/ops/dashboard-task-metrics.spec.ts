import { TaskCreationMetricsService } from './dashboard-task-metrics.service';
import type { AuthUser } from '../../common/types/auth-user';

const manager = {
  id: 'manager-1',
  companyId: 'company-1',
  tenantCompanyId: 'company-1',
  roles: ['PROJECT_MANAGER'],
  permissions: ['projects.read', 'tasks.read'],
} as AuthUser;
const rows = Array.from({ length: 6 }, (_, i) => ({
  day: `2025-01-0${i + 2}`,
  startAt: new Date(`2025-01-0${i + 2}T00:00:00.000Z`),
  endAt: new Date(`2025-01-0${i + 3}T00:00:00.000Z`),
  count: [0, 1, 1, 2, 0, 4][i],
}));
describe('task creation metrics', () => {
  it('returns bounded, comparable periods, exact UTC bucket boundaries and an exclusive cursor', async () => {
    const prisma = {
      setting: { findUnique: jest.fn().mockResolvedValue({ value: 'UTC' }) },
      $queryRaw: jest.fn().mockResolvedValue(rows),
    };
    const result = await new TaskCreationMetricsService(prisma as never).get(
      manager,
      { limit: 3, cursor: '2025-01-08' },
    );
    expect(result).toMatchObject({
      timezone: 'UTC',
      limit: 3,
      nextCursor: '2025-01-05',
      current: 6,
      previous: 2,
      delta: 4,
      deltaPercent: 200,
    });
    expect(result.series).toEqual([
      {
        startAt: '2025-01-05T00:00:00.000Z',
        endAt: '2025-01-06T00:00:00.000Z',
        count: 2,
      },
      {
        startAt: '2025-01-06T00:00:00.000Z',
        endAt: '2025-01-07T00:00:00.000Z',
        count: 0,
      },
      {
        startAt: '2025-01-07T00:00:00.000Z',
        endAt: '2025-01-08T00:00:00.000Z',
        count: 4,
      },
    ]);
    const calls = prisma.$queryRaw.mock.calls as unknown as Array<
      [{ text: string; values: unknown[] }]
    >;
    const query = calls[0][0];
    expect(query.text).toContain('"companyId"');
    expect(query.text).toContain('"ProjectAssignment"');
    expect(query.values).toContain('company-1');
    expect(query.values).toContain('manager-1');
  });
  it('does not invent a percentage when the previous total is zero', async () => {
    const prisma = {
      setting: { findUnique: jest.fn().mockResolvedValue({ value: 'UTC' }) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue(
          rows.map((row, i) => ({ ...row, count: i < 3 ? 0 : row.count })),
        ),
    };
    const result = await new TaskCreationMetricsService(prisma as never).get(
      manager,
      { limit: 3, cursor: '2025-01-08' },
    );
    expect(result.previous).toBe(0);
    expect(result.deltaPercent).toBeNull();
  });
  it('does not let ACCOUNTANT combined with a project role widen task scope', async () => {
    const prisma = {
      setting: { findUnique: jest.fn().mockResolvedValue({ value: 'UTC' }) },
      $queryRaw: jest.fn().mockResolvedValue(rows),
    };
    await new TaskCreationMetricsService(prisma as never).get(
      { ...manager, roles: ['ACCOUNTANT', 'PROJECT_MANAGER'] },
      { limit: 3, cursor: '2025-01-08' },
    );
    const calls = prisma.$queryRaw.mock.calls as unknown as Array<
      [{ text: string; values: unknown[] }]
    >;
    const query = calls[0][0];
    expect(query.text).toContain('"ProjectAssignment"');
    expect(query.values).toContain('manager-1');
  });
  it('fails closed without a tenant before querying', async () => {
    const prisma = { setting: { findUnique: jest.fn() }, $queryRaw: jest.fn() };
    await expect(
      new TaskCreationMetricsService(prisma as never).get(
        { ...manager, tenantCompanyId: null },
        {},
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.setting.findUnique).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('does not return an unusable next cursor at the earliest supported date', async () => {
    const prisma = {
      setting: { findUnique: jest.fn().mockResolvedValue({ value: 'UTC' }) },
      $queryRaw: jest.fn().mockResolvedValue(rows),
    };
    const result = await new TaskCreationMetricsService(prisma as never).get(
      manager,
      { limit: 3, cursor: '1900-01-01' },
    );
    expect(result.nextCursor).toBeNull();
  });
});
