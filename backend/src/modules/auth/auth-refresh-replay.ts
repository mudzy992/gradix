import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/client';

export const REFRESH_REPLAY_GRACE_MS = 20_000;
export const REFRESH_REPLAY_MAX_RETRIES = 2;

export function isWithinRefreshReplayWindow(
  rotatedAt: Date,
  now: Date,
): boolean {
  const age = now.getTime() - rotatedAt.getTime();
  return age >= 0 && age < REFRESH_REPLAY_GRACE_MS;
}

/** The real clock is obtained only after the transaction has acquired the lock. */
@Injectable()
export class RefreshReplayClock {
  async now(tx: Prisma.TransactionClient): Promise<Date> {
    const [clock] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    return clock.now;
  }
}

/** Deterministic opaque 48-byte successor; never store/log parent or output. */
export function deriveRefreshSuccessor(
  parent: string,
  replaySecret: string,
  family: string,
  generation: number,
): string {
  return createHmac('sha512', replaySecret)
    .update(
      JSON.stringify(['gradix.refresh.replay.v2', family, generation, parent]),
    )
    .digest()
    .subarray(0, 48)
    .toString('base64url');
}

/** Both inputs must be canonical fixed-size SHA-256 hashes. */
export function safeRefreshHashEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
