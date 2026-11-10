import {
  validateR4SyncPush,
  type R4SyncEvent,
  type R4SyncPullPage,
  type R4SyncPushItem,
  type R4SyncPushItemResult,
  type R4WorkEntryPayload,
} from "@gradix/domain";
import type { LocalSqlite } from "./migrations";

export type LocalAccount = { companyId: string; userId: string };
export type LocalForemanWorker = { id: string; name: string };

export class LocalAccountScopeError extends Error {
  readonly code = "LOCAL_ACCOUNT_SCOPE_MISMATCH";
  constructor() {
    super("Lokalna baza je aktivna za drugi nalog; redovi se ne mogu poslati pod ovim nalogom.");
    this.name = "LocalAccountScopeError";
  }
}

export class LocalOutboxError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalOutboxError";
    this.code = code;
  }
}

function sameAccount(row: { company_id: string; user_id: string } | null | undefined, account: LocalAccount): boolean {
  return row?.company_id === account.companyId && row.user_id === account.userId;
}

async function assertActiveAccount(db: LocalSqlite, account: LocalAccount): Promise<void> {
  const row = await db.getFirstAsync<{ company_id: string; user_id: string }>(
    "SELECT company_id, user_id FROM active_account WHERE singleton = 1",
  );
  if (!sameAccount(row, account)) throw new LocalAccountScopeError();
}

async function clearCachedRows(db: LocalSqlite): Promise<void> {
  await db.execAsync(`
    DELETE FROM obligations_cache;
    DELETE FROM projects_cache;
    DELETE FROM foreman_workers_cache;
    -- Conflict payloads are not disposable cache: keep their original account-bound event rows.
    DELETE FROM sync_events WHERE entity_type <> 'sync_conflict';
    DELETE FROM sync_cursors;
    DELETE FROM sync_meta WHERE key IN ('last_sync', 'obligations_fetched_at', 'projects_fetched_at');
  `);
}

export async function getActiveLocalAccount(db: LocalSqlite): Promise<LocalAccount | null> {
  const row = await db.getFirstAsync<{ company_id: string; user_id: string }>(
    "SELECT company_id, user_id FROM active_account WHERE singleton = 1",
  );
  return row ? { companyId: row.company_id, userId: row.user_id } : null;
}

/**
 * Switch the visible account. All server-derived caches and pull cursors are cleared on any
 * account change; outbox rows are intentionally retained and remain partitioned by company/user.
 */
export async function activateLocalAccount(db: LocalSqlite, account: LocalAccount): Promise<{
  changed: boolean;
  previous: LocalAccount | null;
  pendingForOtherAccounts: number;
}> {
  let outcome: { changed: boolean; previous: LocalAccount | null; pendingForOtherAccounts: number } = {
    changed: false,
    previous: null,
    pendingForOtherAccounts: 0,
  };
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ company_id: string; user_id: string }>(
      "SELECT company_id, user_id FROM active_account WHERE singleton = 1",
    );
    const previous = row ? { companyId: row.company_id, userId: row.user_id } : null;
    const changed = !sameAccount(row, account);
    const pending = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM outbox
        WHERE status IN ('pending', 'failed', 'conflict', 'rejected')
          AND NOT (company_id = ? AND user_id = ?)`,
      [account.companyId, account.userId],
    );
    if (changed) await clearCachedRows(db);
    await db.runAsync(
      `INSERT INTO active_account (singleton, company_id, user_id) VALUES (1, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET company_id = excluded.company_id, user_id = excluded.user_id`,
      [account.companyId, account.userId],
    );
    outcome = {
      changed,
      previous,
      pendingForOtherAccounts: pending?.count ?? 0,
    };
  });
  return outcome;
}

/** Logout clears private/server caches and cursor, but never deletes unsent outbox/conflict rows. */
export async function clearLocalAccountData(db: LocalSqlite): Promise<void> {
  await db.withTransactionAsync(async () => {
    await clearCachedRows(db);
    await db.execAsync("DELETE FROM active_account;");
  });
}

export async function pendingOutboxCount(db: LocalSqlite, account: LocalAccount): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM outbox
      WHERE company_id = ? AND user_id = ?
        AND status IN ('pending', 'failed', 'conflict', 'rejected')`,
    [account.companyId, account.userId],
  );
  return row?.count ?? 0;
}

