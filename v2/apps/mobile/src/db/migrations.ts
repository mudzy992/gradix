import type * as SQLite from "expo-sqlite";

export const DB_NAME = "gradix.db";
/**
 * Verzija lokalne šeme. Podignuta na 2 u F8: `outbox`/`sync_events` su dobili šire skupove
 * `entity_type` (radioničke radnje i kvarovi), pa stara baza mora proći kroz `__v2` korak.
 */
export const LOCAL_SCHEMA_VERSION = 5;

export type LocalSqlite = Pick<
  SQLite.SQLiteDatabase,
  "execAsync" | "runAsync" | "getFirstAsync" | "getAllAsync" | "withTransactionAsync"
>;

export type LocalDatabaseBackup = {
  name: string;
  restore: () => Promise<void>;
  close: () => Promise<void>;
};

export type LocalDatabaseBackupFactory = (database: LocalSqlite) => Promise<LocalDatabaseBackup>;

export class LocalDatabaseMigrationError extends Error {
  readonly code = "LOCAL_DB_MIGRATION_FAILED";
  readonly backupName: string | null;
  readonly restored: boolean;

  constructor(message: string, options: { backupName?: string | null; restored?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = "LocalDatabaseMigrationError";
    this.backupName = options.backupName ?? null;
    this.restored = options.restored ?? false;
    if (options.cause !== undefined) Object.assign(this, { cause: options.cause });
  }
}

const LEGACY_SCHEMA = `
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
  CREATE TABLE IF NOT EXISTS projects_cache (
    id         TEXT PRIMARY KEY NOT NULL,
    code       TEXT NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL,
    site_place TEXT,
    starts_on  TEXT,
    ends_on    TEXT
  );
  CREATE TABLE IF NOT EXISTS obligations_cache (
    id         TEXT PRIMARY KEY NOT NULL,
    type_label TEXT NOT NULL,
    target     TEXT NOT NULL,
    expires_at TEXT,
    state      TEXT NOT NULL,
    days_left  INTEGER
  );
`;

const R4_SCHEMA = `
  CREATE TABLE IF NOT EXISTS active_account (
    singleton  INTEGER PRIMARY KEY CHECK (singleton = 1),
    company_id TEXT NOT NULL,
    user_id    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outbox (
    company_id    TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    local_id      TEXT NOT NULL,
    worker_id     TEXT,
    entity_type   TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'failed', 'sent', 'conflict', 'rejected')),
    attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error    TEXT,
    server_id     TEXT,
    server_version INTEGER,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (company_id, user_id, local_id)
  );
  CREATE INDEX IF NOT EXISTS outbox_pending_scope_idx
    ON outbox (company_id, user_id, status, created_at);
  CREATE TABLE IF NOT EXISTS sync_cursors (
    company_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    cursor      TEXT NOT NULL,
    cursor_floor TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (company_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS sync_events (
    company_id    TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    event_id      TEXT NOT NULL,
    cursor_seq    TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    entity_version INTEGER NOT NULL CHECK (entity_version > 0),
    payload_json  TEXT,
    tombstone     INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
    created_at    TEXT NOT NULL,
    PRIMARY KEY (company_id, user_id, event_id)
  );
  CREATE INDEX IF NOT EXISTS sync_events_scope_cursor_idx
    ON sync_events (company_id, user_id, cursor_seq);
  CREATE TABLE IF NOT EXISTS hse_photo_queue (
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    local_id TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    content_type TEXT NOT NULL,
    data_base64 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
    last_error TEXT,
    PRIMARY KEY (company_id, user_id, local_id, sha256),
    FOREIGN KEY (company_id, user_id, local_id) REFERENCES outbox(company_id, user_id, local_id)
  );
  CREATE TABLE IF NOT EXISTS diary_detail_cache (
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    diary_date TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (company_id, user_id, project_id, diary_date)
  );
  CREATE TABLE IF NOT EXISTS foreman_workers_cache (
    company_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    work_date   TEXT NOT NULL,
    worker_id   TEXT NOT NULL,
    worker_name TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (company_id, user_id, project_id, work_date, worker_id)
  );
`;

const CORE_TABLES = [
  "active_account",
  "outbox",
  "sync_cursors",
  "sync_events",
  "hse_photo_queue",
  "diary_detail_cache",
  "foreman_workers_cache",
] as const;

function tableColumns(rows: readonly { name: string }[]): Set<string> {
  return new Set(rows.map((row) => row.name));
}

async function ensureColumn(db: LocalSqlite, table: string, column: string, definition: string): Promise<void> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!tableColumns(rows).has(column)) await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureLegacySchema(db: LocalSqlite): Promise<void> {
  await db.execAsync(LEGACY_SCHEMA);

  const notes = tableColumns(await db.getAllAsync<{ name: string }>("PRAGMA table_info(notes)"));
  for (const required of ["local_id", "text", "client_at"]) {
    if (!notes.has(required)) {
      throw new Error(`legacy notes table lacks required ${required} column`);
    }
  }
  await ensureColumn(db, "notes", "status", "TEXT NOT NULL DEFAULT 'pending'");
  await ensureColumn(db, "notes", "server_id", "TEXT");
  await ensureColumn(db, "notes", "attempts", "INTEGER NOT NULL DEFAULT 0");

  const syncMeta = tableColumns(await db.getAllAsync<{ name: string }>("PRAGMA table_info(sync_meta)"));
  if (!syncMeta.has("key") || !syncMeta.has("value")) {
    throw new Error("legacy sync_meta table is not recognized; refusing destructive repair");
  }
  const projects = tableColumns(await db.getAllAsync<{ name: string }>("PRAGMA table_info(projects_cache)"));
  const obligations = tableColumns(await db.getAllAsync<{ name: string }>("PRAGMA table_info(obligations_cache)"));
  if (!projects.has("id") || !obligations.has("id")) {
    throw new Error("legacy cache tables are not recognized; refusing destructive repair");
  }

  // Older R0 copies may predate these read-only caches. Missing display columns get safe defaults;
  // existing rows and all existing columns remain untouched.
  await ensureColumn(db, "projects_cache", "code", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "projects_cache", "name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "projects_cache", "status", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "projects_cache", "site_place", "TEXT");
  await ensureColumn(db, "projects_cache", "starts_on", "TEXT");
  await ensureColumn(db, "projects_cache", "ends_on", "TEXT");
  await ensureColumn(db, "obligations_cache", "type_label", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "obligations_cache", "target", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "obligations_cache", "expires_at", "TEXT");
  await ensureColumn(db, "obligations_cache", "state", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "obligations_cache", "days_left", "INTEGER");
}

async function verifyR4Schema(db: LocalSqlite): Promise<void> {
  for (const table of CORE_TABLES) {
    const row = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    if (!row) throw new Error(`R4 local table ${table} was not created`);
  }
  const outbox = tableColumns(await db.getAllAsync<{ name: string }>("PRAGMA table_info(outbox)"));
  for (const column of ["company_id", "user_id", "local_id", "payload_json", "status"]) {
    if (!outbox.has(column)) throw new Error(`R4 outbox lacks ${column}`);
  }
}

/**
 * F8 (`user_version` 2): proširenje `outbox` i `sync_events` na sve sync entitete.
 *
 * SQLite ne mijenja `CHECK` ograničenje nadogradnjom — mora se obnoviti tabela. Radnja je
 * namjerno u JEDNOJ transakciji sa prenosom redova: `outbox` nosi neslane zapise, pa bi prekid
 * između „drop“ i „insert“ bio gubitak rada sa terena.
 *
 * `sync_events` je izvedena iz servera (kursor se obnavlja), ali se i ona prenosi — sukobi se
 * prikazuju iz nje, a stari kursor bi ih inače izgubio.
 */
async function upgradeToV2(db: LocalSqlite): Promise<void> {
  const outboxSql = await db.getFirstAsync<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'outbox'",
  );
  if (outboxSql?.sql?.includes("'service_order_action'")) return;

  await db.execAsync(`
    CREATE TABLE outbox__v2 (
      company_id    TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      local_id      TEXT NOT NULL,
      worker_id     TEXT,
      entity_type   TEXT NOT NULL CHECK (entity_type IN (
        'workday', 'work_entry', 'machine_work_log', 'fuel_entry', 'haul',
        'machine_daily_check', 'machine_fault', 'service_order_action'
      )),
      payload_json  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'failed', 'sent', 'conflict', 'rejected')),
      attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_error    TEXT,
      server_id     TEXT,
      server_version INTEGER,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      PRIMARY KEY (company_id, user_id, local_id)
    );
    INSERT INTO outbox__v2
      (company_id, user_id, local_id, worker_id, entity_type, payload_json, status, attempts,
       last_error, server_id, server_version, created_at, updated_at)
      SELECT company_id, user_id, local_id, worker_id, entity_type, payload_json, status, attempts,
             last_error, server_id, server_version, created_at, updated_at
        FROM outbox;
    DROP TABLE outbox;
    ALTER TABLE outbox__v2 RENAME TO outbox;
    CREATE INDEX IF NOT EXISTS outbox_pending_scope_idx
      ON outbox (company_id, user_id, status, created_at);

    CREATE TABLE sync_events__v2 (
      company_id    TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      event_id      TEXT NOT NULL,
      cursor_seq    TEXT NOT NULL,
      entity_type   TEXT NOT NULL,
      entity_id     TEXT NOT NULL,
      entity_version INTEGER NOT NULL CHECK (entity_version > 0),
      payload_json  TEXT,
      tombstone     INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
      created_at    TEXT NOT NULL,
      PRIMARY KEY (company_id, user_id, event_id)
    );
    INSERT INTO sync_events__v2
      (company_id, user_id, event_id, cursor_seq, entity_type, entity_id, entity_version,
       payload_json, tombstone, created_at)
      SELECT company_id, user_id, event_id, cursor_seq, entity_type, entity_id, entity_version,
             payload_json, tombstone, created_at
        FROM sync_events;
    DROP TABLE sync_events;
    ALTER TABLE sync_events__v2 RENAME TO sync_events;
    CREATE INDEX IF NOT EXISTS sync_events_scope_cursor_idx
      ON sync_events (company_id, user_id, cursor_seq);
  `);
}

