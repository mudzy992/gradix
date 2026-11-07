/**
 * Offline sync — pravila koja moraju biti ista na serveru i u testovima.
 *
 * Ugovor (R0, jedan entitet; širenje po entitetima je R4):
 *  - push: najviše BATCH_LIMIT zapisa po zahtjevu; više je 400 za cijeli batch
 *  - idempotentnost: (companyId, userId, deviceId, localId) — ponovljeni zapis NE pravi duplikat
 *  - pull: najviše PULL_LIMIT redova; watermark je najmanji `serverAt` vraćenih redova,
 *    pa se red na granici šalje ponovo i nijedan se ne preskače (v1 D-036)
 *  - `since` u budućnosti je greška, a ne klijent koji zauvijek ne dobija podatke
 */

export const SYNC_PUSH_MAX_ITEMS = 200;
export const SYNC_PULL_LIMIT = 1000;
/** Dozvoljeno odstupanje sata uređaja prema naprijed (UTC). */
export const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export type SyncEntityType = "note";

export const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = ["note"] as const;

export type SyncPushItem = {
  localId: string;
  entityType: SyncEntityType;
  payload: Record<string, unknown>;
  clientAt: Date;
};

export type SyncErrorCode =
  | "SYNC_BATCH_TOO_LARGE"
  | "SYNC_ENTITY_TYPE_UNKNOWN"
  | "SYNC_LOCAL_ID_INVALID"
  | "SYNC_CLIENT_AT_INVALID"
  | "SYNC_SINCE_INVALID";

export type ValidationResult = { ok: true } | { ok: false; code: SyncErrorCode };

const LOCAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function isSyncEntityType(value: unknown): value is SyncEntityType {
  return typeof value === "string" && (SYNC_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Validacija cijelog batch-a PRIJE ijednog upisa (v1 D-058 princip: batch je atomski na ulazu). */
export function validatePushBatch(
  items: readonly SyncPushItem[],
  now: Date,
): ValidationResult {
  if (items.length === 0 || items.length > SYNC_PUSH_MAX_ITEMS) {
    return { ok: false, code: "SYNC_BATCH_TOO_LARGE" };
  }
  const skewLimit = now.getTime() + MAX_CLOCK_SKEW_SECONDS * 1000;
  const seen = new Set<string>();
  for (const item of items) {
    if (!isSyncEntityType(item.entityType)) return { ok: false, code: "SYNC_ENTITY_TYPE_UNKNOWN" };
    if (!LOCAL_ID_PATTERN.test(item.localId)) return { ok: false, code: "SYNC_LOCAL_ID_INVALID" };
    if (seen.has(item.localId)) return { ok: false, code: "SYNC_LOCAL_ID_INVALID" };
    seen.add(item.localId);
    if (Number.isNaN(item.clientAt.getTime()) || item.clientAt.getTime() > skewLimit) {
      return { ok: false, code: "SYNC_CLIENT_AT_INVALID" };
    }
  }
  return { ok: true };
}

/**
 * Watermark za sljedeći pull.
 * Vraća najmanji `serverAt` vraćenih redova — tako red na granici dolazi ponovo.
 * Ako ništa nije vraćeno, watermark ostaje nepromijenjen (`since`).
 */
export function nextWatermark(
  rows: readonly { serverAt: Date }[],
  since: Date,
): Date {
  let min = since.getTime();
  let found = false;
  for (const row of rows) {
    const time = row.serverAt.getTime();
    if (!found || time < min) {
      min = time;
      found = true;
    }
  }
  return new Date(min);
}

/** `since` u budućnosti ili neispravan datum nije prazan rezultat, nego greška. */
export function isSinceValid(since: Date, now: Date): boolean {
  if (Number.isNaN(since.getTime())) return false;
  return since.getTime() <= now.getTime() + MAX_CLOCK_SKEW_SECONDS * 1000;
}
