import type { TaskStatus } from '../../../generated/client';
import { nextTaskStatus } from './task-status';

const open = { pausedAt: null as Date | null };
const paused = { pausedAt: new Date('2026-11-02T10:00:00Z') };

function status(
  current: TaskStatus,
  openTimers: { pausedAt: Date | null }[],
  assigneeCount: number,
): TaskStatus {
  return nextTaskStatus({ status: current, openTimers, assigneeCount });
}

describe('nextTaskStatus', () => {
  it('bez dodjela i bez timera je PENDING', () => {
    expect(status('PENDING', [], 0)).toBe('PENDING');
  });

  it('dodjela bez timera je ASSIGNED', () => {
    expect(status('PENDING', [], 1)).toBe('ASSIGNED');
  });

  it('otvoren (nepauziran) timer je IN_PROGRESS, čak i uz pauzirane sesije', () => {
    expect(status('ASSIGNED', [open], 1)).toBe('IN_PROGRESS');
    expect(status('PAUSED', [open, paused], 1)).toBe('IN_PROGRESS');
  });

  it('svi timeri pauzirani je PAUSED', () => {
    expect(status('IN_PROGRESS', [paused, paused], 1)).toBe('PAUSED');
  });

  it('terminalni statusi se ne mijenjaju ni uz otvoren timer', () => {
    expect(status('COMPLETED', [open], 1)).toBe('COMPLETED');
    expect(status('CANCELLED', [], 0)).toBe('CANCELLED');
  });

  it('uklonjena dodjela vraća zadatak u PENDING', () => {
    expect(status('ASSIGNED', [], 0)).toBe('PENDING');
  });
});