/**
 * F9 (`user_version` 3): dnevnik i HSE u outbox-u.
 *
 * `CHECK (entity_type IN …)` se ne mijenja nadogradnjom — tabela se obnavlja u JEDNOJ transakciji
 * sa prenosom redova, isto kao u v2. Redovi sa terena (`pending`) su rad koji još nije stigao na
 * server; prekid između `DROP` i `INSERT` bio bi gubitak tog rada.
 *
 * Pet novih tipova dolazi iz `r6-diary-hse-sync`: `site_diary`, `site_diary_item`, `hse_incident`,
 * `hse_action`, `hse_training`. `sync_events` prima iste vrijednosti jer ih feed vraća.
 */
async function upgradeToV3(db: LocalSqlite): Promise<void> {
  const outboxSql = await db.getFirstAsync<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'outbox'",
  );
  if (outboxSql?.sql?.includes("'hse_incident'")) return;

  await db.execAsync(`
    CREATE TABLE outbox__v3 (
      company_id    TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      local_id      TEXT NOT NULL,
      worker_id     TEXT,
      entity_type   TEXT NOT NULL CHECK (entity_type IN (
        'workday', 'work_entry', 'machine_work_log', 'fuel_entry', 'haul',
        'machine_daily_check', 'machine_fault', 'service_order_action',
        'site_diary', 'site_diary_item', 'hse_incident', 'hse_action', 'hse_training'
      )),
      payload_json  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'failed', 'sent', 'conflict', 'rejected')),
      attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_error    TEXT,
      server_id     TEXT,
      server_version INTEGER,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      PRIMARY KEY (company_id, user_id, local_id)
    );
    INSERT INTO outbox__v3
      (company_id, user_id, local_id, worker_id, entity_type, payload_json, status, attempts,
       last_error, server_id, server_version, created_at, updated_at)
      SELECT company_id, user_id, local_id, worker_id, entity_type, payload_json, status, attempts,
             last_error, server_id, server_version, created_at, updated_at
        FROM outbox;
    DROP TABLE outbox;
    ALTER TABLE outbox__v3 RENAME TO outbox;
    CREATE INDEX IF NOT EXISTS outbox_pending_scope_idx
      ON outbox (company_id, user_id, status, created_at);
  `);
}

