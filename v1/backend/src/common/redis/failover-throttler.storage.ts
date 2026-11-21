import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorage as ThrottlerStorageContract } from '@nestjs/throttler';

/** `ThrottlerStorageRecord` nije izvezen iz paketa (v6), pa tip izvodimo iz ugovora. */
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorageContract['increment']>
>;
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

/**
 * INF-07 (D-039): throttle brojač živi u Redisu da bi limit važio **između replika** i preživio
 * restart. Ako Redis padne, storage se vraća na memorijski (`fallback`) — API nastavlja raditi,
 * samo zaštita postaje lokalna za proces (fail-open, nikad 500 zbog Redisa).
 *
 * Brojanje je atomsko: `INCR` + `PEXPIRE` u jednom `MULTI` (isti prozor kao memorijski storage).
 * Ključ je `<prefix>throttle:<throttlerName>:<hash>` — ACL korisnik ima pravo samo na `<prefix>*`.
 */
export class FailoverThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(FailoverThrottlerStorage.name);
  private warned = false;

  constructor(
    private readonly redis: Redis | null,
    private readonly prefix: string,
    private readonly fallback: ThrottlerStorage,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.redis) {
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
    const redisKey = `${this.prefix}throttle:${throttlerName}:${key}`;
    try {
      const replies = await this.redis
        .multi()
        .incr(redisKey)
        .pexpire(redisKey, ttl, 'NX')
        .pttl(redisKey)
        .exec();
      const totalHits = Number(replies?.[0]?.[1] ?? 0);
      const pttlRaw = Number(replies?.[2]?.[1] ?? -1);
      const pttl = pttlRaw > 0 ? pttlRaw : ttl;
      const isBlocked = totalHits > limit;
      return {
        totalHits,
        timeToExpire: Math.ceil(pttl / 1000),
        isBlocked,
        timeToBlockExpire: isBlocked ? Math.ceil(pttl / 1000) : 0,
      };
    } catch {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'Redis nedostupan — throttle prelazi na memorijski storage (fail-open).',
        );
      }
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }
}
