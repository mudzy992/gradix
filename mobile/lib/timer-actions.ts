import * as Crypto from 'expo-crypto';
import { api } from '@/lib/api';
import { readOrCreateDeviceId } from '@/lib/secure';
import { enqueue } from '@/sync/queue';
import { isOnline } from '@/sync/net';
import { runSync } from '@/sync/engine';

export async function startTimer(taskId: string, machineId?: string): Promise<void> {
  const online = await isOnline();
  if (online) {
    await api('/timer/start', { method: 'POST', body: { taskId, machineId } });
    return;
  }
  await enqueue({
    type: 'TIMER',
    localId: Crypto.randomUUID(),
    deviceId: await readOrCreateDeviceId(),
    action: 'start',
    payload: { taskId, machineId, startedAt: new Date().toISOString() },
  });
}

export async function flushSync(): Promise<void> {
  await runSync();
}