/** Legacy R0 rows have no account key: preserve and warn, never mix them into the R4 outbox. */
export async function pendingLegacyR0Count(db: LocalSqlite): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT count(*) AS count FROM notes WHERE status IN ('pending', 'failed')",
  );
  return row?.count ?? 0;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function enqueueR4Items(
  db: LocalSqlite,
  account: LocalAccount,
  items: readonly R4SyncPushItem[],
  createdAt = new Date().toISOString(),
): Promise<number> {
  const validation = validateR4SyncPush(items);
  if (!validation.ok) throw new LocalOutboxError(validation.code, "Offline red nije ispravan; nije sačuvan.");
  let inserted = 0;
  await db.withTransactionAsync(async () => {
    await assertActiveAccount(db, account);
    for (const item of items) {
      const payload = canonicalJson(item);
      const existing = await db.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM outbox WHERE company_id = ? AND user_id = ? AND local_id = ?",
        [account.companyId, account.userId, item.localId],
      );
      if (existing) {
        if (existing.payload_json !== payload) {
          throw new LocalOutboxError("OUTBOX_LOCAL_ID_REUSED", "Lokalni ID već postoji uz drugi sadržaj.");
        }
        continue;
      }
      await db.runAsync(
        `INSERT INTO outbox
           (company_id, user_id, local_id, worker_id, entity_type, payload_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [account.companyId, account.userId, item.localId,
          item.workerId ?? null, item.entityType, payload, createdAt, createdAt],
      );
      inserted += 1;
    }
  });
  return inserted;
}

export async function saveForemanWorkerRoster(
  db: LocalSqlite,
  account: LocalAccount,
  projectId: string,
  workDate: string,
  workers: readonly LocalForemanWorker[],
  fetchedAt = new Date().toISOString(),
): Promise<void> {
  if (!projectId || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(workDate)) {
    throw new LocalOutboxError("FOREMAN_ROSTER_INVALID", "Projekat ili work_date nije ispravan.");
  }
  const seen = new Set<string>();
  for (const worker of workers) {
    if (!worker.id || worker.id.length > 128 || !worker.name.trim() || worker.name.length > 260 || seen.has(worker.id)) {
      throw new LocalOutboxError("FOREMAN_ROSTER_INVALID", "Roster mora sadržati jedinstvene ID-eve i imena.");
    }
    seen.add(worker.id);
  }
  await db.withTransactionAsync(async () => {
    await assertActiveAccount(db, account);
    await db.runAsync(
      "DELETE FROM foreman_workers_cache WHERE company_id = ? AND user_id = ? AND project_id = ? AND work_date = ?",
      [account.companyId, account.userId, projectId, workDate],
    );
    for (const worker of workers) {
      // Only ID and display name are persisted; phone/email never enter this cache.
      await db.runAsync(
        `INSERT INTO foreman_workers_cache
           (company_id, user_id, project_id, work_date, worker_id, worker_name, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [account.companyId, account.userId, projectId, workDate, worker.id, worker.name, fetchedAt],
      );
    }
  });
}

export async function readForemanWorkerRoster(
  db: LocalSqlite,
  account: LocalAccount,
  projectId: string,
  workDate: string,
): Promise<{ workers: LocalForemanWorker[]; fetchedAt: string | null }> {
  await assertActiveAccount(db, account);
  const rows = await db.getAllAsync<{ worker_id: string; worker_name: string; fetched_at: string }>(
    `SELECT worker_id, worker_name, fetched_at FROM foreman_workers_cache
      WHERE company_id = ? AND user_id = ? AND project_id = ? AND work_date = ?
      ORDER BY worker_name, worker_id`,
    [account.companyId, account.userId, projectId, workDate],
  );
  return {
    workers: rows.map((row) => ({ id: row.worker_id, name: row.worker_name })),
    fetchedAt: rows[0]?.fetched_at ?? null,
  };
}

function uuid(): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/**
 * Create one durable local work_entry per selected roster member. This lets the R4a-2 group
 * workflow queue work offline; the server repeats the R3 scope check before every write.
 */
export async function queueForemanGroupWorkEntries(
  db: LocalSqlite,
  account: LocalAccount,
  input: {
    projectId: string;
    workDate: string;
    workerIds: readonly string[];
    entry: R4WorkEntryPayload;
    deviceSentAt?: string;
  },
  makeId: () => string = uuid,
): Promise<R4SyncPushItem[]> {
  if (!input.projectId || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.workDate)
      || input.entry.kind !== "WORK" || input.entry.projectId !== input.projectId) {
    throw new LocalOutboxError("FOREMAN_GROUP_INVALID", "Grupni unos mora koristiti projekat iz R3 rostera.");
  }
  // A client offset date can differ from the company's local business date near midnight.
  // The server computes work_date in companies.timezone and enforces the R3 interval there.
  if (input.workerIds.length < 1 || new Set(input.workerIds).size !== input.workerIds.length) {
    throw new LocalOutboxError("FOREMAN_GROUP_INVALID", "Izaberi najmanje jednog radnika, bez duplikata.");
  }
  const roster = await readForemanWorkerRoster(db, account, input.projectId, input.workDate);
  const allowed = new Set(roster.workers.map((worker) => worker.id));
  if (input.workerIds.some((workerId) => !allowed.has(workerId))) {
    throw new LocalOutboxError("FOREMAN_WORKER_OUTSIDE_CACHED_SCOPE", "Radnik nije u preuzetom R3 rosteru za ovaj projekat i datum.");
  }

  const deviceSentAt = input.deviceSentAt ?? new Date().toISOString();
  const items: R4SyncPushItem[] = input.workerIds.map((workerId) => ({
    localId: makeId(),
    entityType: "work_entry",
    workerId,
    workdayId: makeId(),
    workEntryId: makeId(),
    deviceSentAt,
    entry: input.entry,
  }));
  await enqueueR4Items(db, account, items, deviceSentAt);
  return items;
}

