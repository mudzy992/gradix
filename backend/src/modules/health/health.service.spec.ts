jest.mock(
  '../../../generated/client',
  () => ({ Prisma: {}, PrismaClient: class {} }),
  { virtual: true },
);

import { HealthService } from './health.service';
import { expectedMigrationCount } from './migration-count';
import type { PrismaService } from '../prisma/prisma.service';
import type { MinioService } from '../files/minio.service';

interface Stubs {
  queryRaw?: jest.Mock;
  storage?: jest.Mock;
}

function serviceWith(stubs: Stubs = {}): HealthService {
  const queryRaw =
    stubs.queryRaw ?? jest.fn().mockResolvedValue([{ '?column?': 1 }]);
  const minio = {
    healthCheck: stubs.storage ?? jest.fn().mockResolvedValue(true),
  } as unknown as MinioService;
  return new HealthService(
    { $queryRaw: queryRaw } as unknown as PrismaService,
    minio,
  );
}

/** Prisma vraća `count` kao BigInt — servis ga pretvara u broj. */
function migrationRows(count: number): jest.Mock {
  return jest.fn().mockResolvedValue([{ count: BigInt(count) }]);
}

describe('HealthService (BE-18 + INF-05)', () => {
  const expected = expectedMigrationCount();

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

  it('readiness: `MINIO_SKIP=true` označava storage kao preskočen, ne kao grešku', async () => {
    const previous = process.env.MINIO_SKIP;
    process.env.MINIO_SKIP = 'true';
    try {
      const service = serviceWith({ queryRaw: migrationRows(expected ?? 0) });
      const result = await service.getReadiness();
      expect(result.checks.storage).toMatchObject({
        status: 'ok',
        detail: 'skipped',
      });
    } finally {
      process.env.MINIO_SKIP = previous;
    }
  });
});
