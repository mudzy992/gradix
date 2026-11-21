import * as Crypto from 'expo-crypto';
import { getDb, type QueueRow } from '@/db/client';

export async function enqueue(input: {
  type: 'TIMER' | 'TRIP' | 'FUEL' | 'DIARY' | 'PHOTO';
  localId: string;
  deviceId: string;
  action?: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO queue (id, type, localId, deviceId, action, payload, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      Crypto.randomUUID(),
      input.type,
      input.localId,
      input.deviceId,
      input.action ?? null,
      JSON.stringify(input.payload),
      new Date().toISOString(),
    ],
  );
}

export async function pendingRows(): Promise<QueueRow[]> {
  const db = await getDb();
  return db.getAllAsync<QueueRow>(
    `SELECT * FROM queue WHERE status = 'pending' ORDER BY createdAt ASC`,
  );
}

export async function markSynced(id: string, serverId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE queue SET status = 'synced', serverId = ?, errorCode = NULL WHERE id = ?`, [
    serverId,
    id,
  ]);
}

export async function markError(id: string, errorCode: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE queue SET status = 'error', errorCode = ? WHERE id = ?`, [errorCode, id]);
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM queue WHERE status = 'pending'`);
  return row?.n ?? 0;
}

export async function readMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [key]);
  return row?.value ?? null;
}

export async function writeMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
}