async function createExpoBackup(database: LocalSqlite): Promise<LocalDatabaseBackup> {
  const SQLiteRuntime = await import("expo-sqlite");
  const source = database as SQLite.SQLiteDatabase;
  const name = `gradix-pre-v${LOCAL_SCHEMA_VERSION}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.db`;
  const destination = await SQLiteRuntime.openDatabaseAsync(name);
  try {
    await SQLiteRuntime.backupDatabaseAsync({ sourceDatabase: source, destDatabase: destination });
    const integrity = await destination.getFirstAsync<{ integrity_check: string }>("PRAGMA integrity_check");
    if (integrity?.integrity_check !== "ok") throw new Error("SQLite backup integrity_check failed");
  } catch (error) {
    await destination.closeAsync().catch(() => undefined);
    await SQLiteRuntime.deleteDatabaseAsync(name).catch(() => undefined);
    throw error;
  }
  await destination.closeAsync();

  return {
    name,
    restore: async () => {
      const backupDb = await SQLiteRuntime.openDatabaseAsync(name);
      try {
        await SQLiteRuntime.backupDatabaseAsync({
          sourceDatabase: backupDb,
          destDatabase: source,
        });
      } finally {
        await backupDb.closeAsync();
      }
    },
    close: async () => undefined, // Keep the verified backup on disk for manual recovery.
  };
}

