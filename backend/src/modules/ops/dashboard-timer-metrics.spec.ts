import { TimerMetricsService } from './dashboard-timer-metrics.service';
import type { AuthUser } from '../../common/types/auth-user';

const admin = {
  id: 'admin',
  tenantCompanyId: 'c',
  roles: ['ADMIN'],
} as AuthUser;
const rows = [0, 1, 2, 3].map((n) => ({
  startAt: new Date(Date.UTC(2025, 0, n + 1)),
  endAt: new Date(Date.UTC(2025, 0, n + 2)),
  minutes: BigInt([120, 60, 0, 240][n]),
  workers: BigInt([1, 1, 0, 2][n]),
}));
describe('closed timer metrics', () => {
  it('compares exact approved minutes and reports daily distinct workers', async () => {
    const query = jest.fn().mockResolvedValue(rows);
    const service = new TimerMetricsService({
      setting: { findUnique: jest.fn().mockResolvedValue({ value: 'UTC' }) },
      $queryRaw: query,
    } as never);
    const result = await service.get(admin, { limit: 2, cursor: '2025-01-05' });
    expect(result).toMatchObject({
      currentMinutes: '240',
      previousMinutes: '180',
      deltaMinutes: '60',
      deltaPercent: '33.33',
      nextCursor: '2025-01-03',
      series: [
        { minutes: '0', workers: 0 },
        { minutes: '240', workers: 2 },
      ],
    });
    const calls = query.mock.calls as unknown as Array<
      [{ text: string; values: unknown[] }]
    >;
    expect(calls[0][0].text).toContain('"companyId"');
    expect(calls[0][0].text).toContain('"approvalStatus"');
    expect(calls[0][0].values).toContain('c');
  });
  it('rejects unauthorized and missing tenant before querying and leaves delta undefined for zero baseline', async () => {
    const query = jest
      .fn()
      .mockResolvedValue(rows.map((r) => ({ ...r, minutes: 0n })));
    const service = new TimerMetricsService({
      setting: { findUnique: jest.fn().mockResolvedValue({ value: 'UTC' }) },
      $queryRaw: query,
    } as never);
    await expect(
      service.get({ ...admin, roles: ['PROJECT_MANAGER'] }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.get({ ...admin, tenantCompanyId: null }, {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
    expect(
      (await service.get(admin, { limit: 2, cursor: '2025-01-05' }))
        .deltaPercent,
    ).toBeNull();
  });
});