function parseOutboxItem(value: string): R4SyncPushItem {
  const parsed = JSON.parse(value) as R4SyncPushItem;
  const validation = validateR4SyncPush([parsed]);
  if (!validation.ok) throw new LocalOutboxError(validation.code, "U lokalnom outboxu je oštećen sync zapis.");
  return parsed;
}

export function createSqliteR4SyncStore(db: LocalSqlite, account: LocalAccount) {
  return {
    pending: async (): Promise<readonly R4SyncPushItem[]> => {
      await assertActiveAccount(db, account);
      const rows = await db.getAllAsync<{ payload_json: string }>(
        `SELECT payload_json FROM outbox
          WHERE company_id = ? AND user_id = ? AND status IN ('pending', 'failed')
          ORDER BY created_at, local_id`,
        [account.companyId, account.userId],
      );
      return rows.map((row) => parseOutboxItem(row.payload_json));
    },
    markResult: async (result: R4SyncPushItemResult): Promise<void> => {
      await db.withTransactionAsync(async () => {
        await assertActiveAccount(db, account);
        const status = result.status === "APPLIED" || result.status === "DUPLICATE"
          ? "sent"
          : result.status === "CONFLICT" ? "conflict" : "rejected";
        await db.runAsync(
          `UPDATE outbox SET status = ?, last_error = ?, server_id = ?, server_version = ?, updated_at = ?
            WHERE company_id = ? AND user_id = ? AND local_id = ?`,
          [status, result.code ?? null, result.entityId, result.version, new Date().toISOString(),
            account.companyId, account.userId, result.localId],
        );
      });
    },
    markRetry: async (localId: string, code: string): Promise<void> => {
      await db.withTransactionAsync(async () => {
        await assertActiveAccount(db, account);
        await db.runAsync(
          `UPDATE outbox SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ?
            WHERE company_id = ? AND user_id = ? AND local_id = ? AND status <> 'sent'`,
          [code, new Date().toISOString(), account.companyId, account.userId, localId],
        );
      });
    },
    readCursor: async (): Promise<string> => {
      await assertActiveAccount(db, account);
      const row = await db.getFirstAsync<{ cursor: string }>(
        "SELECT cursor FROM sync_cursors WHERE company_id = ? AND user_id = ?",
        [account.companyId, account.userId],
      );
      return row?.cursor ?? "";
    },
    applyPullPage: async (page: R4SyncPullPage): Promise<void> => {
      await db.withTransactionAsync(async () => {
        await assertActiveAccount(db, account);
        const fetchedAt = new Date().toISOString();
        for (const event of page.events) {
          const row: R4SyncEvent = event;
          await db.runAsync(
            `INSERT INTO sync_events
               (company_id, user_id, event_id, cursor_seq, entity_type, entity_id, entity_version,
                payload_json, tombstone, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(company_id, user_id, event_id) DO NOTHING`,
            [account.companyId, account.userId, row.id, row.cursorSeq, row.entityType, row.entityId,
              row.entityVersion, row.payload === null ? null : canonicalJson(row.payload), row.tombstone ? 1 : 0, row.createdAt],
          );
        }
        await db.runAsync(
          `INSERT INTO sync_cursors (company_id, user_id, cursor, cursor_floor, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(company_id, user_id) DO UPDATE SET
             cursor = excluded.cursor, cursor_floor = excluded.cursor_floor, updated_at = excluded.updated_at`,
          [account.companyId, account.userId, page.cursor, page.cursorFloor, fetchedAt],
        );
      });
    },
  };
}

export type LocalOutboxEntry = {
  localId: string;
  workerId: string | null;
  status: string;
  lastError: string | null;
  createdAt: string;
};

/** Redovi trenutnog naloga za ekrane Moj dan / Grupa — ishod se prikazuje po radniku. */
export async function readOutboxEntries(db: LocalSqlite, account: LocalAccount): Promise<LocalOutboxEntry[]> {
  await assertActiveAccount(db, account);
  const rows = await db.getAllAsync<{ local_id: string; worker_id: string | null; status: string; last_error: string | null; created_at: string }>(
    `SELECT local_id, worker_id, status, last_error, created_at FROM outbox
      WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC, local_id DESC`,
    [account.companyId, account.userId],
  );
  return rows.map((row) => ({
    localId: row.local_id, workerId: row.worker_id, status: row.status,
    lastError: row.last_error, createdAt: row.created_at,
  }));
}

/** Vlastiti unos radnika: bez workerId — server iz sesije zna čiji je dan. */
export async function queueOwnWorkEntry(
  db: LocalSqlite,
  account: LocalAccount,
  entry: R4WorkEntryPayload,
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "work_entry",
    workdayId: makeId(),
    workEntryId: makeId(),
    deviceSentAt,
    entry,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}
