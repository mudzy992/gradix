import {
  validateR4SyncPush,
  type R4DailyCheckPayload,
  type R4FaultPayload,
  type R4FuelEntryPayload,
  type R4HaulPayload,
  type R4MachineWorkLogPayload,
  type R4SyncEvent,
  type R4SyncPullPage,
  type R4SyncPushItem,
  type R4SyncPushItemResult,
  type R4WorkEntryPayload,
  type R4ServiceOrderActionPushItem,
  type ServiceOrderActionPayload,
  type R4SiteDiaryPayload,
  type R4SiteDiaryItemPayload,
  type R4HseIncidentPayload,
  type R4HseActionPayload,
  type R4HseTrainingPayload,
} from "@gradix/domain";
import type { SiteDiaryDetail } from "@gradix/contracts";
import type { LocalSqlite } from "./migrations";
import { resolutionsByLocalId, type ResolutionDisplay } from "../sync/r4-resolution";
import { readyR4Rows } from "../sync/r4-dependencies";

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
    DELETE FROM diary_detail_cache;
    DELETE FROM material_issue_catalog;
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
          AND (last_error IS NULL OR last_error NOT LIKE 'DIARY_REFERENCE_RECOVERED:%')
          AND NOT (company_id = ? AND user_id = ?)`,
      [account.companyId, account.userId],
    );
    if (changed) await clearCachedRows(db);
    await db.runAsync(
      `INSERT INTO active_account (singleton, company_id, user_id) VALUES (1, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET company_id = excluded.company_id, user_id = excluded.user_id`,
      [account.companyId, account.userId],
    );
    const materialPending = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM material_issue_outbox WHERE status IN ('pending','failed','rejected') AND NOT (company_id=? AND user_id=?)`,
      [account.companyId, account.userId],
    );
    outcome = {
      changed,
      previous,
      pendingForOtherAccounts: (pending?.count ?? 0) + (materialPending?.count ?? 0),
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
        AND status IN ('pending', 'failed', 'conflict', 'rejected')
        AND (last_error IS NULL OR last_error NOT LIKE 'DIARY_REFERENCE_RECOVERED:%')`,
    [account.companyId, account.userId],
  );
  const material = await db.getFirstAsync<{count:number}>(
    "SELECT count(*) AS count FROM material_issue_outbox WHERE company_id=? AND user_id=? AND status IN ('pending','failed','rejected')",
    [account.companyId,account.userId],
  );
  return (row?.count ?? 0)+(material?.count ?? 0);
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
  writeDependencies?: () => Promise<void>,
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
          "workerId" in item ? (item.workerId ?? null) : null, item.entityType, payload, createdAt, createdAt],
      );
      inserted += 1;
    }
    if (writeDependencies) await writeDependencies();
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
/** Blokiraj novi nacrt istog dana dok prethodni još čeka ili traži razrješenje. */
export async function hasUnresolvedDiaryEdit(db: LocalSqlite, account: LocalAccount, projectId: string, date: string): Promise<boolean> {
  await assertActiveAccount(db, account);
  const rows = await db.getAllAsync<{ payload_json: string }>(
    `SELECT payload_json FROM outbox WHERE company_id = ? AND user_id = ? AND entity_type IN ('site_diary', 'site_diary_item')
       AND status IN ('pending', 'failed', 'rejected', 'conflict')`, [account.companyId, account.userId],
  );
  return rows.some((row) => {
    try {
      const item = parseOutboxItem(row.payload_json);
      return (item.entityType === "site_diary" && item.diary.projectId === projectId && item.diary.diaryDate === date) ||
        (item.entityType === "site_diary_item" && item.diaryProjectId === projectId && item.diaryDate === date);
    } catch { return true; } // Nepoznat sadržaj nije dokaz da je potpis siguran.
  });
}

/** Keš dnevnika je strogo vezan za nalog i čuva samo zadnji potvrđeni server snapshot. */
export async function cacheDiaryDetail(db: LocalSqlite, account: LocalAccount, detail: SiteDiaryDetail): Promise<void> {
  await db.withTransactionAsync(async () => {
    await assertActiveAccount(db, account);
    await db.runAsync(
      `INSERT INTO diary_detail_cache (company_id, user_id, project_id, diary_date, payload_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, user_id, project_id, diary_date)
       DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
      [account.companyId, account.userId, detail.diary.projectId, detail.diary.diaryDate,
        JSON.stringify(detail), new Date().toISOString()],
    );
  });
}

