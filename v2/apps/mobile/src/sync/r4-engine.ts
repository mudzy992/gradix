/**
 * Pure R4 outbox/pull engine. Persistence and HTTP are injected so CI can simulate failures
 * deterministically; the SQLite adapter is added at the rollout's SQLite gate.
 */
import {
  R4_SYNC_PULL_MAX_ITEMS,
  R4_SYNC_PULL_MAX_PAGES_PER_RUN,
  R4_SYNC_PUSH_MAX_ITEMS,
  type R4SyncPullPage,
  type R4SyncPushItem,
  type R4SyncPushItemResult,
  type R4SyncPushResponse,
} from "@gradix/domain";

export type R4SyncTransport = {
  push: (items: readonly R4SyncPushItem[]) => Promise<R4SyncPushResponse>;
  pull: (cursor: string, limit: number) => Promise<R4SyncPullPage>;
};

/**
 * The storage adapter must apply an entire pull page AND persist its cursor in one SQLite
 * transaction. It must deduplicate repeated event IDs because a lower pending server slot can
 * cause a later committed event to be delivered again.
 */
export type R4SyncStore = {
  pending: () => Promise<readonly R4SyncPushItem[]>;
  markResult: (result: R4SyncPushItemResult) => Promise<void>;
  markRetry: (localId: string, code: string) => Promise<void>;
  readCursor: () => Promise<string>;
  applyPullPage: (page: R4SyncPullPage) => Promise<void>;
};

export type R4SyncOutcome = {
  applied: number;
  duplicate: number;
  conflict: number;
  rejected: number;
  retry: number;
  pulledEvents: number;
  cursor: string;
  cursorBlockedByPendingSlot: boolean;
  error: string | null;
};

export function chunkR4<T>(items: readonly T[], size = R4_SYNC_PUSH_MAX_ITEMS): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > R4_SYNC_PUSH_MAX_ITEMS) {
    throw new RangeError(`R4 sync batch size must be between 1 and ${R4_SYNC_PUSH_MAX_ITEMS}.`);
  }
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) batches.push(items.slice(offset, offset + size));
  return batches;
}

function errorCode(error: unknown): string {
  const candidate = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
  return /^[A-Z0-9_]{1,80}$/.test(candidate) ? candidate : "SYNC_NETWORK_OR_STORAGE_ERROR";
}

export async function runR4Sync(store: R4SyncStore, transport: R4SyncTransport): Promise<R4SyncOutcome> {
  const outcome: R4SyncOutcome = {
    applied: 0,
    duplicate: 0,
    conflict: 0,
    rejected: 0,
    retry: 0,
    pulledEvents: 0,
    cursor: "0",
    cursorBlockedByPendingSlot: false,
    error: null,
  };

  try {
    let cursor = await store.readCursor();
    outcome.cursor = cursor;
    for (const batch of chunkR4(await store.pending())) {
      let response: R4SyncPushResponse;
      try {
        response = await transport.push(batch);
      } catch (error) {
        const code = errorCode(error);
        for (const item of batch) {
          await store.markRetry(item.localId, code);
          outcome.retry += 1;
        }
        outcome.error = code;
        return outcome;
      }

      const byLocalId = new Map(response.results.map((result) => [result.localId, result]));
      for (const item of batch) {
        const result = byLocalId.get(item.localId);
        if (!result) {
          await store.markRetry(item.localId, "SYNC_RESULT_MISSING");
          outcome.retry += 1;
          continue;
        }
        await store.markResult(result);
        if (result.status === "APPLIED") outcome.applied += 1;
        else if (result.status === "DUPLICATE") outcome.duplicate += 1;
        else if (result.status === "CONFLICT") outcome.conflict += 1;
        else outcome.rejected += 1;
      }
    }

    for (let pageNo = 0; pageNo < R4_SYNC_PULL_MAX_PAGES_PER_RUN; pageNo += 1) {
      const page = await transport.pull(cursor, R4_SYNC_PULL_MAX_ITEMS);
      if (!page || !Array.isArray(page.events) || typeof page.cursor !== "string" || typeof page.hasMore !== "boolean") {
        throw Object.assign(new Error("invalid pull page"), { code: "SYNC_PULL_RESPONSE_INVALID" });
      }
      await store.applyPullPage(page);
      outcome.pulledEvents += page.events.length;
      const advanced = page.cursor !== cursor;
      cursor = page.cursor;
      outcome.cursor = cursor;
      if (!page.hasMore) break;
      if (!advanced) {
        // A lower PENDING server slot prevents cursor movement. Apply/dedupe any visible events,
        // then stop; retrying the same page in this run would spin and cannot safely skip the hole.
        outcome.cursorBlockedByPendingSlot = true;
        break;
      }
      if (pageNo === R4_SYNC_PULL_MAX_PAGES_PER_RUN - 1) outcome.error = "SYNC_PULL_PAGE_LIMIT";
    }
  } catch (error) {
    outcome.error = errorCode(error);
  }

  return outcome;
}
