import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../files/minio.service';
import { RedisService } from '../../common/redis/redis.service';
import { HEALTH_PROBE_TIMEOUT_MS } from '../../common/constants';
import { expectedMigrationCount } from './migration-count';

export type HealthStatus = 'ok' | 'error' | 'pending' | 'unknown' | 'disabled';

export interface CheckResult {
  status: HealthStatus;
  latencyMs: number;
  detail?: string;
  error?: string;
  applied?: number;
  expected?: number | null;
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  uptimeSeconds: number;
  checks: {
    postgres: CheckResult;
    storage: CheckResult;
    migrations: CheckResult;
    redis: CheckResult;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly redis: RedisService,
  ) {}

  /**
   * BE-18 (F-01): liveness NE dira bazu. Docker/Coolify healthcheck je vezan na ovaj
   * endpoint, pa bi provjera baze ovdje pretvarala pad baze u restart-loop aplikacije
   * koja je živa i može se sama oporaviti kad baza vrati.
   */
  getLiveness(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * BE-18 (F-02, F-03) + INF-05: readiness provjerava **zavisnosti** (Postgres, MinIO, stanje
   * migracija) sa ograničenim čekanjem i nikad ne baca grešku — vraća `status: 'error'`, a
   * kontroler to prevodi u `503`. Detalji greške se ne vraćaju (mogu sadržavati host/kredencijale).
   */
  async getReadiness(): Promise<ReadinessResponse> {
    const [postgres, storage, migrations, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkStorage(),
      this.checkMigrations(),
      this.checkRedis(),
    ]);
    const failed = [postgres, storage, migrations].some(
      (check) => check.status === 'error' || check.status === 'pending',
    );
    return {
      status: failed ? 'error' : 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { postgres, storage, migrations, redis },
    };
  }

  private async checkPostgres(): Promise<CheckResult> {
    const startedAt = Date.now();
    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`);
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.warn(
        `Readiness: postgres nije dostupan (${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        error: 'unreachable',
      };
    }
  }

  private async checkStorage(): Promise<CheckResult> {
    const startedAt = Date.now();
    if (process.env.MINIO_SKIP === 'true') {
      return { status: 'ok', latencyMs: 0, detail: 'skipped' };
    }
    try {
      await this.withTimeout(this.minio.healthCheck());
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.warn(
        `Readiness: MinIO nije dostupan (${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        error: 'unreachable',
      };
    }
  }

  /**
   * INF-07 (D-039): Redis je **opciona** zavisnost — `disabled` kad `REDIS_HOST` nije zadat,
   * a `error` ne obara readiness, jer aplikacija namjerno radi bez Redisa (throttle tada
   * pada na memorijski storage). Status je tu da monitoring vidi da je Redis otpao.
   */
  private async checkRedis(): Promise<CheckResult> {
    const startedAt = Date.now();
    try {
      const result = await this.withTimeout<{
        status: 'ok' | 'error' | 'disabled';
      }>(this.redis.ping());
      return {
        status: result.status,
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        error: 'unreachable',
      };
    }
  }

  /**
   * INF-05: `_prisma_migrations` je Prisma tabela; broj **završenih** migracija mora biti
   * jednak broju foldera u slici. Manje primijenjenih = deploy još traje (ili je baza stara).
   */
  private async checkMigrations(): Promise<CheckResult> {
    const startedAt = Date.now();
    const expected = expectedMigrationCount();
    try {
      const rows = await this.withTimeout(
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "_prisma_migrations"
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        `,
        (value) => {
          const first = (value as { count: bigint }[])[0];
          return first ? Number(first.count) : 0;
        },
      );
      const applied = rows;
      const status: HealthStatus =
        expected === null ? 'unknown' : applied >= expected ? 'ok' : 'pending';
      return {
        status,
        latencyMs: Date.now() - startedAt,
        applied,
        expected,
      };
    } catch {
      // Baza nije dostupna — to je već `postgres.status = 'error'`; ovdje ne dupliramo grešku.
      return {
        status: 'unknown',
        latencyMs: Date.now() - startedAt,
        applied: -1,
        expected,
        error: 'postgres unavailable',
      };
    }
  }

  /** `Promise.race` sa tvrdim limitom; timer se čisti da ne drži event loop. */
  private async withTimeout<T>(
    work: Promise<unknown>,
    map?: (value: unknown) => T,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('health probe timeout')),
        HEALTH_PROBE_TIMEOUT_MS,
      );
    });
    try {
      const value = await Promise.race([work, timeout]);
      return map ? map(value) : (value as T);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
