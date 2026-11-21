import type { LocalSqlite } from "../db/migrations";
import type { LocalAccount } from "../db/r4-outbox";
import { createSqliteR4SyncStore } from "../db/r4-outbox";
import { runR4Sync, type R4SyncOutcome } from "./r4-engine";

/**
 * Production R4 sync binding. SQLite reads are account-partitioned and each HTTP request also
 * verifies /api/me against the same account while pinning its bearer token for that request.
 */
export async function runSqliteR4Sync(db: LocalSqlite, account: LocalAccount): Promise<R4SyncOutcome> {
  const store = createSqliteR4SyncStore(db, account);
  return runR4Sync(store, {
    push: async (items) => (await import("../api/client")).pushSyncItems(account, items),
    pull: async (cursor, limit) => (await import("../api/client")).pullSyncChanges(account, cursor, limit),
  });
}