export async function migrateLocalDatabase(
  db: LocalSqlite,
  backupFactory: LocalDatabaseBackupFactory = createExpoBackup,
): Promise<{ version: number; backupName: string | null }> {
  const versionRow = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = versionRow?.user_version ?? 0;
  if (currentVersion > LOCAL_SCHEMA_VERSION) {
    throw new LocalDatabaseMigrationError(
      `Lokalna baza je novija od ove verzije aplikacije (user_version=${currentVersion}); podaci nisu mijenjani.`,
    );
  }
  if (currentVersion === LOCAL_SCHEMA_VERSION) {
    await verifyR4Schema(db).catch((cause) => {
      throw new LocalDatabaseMigrationError(
        "Lokalna baza je označena kao migrirana, ali joj nedostaje R4 struktura; podaci nisu resetovani.",
        { cause },
      );
    });
    return { version: currentVersion, backupName: null };
  }

  const tableState = await db.getFirstAsync<{ count: number }>(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  let backup: LocalDatabaseBackup | null = null;
  if ((tableState?.count ?? 0) > 0) {
    try {
      backup = await backupFactory(db);
    } catch (cause) {
      throw new LocalDatabaseMigrationError(
        "SQLite migracija je zaustavljena jer sigurnosna kopija nije uspjela; postojeći lokalni podaci nisu mijenjani.",
        { cause },
      );
    }
  }

  try {
    await db.withTransactionAsync(async () => {
      await ensureLegacySchema(db);
      await db.execAsync(R4_SCHEMA);
      await upgradeToV2(db);
      await upgradeToV3(db);
      await verifyR4Schema(db);
      await db.execAsync(`PRAGMA user_version = ${LOCAL_SCHEMA_VERSION}`);
    });
    return { version: LOCAL_SCHEMA_VERSION, backupName: backup?.name ?? null };
  } catch (cause) {
    let restored = false;
    if (backup) {
      try {
        await backup.restore();
        restored = true;
      } catch {
        restored = false;
      }
    }
    const backupText = backup?.name ? ` Kopija je sačuvana kao ${backup.name}.` : "";
    const restoreText = backup ? (restored ? " Transakcija je vraćena iz kopije." : " Automatsko vraćanje nije uspjelo; kopija je sačuvana.") : " Transakcija je poništena; baza nije imala postojeće podatke.";
    throw new LocalDatabaseMigrationError(
      `SQLite migracija nije uspjela.${backupText}${restoreText} Kod greške: LOCAL_DB_MIGRATION_FAILED.`,
      { backupName: backup?.name ?? null, restored, cause },
    );
  } finally {
    await backup?.close().catch(() => undefined);
  }
}