export async function clearDiaryDetailCache(db: LocalSqlite, account: LocalAccount, projectId: string, date: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await assertActiveAccount(db, account);
    await db.runAsync("DELETE FROM diary_detail_cache WHERE company_id = ? AND user_id = ? AND project_id = ? AND diary_date = ?",
      [account.companyId, account.userId, projectId, date]);
  });
}

export async function readDiaryDetailCache(db: LocalSqlite, account: LocalAccount, projectId: string, date: string):
Promise<{ detail: SiteDiaryDetail; fetchedAt: string } | null> {
  await assertActiveAccount(db, account);
  const row = await db.getFirstAsync<{ payload_json: string; fetched_at: string }>(
    `SELECT payload_json, fetched_at FROM diary_detail_cache
      WHERE company_id = ? AND user_id = ? AND project_id = ? AND diary_date = ?`,
    [account.companyId, account.userId, projectId, date],
  );
  if (!row) return null;
  return { detail: JSON.parse(row.payload_json) as SiteDiaryDetail, fetchedAt: row.fetched_at };
}

/** Tipovi koje lokalna baza prima iz pull-a (ista lista kao `outbox` CHECK u v2). */
type SyncEntityType =
  | "workday"
  | "work_entry"
  | "sync_conflict"
  | "machine_work_log"
  | "fuel_entry"
  | "haul"
  | "machine_daily_check"
  | "machine_fault"
  | "service_order_action"
  | "site_diary"
  | "site_diary_item"
  | "hse_incident"
  | "hse_action"
  | "hse_training";

const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  "workday",
  "work_entry",
  "sync_conflict",
  "machine_work_log",
  "fuel_entry",
  "haul",
  "machine_daily_check",
  "machine_fault",
  "service_order_action",
  "site_diary",
  "site_diary_item",
  "hse_incident",
  "hse_action",
  "hse_training",
];

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
      const rows = await db.getAllAsync<{ local_id: string; payload_json: string; status: string; last_error: string | null; entity_type: string }>(
        `SELECT local_id, payload_json, status, last_error, entity_type FROM outbox
          WHERE company_id = ? AND user_id = ? AND status IN ('pending', 'failed', 'conflict', 'rejected')
          ORDER BY rowid`,
        [account.companyId, account.userId],
      );
      const parsed: { item: R4SyncPushItem; status: string }[] = [];
      const damaged = new Set<string>();
      for (const row of rows) {
        if (row.last_error?.startsWith("DIARY_REFERENCE_RECOVERED:")) continue;
        try { parsed.push({ item: parseOutboxItem(row.payload_json), status: row.status }); }
        catch {
          damaged.add(row.entity_type);
          // Oštećen red ostaje sačuvan; bez poznatog ključa zavisni tipovi moraju čekati.
          if (row.status === "pending" || row.status === "failed") {
            await db.withTransactionAsync(async () => {
              await assertActiveAccount(db, account);
              await db.runAsync("UPDATE outbox SET status = 'rejected', last_error = 'LOCAL_ITEM_INVALID', updated_at = ? WHERE company_id = ? AND user_id = ? AND local_id = ? AND status IN ('pending', 'failed')",
                [new Date().toISOString(), account.companyId, account.userId, row.local_id]);
            });
          }
        }
      }
      return readyR4Rows(parsed).filter((item) => {
        if (damaged.has("site_diary") && (item.entityType === "site_diary_item" || item.entityType === "site_diary")) return false;
        if (damaged.has("site_diary_item") && item.entityType === "site_diary" && item.diary.signature) return false;
        if (damaged.has("hse_incident") && item.entityType === "hse_action") return false;
        return true;
      });
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
      /* Nepoznat `entityType` se odbija PRIJE transakcije. Baza ga nekad odbija `CHECK`-om, ali
         `sync_events` u v2 više nema `CHECK` (proširen u F8) — bez ove provjere bi događaj ušao u
         keš i kursor bi otišao dalje, a sukob se ne bi mogao prikazati. */
      for (const event of page.events) {
        if (!SYNC_ENTITY_TYPES.includes(event.entityType as SyncEntityType)) {
          throw new LocalOutboxError("SYNC_PULL_ENTITY_UNSUPPORTED", "Događaj sa nepoznatim tipom nije primljen.");
        }
      }
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

