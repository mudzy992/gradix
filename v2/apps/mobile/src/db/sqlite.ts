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

export const DB_NAME = "gradix.db";

export type SyncStatus = "pending" | "syncing" | "sent" | "failed";

export type LocalNote = {
  localId: string;
  text: string;
  clientAt: string;
  status: SyncStatus;
  serverId: string | null;
  attempts: number;
};

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS notes (
      local_id  TEXT PRIMARY KEY NOT NULL,
      text      TEXT NOT NULL,
      client_at TEXT NOT NULL,
      status    TEXT NOT NULL DEFAULT 'pending',
      server_id TEXT,
      attempts  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  return db;
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
