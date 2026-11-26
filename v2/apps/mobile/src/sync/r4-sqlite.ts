import type { LocalSqlite } from "../db/migrations";
import type { LocalAccount } from "../db/r4-outbox";
import { createSqliteR4SyncStore } from "../db/r4-outbox";
import { runR4Sync, type R4SyncOutcome } from "./r4-engine";
import { runHsePhotoSync } from "./hse-photo-sync";
import type { R4SyncPullPage } from "@gradix/domain";

/**
 * Production R4 sync binding. SQLite reads are account-partitioned and each HTTP request also
 * verifies /api/me against the same account while pinning its bearer token for that request.
 */
export async function runSqliteR4Sync(db: LocalSqlite, account: LocalAccount): Promise<R4SyncOutcome> {
  const store = createSqliteR4SyncStore(db, account);
  const outcome = await runR4Sync(store, {
    push: async (items) => (await import("../api/client")).pushSyncItems(account, items),
    /* Ugovor (`SyncPullResponse`) i domena (`R4SyncPullPage`) opisuju isti feed; `cursorSeq` u
       događaju je `string` na oba mjesta, pa je razlika samo u tome što zod izvede širu uniju
       `entityType`-a. Prevodi se ovdje, na granici mreže — engine radi sa tipom domene. */
    pull: async (cursor, limit) => {
      const page = await (await import("../api/client")).pullSyncChanges(account, cursor, limit);
      return page as unknown as R4SyncPullPage;
    },
  });
  if (!outcome.error) {
    try {
      const result = await runHsePhotoSync(db, account, {
        resume: async (incidentId, sha, action) => (await import("../api/client")).resumeIncidentPhoto(account, incidentId, sha, action),
        put: async (url, contentType, base64) => {
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          const response = await fetch(url, { method: "PUT", headers: { "content-type": contentType }, body: bytes });
          if (!response.ok) throw new Error("PHOTO_PUT_FAILED");
        },
      });
      if (result.failed) { outcome.retry += result.failed; outcome.error = "PHOTO_UPLOAD_FAILED"; }
    } catch { outcome.retry += 1; outcome.error = "PHOTO_UPLOAD_FAILED"; }
  }
  return outcome;
}