/**
 * R4a-2 ishodi razrješenja iz pull događaja (sync_events), po lokalnom zapisu.
 * Čita se iz istih događaja koje je pull već upisao — bez novog zahtjeva.
 */
export async function readResolutionOutcomes(
  db: LocalSqlite,
  account: LocalAccount,
): Promise<Map<string, ResolutionDisplay>> {
  await assertActiveAccount(db, account);
  const rows = await db.getAllAsync<{ payload_json: string | null }>(
    `SELECT payload_json FROM sync_events
      WHERE company_id = ? AND user_id = ? AND entity_type = 'sync_conflict'
      ORDER BY cursor_seq`,
    [account.companyId, account.userId],
  );
  const events = rows.flatMap((row) => {
    if (!row.payload_json) return [];
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      return [{ entityType: "sync_conflict", payload }];
    } catch {
      return [];
    }
  });
  return resolutionsByLocalId(events);
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
      WHERE company_id = ? AND user_id = ? AND (last_error IS NULL OR last_error NOT LIKE 'DIARY_REFERENCE_RECOVERED:%')
      ORDER BY created_at DESC, local_id DESC`,
    [account.companyId, account.userId],
  );
  return rows.map((row) => ({
    localId: row.local_id, workerId: row.worker_id, status: row.status,
    lastError: row.last_error, createdAt: row.created_at,
  }));
}

/** Vlastiti unos radnika: bez workerId — server iz sesije zna čiji je dan. */
export async function queueFuelEntry(
  db: LocalSqlite,
  account: LocalAccount,
  fuelEntryId: string,
  entry: R4FuelEntryPayload,
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "fuel_entry",
    fuelEntryId,
    deviceSentAt,
    entry,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

export async function queueHaul(
  db: LocalSqlite,
  account: LocalAccount,
  haulId: string,
  haul: R4HaulPayload,
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "haul",
    haulId,
    deviceSentAt,
    haul,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

export async function queueDailyCheck(
  db: LocalSqlite,
  account: LocalAccount,
  checkId: string,
  check: R4DailyCheckPayload,
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "machine_daily_check",
    checkId,
    deviceSentAt,
    check,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

export async function queueMachineFault(
  db: LocalSqlite,
  account: LocalAccount,
  faultId: string,
  fault: R4FaultPayload,
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "machine_fault",
    faultId,
    deviceSentAt,
    fault,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

export async function queueMachineWorkLog(
  db: LocalSqlite,
  account: LocalAccount,
  workLogId: string,
  log: R4MachineWorkLogPayload,
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "machine_work_log",
    workLogId,
    deviceSentAt,
    log,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

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

/**
 * F8 — radionička radnja u offline red.
 *
 * `actionId` je ključ idempotencije i mora biti JEDINSTVEN po radnji, ne po nalogu: dva utroška
 * istog dijela na istom nalogu su dvije radnje. Zato ga pozivalac pravi sa `uuid()` (a ne iz
 * `orderId`), a server ga koristi kao `source_id` kretnje zaliha.
 */
export async function queueServiceOrderAction(
  db: LocalSqlite,
  account: LocalAccount,
  input: {
    orderId: string;
    action: ServiceOrderActionPayload;
  },
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4ServiceOrderActionPushItem = {
    localId: makeId(),
    entityType: "service_order_action",
    actionId: makeId(),
    serviceOrderId: input.orderId,
    deviceSentAt,
    action: input.action,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

/* ------------------------------------------------------ F9: dnevnik i HSE u offline redu */

export type LegacyDiaryItem = { localId: string; description: string; unit: string; quantity: string; deviceSentAt: string };

/** Oporavljaju se samo redovi za koje je server potvrdio odbijanje, nikad nepoznat ishod. */
export async function readLegacyDiaryItems(db: LocalSqlite, account: LocalAccount): Promise<LegacyDiaryItem[]> {
  await assertActiveAccount(db, account);
  const rows = await db.getAllAsync<{ local_id: string; payload_json: string }>(
    `SELECT local_id, payload_json FROM outbox WHERE company_id = ? AND user_id = ?
      AND entity_type = 'site_diary_item' AND status = 'rejected' AND last_error = 'DIARY_REFERENCE_REQUIRED' ORDER BY rowid`,
    [account.companyId, account.userId],
  );
  return rows.flatMap((row) => {
    try {
      const parsed = parseOutboxItem(row.payload_json);
      if (parsed.entityType !== "site_diary_item" || parsed.diaryProjectId || parsed.diaryDate) return [];
      return [{ localId: row.local_id, description: parsed.item.description, unit: parsed.item.unit,
        quantity: parsed.item.quantity, deviceSentAt: parsed.deviceSentAt }];
    } catch { return []; }
  });
}

/** Korisnik potvrđuje poslovni ključ; izvorni sadržaj ostaje netaknut i dobija novu idempotency oznaku. */
export async function recoverLegacyDiaryItem(db: LocalSqlite, account: LocalAccount, localId: string,
  projectId: string, date: string, makeId: () => string = uuid): Promise<void> {
  await db.withTransactionAsync(async () => {
    await assertActiveAccount(db, account);
    const row = await db.getFirstAsync<{ payload_json: string }>(
      `SELECT payload_json FROM outbox WHERE company_id = ? AND user_id = ? AND local_id = ?
        AND entity_type = 'site_diary_item' AND status = 'rejected' AND last_error = 'DIARY_REFERENCE_REQUIRED'`,
      [account.companyId, account.userId, localId],
    );
    if (!row) throw new LocalOutboxError("LEGACY_ITEM_NOT_RECOVERABLE", "Red nije pronađen ili je već popravljen.");
    const original = parseOutboxItem(row.payload_json);
    if (original.entityType !== "site_diary_item" || original.diaryProjectId || original.diaryDate) {
      throw new LocalOutboxError("LEGACY_ITEM_NOT_RECOVERABLE", "Ovaj red ne traži izbor dana.");
    }
    const item: R4SyncPushItem = { ...original, localId: makeId(), diaryProjectId: projectId, diaryDate: date };
    const validation = validateR4SyncPush([item]);
    if (!validation.ok) throw new LocalOutboxError(validation.code, "Izaberi ispravan projekat i datum.");
    const now = new Date().toISOString();
    await db.runAsync(`INSERT INTO outbox (company_id, user_id, local_id, worker_id, entity_type, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'site_diary_item', ?, 'pending', ?, ?)`,
    [account.companyId, account.userId, item.localId, canonicalJson(item), now, now]);
    await db.runAsync("UPDATE outbox SET last_error = ?, updated_at = ? WHERE company_id = ? AND user_id = ? AND local_id = ?",
      [`DIARY_REFERENCE_RECOVERED:${item.localId}`, now, account.companyId, account.userId, localId]);
  });
}

/**
 * F9 — dnevnik dana sa terena.
 *
 * `baseVersion` je verzija koju je šef VIDIO prije tipkanja (a ne broj sa servera u ovom trenutku):
 * ako je neko drugi mijenjao isti dan, server odbija sa `DIARY_VERSION_CONFLICT` umjesto da tiho
 * pregazi tuđi unos. Zato je parametar obavezan — pozivalac koji ne zna verziju ne smije ni da pošalje.
 */
export async function queueSiteDiary(
  db: LocalSqlite,
  account: LocalAccount,
  input: { diaryId: string; baseVersion: number; diary: R4SiteDiaryPayload },
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "site_diary",
    diaryId: input.diaryId,
    deviceSentAt,
    baseVersion: input.baseVersion,
    diary: input.diary,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

/** Količina je vezana za projekat i datum dnevnika, nikad za datum slanja. */
export async function queueSiteDiaryItem(
  db: LocalSqlite,
  account: LocalAccount,
  input: { diaryItemId: string; diaryProjectId: string; diaryDate: string; item: R4SiteDiaryItemPayload },
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "site_diary_item",
    diaryItemId: input.diaryItemId,
    diaryProjectId: input.diaryProjectId,
    diaryDate: input.diaryDate,
    deviceSentAt,
    item: input.item,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

/**
 * F9 — HSE prijava sa terena.
 *
 * `incidentId` je lokalni ID i isti drugi put NE pravi drugi incident (server ga koristi kao
 * `client_local_id`). Nema `baseVersion`: incident nema izmjenu činjenica, pa nema ni sukoba —
 * dopuna ide kao zasebna izjava kroz `updateBody`.
 */
export async function queueHseIncident(
  db: LocalSqlite,
  account: LocalAccount,
  input: { incidentId: string; incident: R4HseIncidentPayload; photoData?: { sha256: string; base64: string }[] },
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "hse_incident",
    incidentId: input.incidentId,
    deviceSentAt,
    incident: input.incident,
  };
  const files = input.photoData ?? [];
  const photos = input.incident.photos;
  if (files.length !== photos.length || new Set(files.map((file) => file.sha256)).size !== files.length) {
    throw new LocalOutboxError("PHOTO_DATA_MISSING", "Svaka fotografija mora imati sačuvane lokalne bajtove.");
  }
  for (const photo of photos) {
    const file = files.find((f) => f.sha256 === photo.sha256);
    if (!file || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) {
      throw new LocalOutboxError("PHOTO_DATA_INVALID", "Fotografija nije ispravno pročitana.");
    }
    const bytes = (file.base64.length / 4) * 3 - (file.base64.endsWith("==") ? 2 : file.base64.endsWith("=") ? 1 : 0);
    if (bytes !== photo.sizeBytes) throw new LocalOutboxError("PHOTO_DATA_INVALID", "Veličina fotografije se ne poklapa.");
  }
  await enqueueR4Items(db, account, [item], deviceSentAt, async () => {
    for (const photo of photos) {
      const file = files.find((f) => f.sha256 === photo.sha256)!;
      const existing = await db.getFirstAsync<{ data_base64: string; incident_id: string }>(
        "SELECT data_base64, incident_id FROM hse_photo_queue WHERE company_id = ? AND user_id = ? AND local_id = ? AND sha256 = ?",
        [account.companyId, account.userId, item.localId, photo.sha256],
      );
      if (existing) {
        if (existing.incident_id !== input.incidentId || (existing.data_base64 !== "" && existing.data_base64 !== file.base64)) {
          throw new LocalOutboxError("PHOTO_DATA_INVALID", "Fotografija već postoji sa drugim sadržajem.");
        }
        continue;
      }
      await db.runAsync(
        `INSERT INTO hse_photo_queue (company_id, user_id, local_id, incident_id, sha256, content_type, data_base64)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [account.companyId, account.userId, item.localId, input.incidentId, photo.sha256, photo.contentType, file.base64],
      );
    }
  });
  return item;
}

/** Korektivna mjera: tačno jedan izvor (incident ILI inspekcija), odgovorni i rok obavezni. */
export async function queueHseAction(
  db: LocalSqlite,
  account: LocalAccount,
  input: { actionId: string; action: R4HseActionPayload },
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "hse_action",
    actionId: input.actionId,
    deviceSentAt,
    action: input.action,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}

/** Toolbox / obuka: prisustvo je potpis (ime + vrijeme), pa se šalje uz zapis, ne naknadno. */
export async function queueHseTraining(
  db: LocalSqlite,
  account: LocalAccount,
  input: { trainingId: string; training: R4HseTrainingPayload },
  deviceSentAt: string = new Date().toISOString(),
  makeId: () => string = uuid,
): Promise<R4SyncPushItem> {
  const item: R4SyncPushItem = {
    localId: makeId(),
    entityType: "hse_training",
    trainingId: input.trainingId,
    deviceSentAt,
    training: input.training,
  };
  await enqueueR4Items(db, account, [item], deviceSentAt);
  return item;
}
