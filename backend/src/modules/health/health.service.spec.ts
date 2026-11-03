jest.mock(
  '../../../generated/client',
  () => ({ Prisma: {}, PrismaClient: class {} }),
  { virtual: true },
);

import { HealthService } from './health.service';
import type { PrismaService } from '../prisma/prisma.service';

function serviceWith(queryRaw: jest.Mock): HealthService {
  return new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('HealthService (BE-18)', () => {
  it('liveness ne dira bazu', () => {
    const queryRaw = jest.fn();
    const service = serviceWith(queryRaw);
    const body = service.getLiveness();
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('readiness: baza dostupna → ok + latencyMs', async () => {
    const service = serviceWith(
      jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    );
    const result = await service.getReadiness();
    expect(result.status).toBe('ok');
    expect(result.checks.postgres.status).toBe('ok');
    expect(result.checks.postgres.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checks.postgres.error).toBeUndefined();
  });

  it('readiness: baza nedostupna → error bez detalja greške', async () => {
    const service = serviceWith(
      jest
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    );
    const result = await service.getReadiness();
    expect(result.status).toBe('error');
    expect(result.checks.postgres.error).toBe('unreachable');
    // Detalj (host/port) ne smije iscuriti u odgovor.
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });

  it('readiness: zaglavljena baza ne visi — timeout daje error', async () => {
    jest.useFakeTimers();
    const never = new Promise(() => undefined);
    const service = serviceWith(jest.fn().mockReturnValue(never));
    const pending = service.getReadiness();
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.checks.postgres.error).toBe('unreachable');
    jest.useRealTimers();
  });
});
