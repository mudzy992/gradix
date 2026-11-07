import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = open();
  }
  return dbPromise;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('gradix.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      localId TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      action TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      serverId TEXT,
      errorCode TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export type QueueRow = {
  id: string;
  type: string;
  localId: string;
  deviceId: string;
  action: string | null;
  payload: string;
  status: string;
  serverId: string | null;
  errorCode: string | null;
  createdAt: string;
};
