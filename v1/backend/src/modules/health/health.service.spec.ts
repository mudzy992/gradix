jest.mock(
  '../../../generated/client',
  () => ({ Prisma: {}, PrismaClient: class {} }),
  { virtual: true },
);

import { HealthService } from './health.service';
import { expectedMigrationCount } from './migration-count';
import type { PrismaService } from '../prisma/prisma.service';
import type { MinioService } from '../files/minio.service';
import type { RedisService } from '../../common/redis/redis.service';

interface Stubs {
  queryRaw?: jest.Mock;
  storage?: jest.Mock;
  redisPing?: jest.Mock;
}

function serviceWith(stubs: Stubs = {}): HealthService {
  const queryRaw =
    stubs.queryRaw ?? jest.fn().mockResolvedValue([{ '?column?': 1 }]);
  const minio = {
    healthCheck: stubs.storage ?? jest.fn().mockResolvedValue(true),
  } as unknown as MinioService;
  const redis = {
    ping:
      stubs.redisPing ??
      jest.fn().mockResolvedValue({ status: 'disabled', latencyMs: 0 }),
  } as unknown as RedisService;
  return new HealthService(
    { $queryRaw: queryRaw } as unknown as PrismaService,
    minio,
    redis,
  );
}

/** Prisma vraća `count` kao BigInt — servis ga pretvara u broj. */
function migrationRows(count: number): jest.Mock {
  return jest.fn().mockResolvedValue([{ count: BigInt(count) }]);
}

describe('HealthService (BE-18 + INF-05)', () => {
  const expected = expectedMigrationCount();
  const originalSkip = process.env.MINIO_SKIP;

  // CI pokreće unit testove sa `MINIO_SKIP=true`; provjere ispod tvrde ponašanje **sa** MinIO-om,
  // pa je okruženje eksplicitno zadato (test ne smije zavisiti od env-a iz CI-ja).
  beforeEach(() => {
    process.env.MINIO_SKIP = 'false';
  });
  afterAll(() => {
    if (originalSkip === undefined) {
      delete process.env.MINIO_SKIP;
    } else {
      process.env.MINIO_SKIP = originalSkip;
    }
  });

  it('liveness ne dira bazu', () => {
    const queryRaw = jest.fn();
    const service = serviceWith({ queryRaw });
    const body = service.getLiveness();
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('readiness: sve dostupno i migracije primijenjene → ok', async () => {
    const applied = expected ?? 0;
    const service = serviceWith({ queryRaw: migrationRows(applied) });
    const result = await service.getReadiness();
    expect(result.status).toBe('ok');
    expect(result.checks.postgres.status).toBe('ok');
    expect(result.checks.storage.status).toBe('ok');
    expect(result.checks.migrations.applied).toBe(applied);
    expect(result.checks.migrations.expected).toBe(expected);
  });

  it('readiness: Postgres nedostupan → error bez detalja, migracije `unknown`', async () => {
    const service = serviceWith({
      queryRaw: jest
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    });
    const result = await service.getReadiness();
    expect(result.status).toBe('error');
    expect(result.checks.postgres.error).toBe('unreachable');
    expect(result.checks.migrations.status).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });

  it('readiness: MinIO nedostupan → error u `storage`, ostalo ok', async () => {
    const service = serviceWith({
      queryRaw: migrationRows(expected ?? 0),
      storage: jest.fn().mockRejectedValue(new Error('MinIO down')),
    });
    const result = await service.getReadiness();
    expect(result.status).toBe('error');
    expect(result.checks.storage.error).toBe('unreachable');
    expect(result.checks.postgres.status).toBe('ok');
  });

  it('readiness: manje primijenjenih migracija → `pending` i 503 semantika', async () => {
    const service = serviceWith({ queryRaw: migrationRows(1) });
    const result = await service.getReadiness();
    if (expected === null) {
      expect(result.checks.migrations.status).toBe('unknown');
      return;
    }
    expect(result.checks.migrations.status).toBe('pending');
    expect(result.status).toBe('error');
  });

  it('readiness: zaglavljena baza ne visi — timeout daje error', async () => {
    jest.useFakeTimers();
    const never = new Promise(() => undefined);
    const service = serviceWith({ queryRaw: jest.fn().mockReturnValue(never) });
    const pending = service.getReadiness();
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.checks.postgres.error).toBe('unreachable');
    jest.useRealTimers();
  });

  it('readiness: Redis nije konfigurisan → `disabled`, ne utiče na status', async () => {
    const service = serviceWith({ queryRaw: migrationRows(expected ?? 0) });
    const result = await service.getReadiness();
    expect(result.checks.redis.status).toBe('disabled');
    expect(result.status).toBe('ok');
  });

  it('readiness: Redis konfigurisan ali nedostupan → `error` u detaljima, ali 200', async () => {
    const service = serviceWith({
      queryRaw: migrationRows(expected ?? 0),
      redisPing: jest.fn().mockResolvedValue({ status: 'error', latencyMs: 2 }),
    });
    const result = await service.getReadiness();
    expect(result.checks.redis.status).toBe('error');
    // INF-07: Redis je opciona zavisnost — aplikacija radi bez njega (throttle fail-open).
    expect(result.status).toBe('ok');
  });

  it('readiness: `MINIO_SKIP=true` označava storage kao preskočen, ne kao grešku', async () => {
    process.env.MINIO_SKIP = 'true';
    const service = serviceWith({ queryRaw: migrationRows(expected ?? 0) });
    const result = await service.getReadiness();
    expect(result.checks.storage).toMatchObject({
      status: 'ok',
      detail: 'skipped',
    });
  });
});
