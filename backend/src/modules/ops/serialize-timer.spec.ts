import type { TimerSession } from '../../../generated/client';
import {
  serializeCrewTimer,
  serializeTimer,
  serializeTimerSelf,
} from './serialize-timer';

function row(over: Partial<TimerSession> = {}): TimerSession {
  return {
    id: 't1',
    companyId: 'c1',
    userId: 'u1',
    taskId: 'task1',
    startedAt: new Date('2026-11-03T08:00:00Z'),
    closedAt: null,
    pausedAt: null,
    pauseAccumMinutes: 0,
    durationMinutes: null,
    lat: null,
    lng: null,
    machineId: null,
    localId: 'local-1',
    deviceId: 'device-1',
    isSynced: true,
    approvalStatus: 'PENDING',
    createdAt: new Date('2026-11-03T08:00:00Z'),
    updatedAt: new Date('2026-11-03T08:00:00Z'),
    ...over,
  };
}

describe('serializeTimerSelf', () => {
  it('ne izlaže companyId, deviceId, localId ni isSynced', () => {
    const out = serializeTimerSelf(row()) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty('companyId');
    expect(out).not.toHaveProperty('deviceId');
    expect(out).not.toHaveProperty('localId');
    expect(out).not.toHaveProperty('isSynced');
  });

  it('zadržava polja koja web i mobilna aplikacija koriste', () => {
    const out = serializeTimerSelf(row());
    expect(out.id).toBe('t1');
    expect(out.taskId).toBe('task1');
    expect(out.startedAt).toEqual(new Date('2026-11-03T08:00:00Z'));
    expect(out.pausedAt).toBeNull();
  });

  it('Decimal lat/lng pretvara u string', () => {
    const out = serializeTimerSelf(
      row({ lat: { toString: () => '44.15' } as never }),
    );
    expect(out.lat).toBe('44.15');
    expect(out.lng).toBeNull();
  });
});

describe('serializeCrewTimer', () => {
  const now = new Date('2026-11-03T10:30:00Z');

  it('računa elapsedMinutes za sesiju koja radi', () => {
    const out = serializeCrewTimer(row(), now);
    expect(out.elapsedMinutes).toBe(150);
  });

  it('pauzirana sesija ne raste i oduzima akumulirane pauze', () => {
    const out = serializeCrewTimer(
      row({
        pausedAt: new Date('2026-11-03T09:00:00Z'),
        pauseAccumMinutes: 15,
      }),
      now,
    );
    expect(out.elapsedMinutes).toBe(45);
  });

  it('ne izlaže identifikatore uređaja ni firmu', () => {
    const out = serializeCrewTimer(row(), now) as unknown as Record<
      string,
      unknown
    >;
    expect(out).not.toHaveProperty('deviceId');
    expect(out).not.toHaveProperty('localId');
    expect(out).not.toHaveProperty('companyId');
    expect(out.userId).toBe('u1');
  });
});

describe('serializeTimer (sync ugovor)', () => {
  it('zadržava deviceId/localId za sync pull', () => {
    const out = serializeTimer(row());
    expect(out.deviceId).toBe('device-1');
    expect(out.localId).toBe('local-1');
  });
});
