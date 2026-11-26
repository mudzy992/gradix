/** Fotografije se šalju tek nakon potvrđene prijave, a bajtovi se čuvaju do potvrde servera. */
import type { LocalSqlite } from "../db/migrations";
import { getActiveLocalAccount, type LocalAccount } from "../db/r4-outbox";

export type PhotoRow = { local_id: string; incident_id: string; sha256: string; content_type: string; data_base64: string };
export type HsePhotoTransport = {
  resume: (incidentId: string, sha: string, action: "UPLOAD_URL" | "CONFIRM") => Promise<{ status: "pending" | "confirmed"; uploadUrl: string | null }>;
  put: (url: string, contentType: string, base64: string) => Promise<void>;
};

async function assertAccount(db: LocalSqlite, account: LocalAccount) {
  const current = await getActiveLocalAccount(db);
  if (current?.companyId !== account.companyId || current?.userId !== account.userId) {
    throw Object.assign(new Error("Nalog se promijenio."), { code: "LOCAL_ACCOUNT_SCOPE_MISMATCH" });
  }
}

export async function countPendingHsePhotos(db: LocalSqlite, account: LocalAccount): Promise<number> {
  await assertAccount(db, account);
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT count(*) AS count FROM hse_photo_queue WHERE company_id = ? AND user_id = ? AND status = 'pending'",
    [account.companyId, account.userId],
  );
  return row?.count ?? 0;
}

export async function pendingHsePhotos(db: LocalSqlite, account: LocalAccount): Promise<PhotoRow[]> {
  await assertAccount(db, account);
  return db.getAllAsync<PhotoRow>(
    `SELECT p.local_id, p.incident_id, p.sha256, p.content_type, p.data_base64 FROM hse_photo_queue p
       JOIN outbox o ON o.company_id = p.company_id AND o.user_id = p.user_id AND o.local_id = p.local_id
      WHERE p.company_id = ? AND p.user_id = ? AND p.status = 'pending'
        AND o.status = 'sent' AND o.server_id = p.incident_id ORDER BY o.created_at, p.sha256`,
    [account.companyId, account.userId],
  );
}

export async function runHsePhotoSync(db: LocalSqlite, account: LocalAccount, transport: HsePhotoTransport): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const photo of await pendingHsePhotos(db, account)) {
    try {
      await assertAccount(db, account);
      const state = await transport.resume(photo.incident_id, photo.sha256, "UPLOAD_URL");
      if (state.status !== "confirmed") {
        if (!state.uploadUrl) throw new Error("PHOTO_UPLOAD_URL_MISSING");
        await transport.put(state.uploadUrl, photo.content_type, photo.data_base64);
        const confirmed = await transport.resume(photo.incident_id, photo.sha256, "CONFIRM");
        if (confirmed.status !== "confirmed") throw new Error("PHOTO_CONFIRM_FAILED");
      }
      await db.withTransactionAsync(async () => {
        await assertAccount(db, account);
        await db.runAsync(
          `UPDATE hse_photo_queue SET status = 'sent', data_base64 = '', last_error = NULL
            WHERE company_id = ? AND user_id = ? AND local_id = ? AND sha256 = ?`,
          [account.companyId, account.userId, photo.local_id, photo.sha256],
        );
      });
      sent += 1;
    } catch {
      // Podaci ostaju netaknuti; novi pokušaj prvo provjerava je li server već potvrdio.
      failed += 1;
      await db.withTransactionAsync(async () => {
        await assertAccount(db, account);
        await db.runAsync(
          `UPDATE hse_photo_queue SET last_error = 'PHOTO_UPLOAD_FAILED'
            WHERE company_id = ? AND user_id = ? AND local_id = ? AND sha256 = ? AND status = 'pending'`,
          [account.companyId, account.userId, photo.local_id, photo.sha256],
        );
      });
    }
  }
  return { sent, failed };
}
