import { buildDemoTrend } from '../../../prisma/seed-demo-trends';

describe('demo trend seed', () => {
  it('creates deterministic varied closed-session history inside the previous 30 complete days', () => {
    const sample = buildDemoTrend(
      { companyId: 'c', projectId: 'p', workerId: 'w', operatorId: 'o' },
      '2025-04-10',
    );
    expect(sample.tasks.length).toBeGreaterThan(20);
    expect(sample.timers.length).toBeGreaterThan(20);
    expect(
      new Set(sample.tasks.map((t) => t.createdAt.toISOString().slice(0, 10)))
        .size,
    ).toBeGreaterThan(20);
    expect(
      sample.tasks.every(
        (t) =>
          t.createdAt >= new Date('2025-03-11T00:00:00Z') &&
          t.createdAt < new Date('2025-04-10T00:00:00Z'),
      ),
    ).toBe(true);
    expect(new Set(sample.tasks.map((t) => t.id)).size).toBe(
      sample.tasks.length,
    );
    expect(
      sample.timers.every(
        (t) =>
          t.closedAt.getTime() - t.startedAt.getTime() ===
          t.durationMinutes * 60_000,
      ),
    ).toBe(true);
    for (const task of sample.tasks) {
      const total = sample.timers
        .filter((t) => t.taskId === task.id)
        .reduce((sum, t) => sum + t.durationMinutes, 0);
      expect(task.totalTimeSpentMinutes).toBe(total);
    }
    expect(sample.timers.every((t) => t.approvalStatus === 'APPROVED')).toBe(
      true,
    );
    const nextDay = buildDemoTrend(
      { companyId: 'c', projectId: 'p', workerId: 'w', operatorId: 'o' },
      '2025-04-11',
    );
    for (const old of sample.tasks) {
      const same = nextDay.tasks.find((task) => task.id === old.id);
      if (same) expect(same).toEqual(old);
    }
    for (const old of sample.timers) {
      const same = nextDay.timers.find((timer) => timer.id === old.id);
      if (same) expect(same).toEqual(old);
    }
    expect(
      buildDemoTrend(
        { companyId: 'c', projectId: 'p', workerId: 'w', operatorId: 'o' },
        '2025-04-10',
      ),
    ).toEqual(sample);
  });
});
