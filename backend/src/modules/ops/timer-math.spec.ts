import { applyPauseAccum, computeDurationMinutes, computeElapsedMinutes } from './timer-math';

describe('timer-math', () => {
  it('pause-then-stop excludes paused minutes', () => {
    const startedAt = new Date('2026-08-16T08:00:00Z');
    const pausedAt = new Date('2026-08-16T09:00:00Z');
    const closedAt = new Date('2026-08-16T09:10:00Z');
    const paused = applyPauseAccum(
      { startedAt, closedAt: null, pausedAt, pauseAccumMinutes: 0 },
      closedAt,
    );
    expect(paused.pauseAccumMinutes).toBe(10);
    expect(computeDurationMinutes(startedAt, closedAt, paused.pauseAccumMinutes)).toBe(60);
  });

  it('elapsed while paused stops at pausedAt', () => {
    const session = {
      startedAt: new Date('2026-08-16T08:00:00Z'),
      closedAt: null,
      pausedAt: new Date('2026-08-16T08:20:00Z'),
      pauseAccumMinutes: 0,
    };
    const elapsed = computeElapsedMinutes(session, new Date('2026-08-16T09:00:00Z'));
    expect(elapsed).toBe(20);
  });
});
