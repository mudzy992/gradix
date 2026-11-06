import { createHmac } from 'node:crypto';

export const REFRESH_REPLAY_GRACE_MS = 20_000;
export const REFRESH_REPLAY_MAX_RETRIES = 2;

export function isWithinRefreshReplayWindow(
  rotatedAt: Date,
  now: Date,
): boolean {
  const age = now.getTime() - rotatedAt.getTime();
  return age >= 0 && age < REFRESH_REPLAY_GRACE_MS;
}

/** Deterministic opaque 48-byte successor; never store/log parent or output. */
export function deriveRefreshSuccessor(
  parent: string,
  accessSecret: string,
): string {
  const key = createHmac('sha512', accessSecret)
    .update('gradix.refresh.replay.v1')
    .digest();
  return createHmac('sha512', key)
    .update(parent)
    .digest()
    .subarray(0, 48)
    .toString('base64url');
}
