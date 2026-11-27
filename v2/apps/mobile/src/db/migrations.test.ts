import { rmSync } from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalDatabaseBackupFactory } from "./migrations";
import { createNodeSqlite } from "../test/node-sqlite";
import { LOCAL_SCHEMA_VERSION, migrateLocalDatabase } from "./migrations";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function nodeBackupFactory(directory: string, calls: { created: number; restored: number }): LocalDatabaseBackupFactory {
  return async (database) => {
    const source = (database as unknown as { raw?: DatabaseSync }).raw;
    if (!source) throw new Error("test adapter did not expose its database");
    const backupPath = join(directory, "pre-migration.db");
    await backup(source, backupPath);
    calls.created += 1;
    return {
      name: backupPath,
      restore: async () => { calls.restored += 1; },
      close: async () => undefined,
    };
  };
}

describe("versioned local SQLite migration", () => {
  it("migrates a populated R0 database without losing rows and leaves a pre-change backup", async () => {
    const sqlite = createNodeSqlite();
    const { directory, raw } = sqlite;
    const adapter = sqlite;
    tempDirs.push(directory);
    raw.exec(`
      CREATE TABLE notes (
        local_id TEXT PRIMARY KEY NOT NULL,
        text TEXT NOT NULL,
        client_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        server_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE projects_cache (
        id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
        site_place TEXT, starts_on TEXT, ends_on TEXT
      );
      CREATE TABLE obligations_cache (
        id TEXT PRIMARY KEY NOT NULL, type_label TEXT NOT NULL, target TEXT NOT NULL,
        expires_at TEXT, state TEXT NOT NULL, days_left INTEGER
      );
      INSERT INTO notes (local_id, text, client_at, status, attempts)
        VALUES ('legacy-note-1', 'sačuvati bilješku', '2026-11-01T10:00:00Z', 'failed', 2);
      INSERT INTO sync_meta (key, value) VALUES ('last_sync', 'legacy-watermark');
      INSERT INTO projects_cache (id, code, name, status) VALUES ('p1', 'P-1', 'Most', 'ACTIVE');
      INSERT INTO obligations_cache (id, type_label, target, state) VALUES ('o1', 'Ljekarski', 'Amar', 'valid');
      PRAGMA user_version = 0;
    `);
    const backupCalls = { created: 0, restored: 0 };

    const result = await migrateLocalDatabase(adapter, nodeBackupFactory(directory, backupCalls));

    expect(result.version).toBe(LOCAL_SCHEMA_VERSION);
    expect(result.backupName).toBe(join(directory, "pre-migration.db"));
    expect(backupCalls).toEqual({ created: 1, restored: 0 });
    expect((await adapter.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version)
      .toBe(LOCAL_SCHEMA_VERSION);
    expect(await adapter.getFirstAsync("SELECT local_id, text, status, attempts FROM notes WHERE local_id = 'legacy-note-1'"))
      .toEqual({ local_id: "legacy-note-1", text: "sačuvati bilješku", status: "failed", attempts: 2 });
    expect(await adapter.getFirstAsync("SELECT value FROM sync_meta WHERE key = 'last_sync'"))
      .toEqual({ value: "legacy-watermark" });
    expect(await adapter.getFirstAsync("SELECT id, code, name FROM projects_cache WHERE id = 'p1'"))
      .toEqual({ id: "p1", code: "P-1", name: "Most" });
    expect(await adapter.getFirstAsync("SELECT id, target FROM obligations_cache WHERE id = 'o1'"))
      .toEqual({ id: "o1", target: "Amar" });
    expect(await adapter.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'"))
      .toEqual({ name: "outbox" });
    // Nijedan red ne smije nestati: svaka R0 tabela zadržava tačno uneseni broj redova.
    for (const table of ["notes", "sync_meta", "projects_cache", "obligations_cache"]) {
      expect(await adapter.getFirstAsync(`SELECT count(*) AS count FROM ${table}`), table).toEqual({ count: 1 });
    }

    const backupDb = new DatabaseSync(result.backupName!);
    expect(backupDb.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
    expect(backupDb.prepare("SELECT text FROM notes WHERE local_id='legacy-note-1'").get())
      .toEqual({ text: "sačuvati bilješku" });
    expect(backupDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'").get())
      .toBeUndefined();
    backupDb.close();
    raw.close();
  });

  it("is idempotent after the target user_version is committed", async () => {
    const sqlite = createNodeSqlite();
    const { directory, raw } = sqlite;
    const adapter = sqlite;
    tempDirs.push(directory);
    const calls = { created: 0, restored: 0 };
    const first = await migrateLocalDatabase(adapter, nodeBackupFactory(directory, calls));
    const second = await migrateLocalDatabase(adapter, nodeBackupFactory(directory, calls));
    expect(first.version).toBe(LOCAL_SCHEMA_VERSION);
    expect(second).toEqual({ version: LOCAL_SCHEMA_VERSION, backupName: null });
    expect(calls.created).toBe(0);
    raw.close();
  });

  it("keeps the R0 database intact, calls restore, and exposes a clear backup/rollback message on failure", async () => {
    const sqlite = createNodeSqlite();
    const { directory, raw } = sqlite;
    const adapter = sqlite;
    tempDirs.push(directory);
    raw.exec(`
      CREATE TABLE notes (local_id TEXT PRIMARY KEY NOT NULL, text TEXT NOT NULL, client_at TEXT NOT NULL);
      CREATE TABLE outbox (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO notes (local_id, text, client_at) VALUES ('legacy-1', 'keep me', '2026-11-01T10:00:00Z');
      PRAGMA user_version = 0;
    `);
    const calls = { created: 0, restored: 0 };

    await expect(migrateLocalDatabase(adapter, nodeBackupFactory(directory, calls)))
      .rejects.toMatchObject({
        name: "LocalDatabaseMigrationError",
        code: "LOCAL_DB_MIGRATION_FAILED",
        backupName: join(directory, "pre-migration.db"),
        restored: true,
      });
    expect(calls).toEqual({ created: 1, restored: 1 });
    expect((await adapter.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version).toBe(0);
    expect(await adapter.getFirstAsync("SELECT text FROM notes WHERE local_id = 'legacy-1'")).toEqual({ text: "keep me" });
    expect(await adapter.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_events'"))
      .toBeUndefined();
    raw.close();
  });

  it("stops on a database user_version newer than the app instead of resetting it", async () => {
    const sqlite = createNodeSqlite();
    const { directory, raw } = sqlite;
    const adapter = sqlite;
    tempDirs.push(directory);
    raw.exec("CREATE TABLE notes (local_id TEXT PRIMARY KEY, text TEXT NOT NULL, client_at TEXT NOT NULL); PRAGMA user_version = 99;");
    await expect(migrateLocalDatabase(adapter)).rejects.toMatchObject({ name: "LocalDatabaseMigrationError" });
    expect((await adapter.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version).toBe(99);
    raw.close();
  });

  it("F8: podiže v1 outbox na v2 bez gubitka neslanih zapisa i prima service_order_action", async () => {
    const sqlite = createNodeSqlite();
    const { directory, raw } = sqlite;
    tempDirs.push(directory);
    raw.exec(`
      CREATE TABLE outbox (
        company_id TEXT NOT NULL, user_id TEXT NOT NULL, local_id TEXT NOT NULL, worker_id TEXT,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('workday', 'work_entry')),
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'failed', 'sent', 'conflict', 'rejected')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error TEXT, server_id TEXT, server_version INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id, local_id)
      );
      CREATE TABLE sync_cursors (
        company_id TEXT NOT NULL, user_id TEXT NOT NULL, cursor TEXT NOT NULL,
        cursor_floor TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id)
      );
      CREATE TABLE sync_events (
        company_id TEXT NOT NULL, user_id TEXT NOT NULL, event_id TEXT NOT NULL,
        cursor_seq TEXT NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('workday', 'work_entry', 'sync_conflict')),
        entity_id TEXT NOT NULL, entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        payload_json TEXT, tombstone INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
        created_at TEXT NOT NULL, PRIMARY KEY (company_id, user_id, event_id)
      );
      CREATE TABLE foreman_workers_cache (
        company_id TEXT NOT NULL, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
        work_date TEXT NOT NULL, worker_id TEXT NOT NULL, worker_name TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id, project_id, work_date, worker_id)
      );
      CREATE TABLE active_account (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        company_id TEXT NOT NULL, user_id TEXT NOT NULL
      );
      INSERT INTO outbox
        (company_id, user_id, local_id, worker_id, entity_type, payload_json, status, created_at, updated_at)
        VALUES ('co1','u1','11111111-1111-4111-8111-111111111111', NULL, 'work_entry',
                '{"entityType":"work_entry"}', 'pending', '2026-11-01T08:00:00Z', '2026-11-01T08:00:00Z');
      PRAGMA user_version = 1;
    `);

    await migrateLocalDatabase(sqlite, async () => ({ name: "kopija.db", restore: async () => undefined, close: async () => undefined }));

    expect((await sqlite.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version)
      .toBe(LOCAL_SCHEMA_VERSION);
    expect((await sqlite.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM outbox"))?.count).toBe(1);

    // Nova vrsta stavke (radionica) sada prolazi kroz `CHECK`.
    await sqlite.runAsync(
      `INSERT INTO outbox
         (company_id, user_id, local_id, worker_id, entity_type, payload_json, status, created_at, updated_at)
       VALUES ('co1','u1','22222222-2222-4222-8222-222222222222', NULL, 'service_order_action',
               '{"entityType":"service_order_action"}', 'pending', '2026-11-02T08:00:00Z', '2026-11-02T08:00:00Z')`,
    );
    expect((await sqlite.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM outbox"))?.count).toBe(2);
  });

  it("F9: podiže v2 outbox na v3 bez gubitka zapisa i prima dnevnik i HSE", async () => {
    const sqlite = createNodeSqlite();
    const { directory, raw } = sqlite;
    tempDirs.push(directory);
    /* Neslani zapis sa terena mora preživjeti obnovu `CHECK`-a — zato je u fiksturi PRIJE migracije. */
    raw.exec(`
      CREATE TABLE outbox (
        company_id TEXT NOT NULL, user_id TEXT NOT NULL, local_id TEXT NOT NULL, worker_id TEXT,
        entity_type TEXT NOT NULL CHECK (entity_type IN (
          'workday', 'work_entry', 'machine_work_log', 'fuel_entry', 'haul',
          'machine_daily_check', 'machine_fault', 'service_order_action'
        )),
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'failed', 'sent', 'conflict', 'rejected')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error TEXT, server_id TEXT, server_version INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id, local_id)
      );
      CREATE TABLE sync_cursors (
        company_id TEXT NOT NULL, user_id TEXT NOT NULL, cursor TEXT NOT NULL,
        cursor_floor TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id)
      );
      CREATE TABLE sync_events (
        company_id TEXT NOT NULL, user_id TEXT NOT NULL, event_id TEXT NOT NULL,
        cursor_seq TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        payload_json TEXT, tombstone INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
        created_at TEXT NOT NULL, PRIMARY KEY (company_id, user_id, event_id)
      );
      CREATE TABLE foreman_workers_cache (
        company_id TEXT NOT NULL, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
        work_date TEXT NOT NULL, worker_id TEXT NOT NULL, worker_name TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id, project_id, work_date, worker_id)
      );
      CREATE TABLE active_account (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        company_id TEXT NOT NULL, user_id TEXT NOT NULL
      );
      INSERT INTO outbox
        (company_id, user_id, local_id, worker_id, entity_type, payload_json, status, created_at, updated_at)
        VALUES ('co1','u1','33333333-3333-4333-8333-333333333333', NULL, 'machine_fault',
                '{"entityType":"machine_fault"}', 'pending', '2026-11-03T08:00:00Z', '2026-11-03T08:00:00Z');
      PRAGMA user_version = 2;
    `);

    await migrateLocalDatabase(sqlite, async () => ({ name: "kopija.db", restore: async () => undefined, close: async () => undefined }));

    expect((await sqlite.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version)
      .toBe(LOCAL_SCHEMA_VERSION);
    expect((await sqlite.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM outbox"))?.count).toBe(1);

    /* Pet F9 tipova prolazi kroz novi `CHECK` — dnevnik, količina i tri HSE zapisa. */
    for (const [localId, entityType] of [
      ["44444444-4444-4444-8444-444444444444", "site_diary"],
      ["55555555-5555-4555-8555-555555555555", "site_diary_item"],
      ["66666666-6666-4666-8666-666666666666", "hse_incident"],
      ["77777777-7777-4777-8777-777777777777", "hse_action"],
      ["88888888-8888-4888-8888-888888888888", "hse_training"],
    ] as const) {
      await sqlite.runAsync(
        `INSERT INTO outbox
           (company_id, user_id, local_id, entity_type, payload_json, status, created_at, updated_at)
         VALUES ('co1','u1',?,?,?,'pending','2026-11-04T08:00:00Z','2026-11-04T08:00:00Z')`,
        [localId, entityType, `{"entityType":"${entityType}"}`],
      );
    }
    expect((await sqlite.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM outbox"))?.count).toBe(6);
  });
});
