import type { LocalSqlite } from "../db/migrations";
import type { LocalAccount } from "../db/r4-outbox";
import { createSqliteR4SyncStore } from "../db/r4-outbox";
import { runR4Sync, type R4SyncOutcome } from "./r4-engine";
import type { R4SyncPullPage } from "@gradix/domain";

/**
 * Production R4 sync binding. SQLite reads are account-partitioned and each HTTP request also
 * verifies /api/me against the same account while pinning its bearer token for that request.
 */
export async function runSqliteR4Sync(db: LocalSqlite, account: LocalAccount): Promise<R4SyncOutcome> {
  const store = createSqliteR4SyncStore(db, account);
  return runR4Sync(store, {
    push: async (items) => (await import("../api/client")).pushSyncItems(account, items),
    /* Ugovor (`SyncPullResponse`) i domena (`R4SyncPullPage`) opisuju isti feed; `cursorSeq` u
       događaju je `string` na oba mjesta, pa je razlika samo u tome što zod izvede širu uniju
       `entityType`-a. Prevodi se ovdje, na granici mreže — engine radi sa tipom domene. */
    pull: async (cursor, limit) => {
      const page = await (await import("../api/client")).pullSyncChanges(account, cursor, limit);
      return page as unknown as R4SyncPullPage;
    },
  });
}
