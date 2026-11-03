import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import fs from 'node:fs';

/**
 * INF-07 (D-039): jedan Redis klijent za cijeli proces (throttle storage danas, cache kasnije).
 *
 * Politika je **fail-open**: ako Redis nije konfigurisan (`REDIS_HOST` prazan) klijent je `null`
 * i aplikacija radi kao i prije (throttle u memoriji). Ako je konfigurisan ali nedostupan,
 * pozivaoci dobijaju grešku, a `FailoverThrottlerStorage` se vraća na memorijski storage — Redis
 * nikad ne smije srušiti API.
 *
 * Veza je TLS (Coolify `redis-core` ima svoj CA) i ACL korisnik (`REDIS_USER`, default `gradix`),
 * pa klijent nema administratorska prava — vidi `scripts/ops/redis-acl.sh`.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis | null;
  readonly prefix: string;
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    const host = config.get<string>('REDIS_HOST');
    this.prefix = config.get<string>('REDIS_PREFIX') ?? 'gradix:';
    this.enabled = Boolean(host && host.trim());
    if (!this.enabled) {
      this.client = null;
      return;
    }
    const caFile = config.get<string>('REDIS_TLS_CA_FILE');
    const tls =
      caFile && fs.existsSync(caFile)
        ? { ca: fs.readFileSync(caFile, 'utf8'), servername: host }
        : undefined;
    if (!tls) {
      this.logger.warn(
        `Redis: CA fajl nije pronađen (${caFile ?? 'REDIS_TLS_CA_FILE nije zadat'}) — veza ide bez TLS provjere CA.`,
      );
    }
    this.client = new Redis({
      host,
      port: Number(config.get('REDIS_PORT') ?? 6380),
      username: config.get<string>('REDIS_USER') ?? 'gradix',
      password: config.get<string>('REDIS_PASSWORD') ?? undefined,
      tls,
      lazyConnect: true,
      // Jedan pokušaj po komandi: throttle ne smije čekati sekunde na mrtav Redis.
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      // Reconnect u pozadini, ali bez blokiranja zahtjeva (offline queue isključen).
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
    });
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis: ${error.name}`);
    });
    // Namjerno ne await-ujemo: aplikacija starta i ako Redis još nije spreman (fail-open).
    void this.client.connect().catch(() => undefined);
  }

  /** Zdravstvena provjera za `/api/ready`; nikad ne baca. */
  async ping(): Promise<{
    status: 'ok' | 'error' | 'disabled';
    latencyMs: number;
  }> {
    if (!this.client) return { status: 'disabled', latencyMs: 0 };
    const startedAt = Date.now();
    try {
      await this.client.ping();
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch {
      return { status: 'error', latencyMs: Date.now() - startedAt };
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
