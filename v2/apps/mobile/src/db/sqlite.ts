/**
 * Lokalna baza na uređaju (expo-sqlite).
 *
 * Offline-first: zapis se prvo upisuje OVDJE, pa ide u red za slanje.
 * Nikad obrnuto — ako mreža padne u trenutku upisa, radnik ne smije izgubiti zapis.
 *
 * Šema je namjerno minimalna (R0): jedan tip zapisa (`note`). R4 dodaje radni dan,
 * ture i gorivo, ali obrazac ostaje isti: `status` + `serverId` + `attempts`.
 */
import * as SQLite from "expo-sqlite";
import { DB_NAME, migrateLocalDatabase } from "./migrations";

export { DB_NAME, LOCAL_SCHEMA_VERSION, LocalDatabaseMigrationError, migrateLocalDatabase } from "./migrations";

export type SyncStatus = "pending" | "syncing" | "sent" | "failed";

export type LocalNote = {
  localId: string;
  text: string;
  clientAt: string;
  status: SyncStatus;
  serverId: string | null;
  attempts: number;
};

let openDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Open one shared handle and run the versioned, backup-before-change migration exactly once. */
export function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!openDbPromise) {
    openDbPromise = (async () => {
      // PRIVREMENO (dijagnostika release boot-a u CI) — skloniti nakon
      // dijagnoze: breadcrumbs u logcat, workflow ih čita u anotacije.
      console.log("[e2e] sqlite open start");
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      console.log("[e2e] sqlite open ok");
      try {
        // Keep the database untouched until the migration helper has made a verified backup.
        await db.execAsync("PRAGMA foreign_keys = ON;");
        console.log("[e2e] pragma fk ok");
        await migrateLocalDatabase(db);
        console.log("[e2e] migrate ok");
        await db.execAsync("PRAGMA journal_mode = WAL;");
        console.log("[e2e] pragma wal ok");
        return db;
      } catch (error) {
        await db.closeAsync().catch(() => undefined);
        throw error;
      }
    })().catch((error) => {
      openDbPromise = null;
      throw error;
    });
  }
  return openDbPromise;
}

export async function insertNote(
  db: SQLite.SQLiteDatabase,
  note: { localId: string; text: string; clientAt: string },
): Promise<void> {
  await db.runAsync(
    "INSERT OR IGNORE INTO notes (local_id, text, client_at, status) VALUES (?, ?, ?, 'pending')",
    [note.localId, note.text, note.clientAt],
  );
}

export async function pendingNotes(db: SQLite.SQLiteDatabase): Promise<LocalNote[]> {
  const rows = await db.getAllAsync<{
    local_id: string;
    text: string;
    client_at: string;
    status: SyncStatus;
    server_id: string | null;
    attempts: number;
  }>("SELECT * FROM notes WHERE status IN ('pending', 'failed') ORDER BY client_at ASC");
  return rows.map((row) => ({
    localId: row.local_id,
    text: row.text,
    clientAt: row.client_at,
    status: row.status,
    serverId: row.server_id,
    attempts: row.attempts,
  }));
}

export async function markSent(
  db: SQLite.SQLiteDatabase,
  localId: string,
  serverId: string,
): Promise<void> {
  await db.runAsync(
    "UPDATE notes SET status = 'sent', server_id = ? WHERE local_id = ?",
    [serverId, localId],
  );
}

export async function markFailed(db: SQLite.SQLiteDatabase, localId: string): Promise<void> {
  await db.runAsync(
    "UPDATE notes SET status = 'failed', attempts = attempts + 1 WHERE local_id = ?",
    [localId],
  );
}

export async function pendingCount(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT count(*) AS count FROM notes WHERE status IN ('pending', 'failed')",
  );
  return row?.count ?? 0;
}

export async function readWatermark(db: SQLite.SQLiteDatabase): Promise<string> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = 'last_sync'",
  );
  return row?.value ?? "1970-01-01T00:00:00.000Z";
}

export async function writeWatermark(db: SQLite.SQLiteDatabase, value: string): Promise<void> {
  await db.runAsync(
    "INSERT INTO sync_meta (key, value) VALUES ('last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [value],
  );
}

/* ------------------------------------------------------------------ rokovi (R2b) */

/**
 * Lokalna kopija spiska rokova. Offline-first i ovdje: zadnji preuzet spisak ostaje vidljiv bez
 * veze, uz vrijeme preuzimanja („od prije 2 sata“). Ne čuva se ništa što nije na ekranu — nema
 * priloga ni brojeva dokumenata.
 */
export type LocalObligation = {
  id: string;
  typeLabel: string;
  target: string;
  expiresAt: string | null;
  state: string;
  daysLeft: number | null;
};

export async function saveObligations(
  db: SQLite.SQLiteDatabase,
  rows: LocalObligation[],
  fetchedAt: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync("DELETE FROM obligations_cache");
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO obligations_cache (id, type_label, target, expires_at, state, days_left)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, row.typeLabel, row.target, row.expiresAt, row.state, row.daysLeft],
      );
    }
    await db.runAsync(
      "INSERT INTO sync_meta (key, value) VALUES ('obligations_fetched_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [fetchedAt],
    );
  });
}

export async function readObligations(
  db: SQLite.SQLiteDatabase,
): Promise<{ rows: LocalObligation[]; fetchedAt: string | null }> {
  const rows = await db.getAllAsync<{
    id: string;
    type_label: string;
    target: string;
    expires_at: string | null;
    state: string;
    days_left: number | null;
  }>("SELECT id, type_label, target, expires_at, state, days_left FROM obligations_cache");
  const meta = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = 'obligations_fetched_at'",
  );
  return {
    rows: rows.map((row) => ({
      id: row.id,
      typeLabel: row.type_label,
      target: row.target,
      expiresAt: row.expires_at,
      state: row.state,
      daysLeft: row.days_left,
    })),
    fetchedAt: meta?.value ?? null,
  };
}

/* ---------------------------------------------------------------- projekti (R3) */

export type LocalProject = {
  id: string;
  code: string;
  name: string;
  status: string;
  sitePlace: string | null;
  startsOn: string | null;
  endsOn: string | null;
};

export async function saveProjects(
  db: SQLite.SQLiteDatabase,
  rows: LocalProject[],
  fetchedAt: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync("DELETE FROM projects_cache");
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO projects_cache (id, code, name, status, site_place, starts_on, ends_on)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.code, row.name, row.status, row.sitePlace, row.startsOn, row.endsOn],
      );
    }
    await db.runAsync(
      "INSERT INTO sync_meta (key, value) VALUES ('projects_fetched_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [fetchedAt],
    );
  });
}

export async function readProjects(
  db: SQLite.SQLiteDatabase,
): Promise<{ rows: LocalProject[]; fetchedAt: string | null }> {
  const rows = await db.getAllAsync<{
    id: string;
    code: string;
    name: string;
    status: string;
    site_place: string | null;
    starts_on: string | null;
    ends_on: string | null;
  }>("SELECT id, code, name, status, site_place, starts_on, ends_on FROM projects_cache ORDER BY code");
  const meta = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = 'projects_fetched_at'",
  );
  return {
    rows: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      sitePlace: row.site_place,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
    })),
    fetchedAt: meta?.value ?? null,
  };
}
