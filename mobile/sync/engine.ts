import { api } from '@/lib/api';
import { isOnline } from '@/sync/net';
import { markError, markSynced, pendingRows, readMeta, writeMeta } from '@/sync/queue';

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export type Catalog = {
  pulledAt: string;
  ttlHours: number;
  projects: { id: string; name: string; status: string }[];
  machines: { id: string; name: string; type: string; status: string }[];
  materials: { id: string; name: string; unit: string; isActive: boolean }[];
  depots: { id: string; name: string }[];
};

export type SyncPushResult = {
  localId: string;
  type: string;
  ok: boolean;
  serverId?: string;
  code?: string;
};

export async function pushPending(): Promise<SyncPushResult[]> {
  if (!(await isOnline())) {
    return [];
  }
  const rows = await pendingRows();
  if (rows.length === 0) {
    return [];
  }
  const data = await api<{ results: SyncPushResult[] }>('/sync/push', {
    method: 'POST',
    body: {
      items: rows.map((row) => ({
        type: row.type,
        localId: row.localId,
        deviceId: row.deviceId,
        action: row.action ?? undefined,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
      })),
    },
  });
  for (let i = 0; i < rows.length; i += 1) {
    const result = data.results[i];
    const row = rows[i];
    if (result?.ok && result.serverId) {
      await markSynced(row.id, result.serverId);
    } else if (result && !result.ok) {
      await markError(row.id, result.code ?? 'CONFLICT');
    }
  }
  return data.results;
}

export async function pullSince(): Promise<void> {
  if (!(await isOnline())) {
    return;
  }
  const since = (await readMeta('lastSyncTimestamp')) ?? new Date(0).toISOString();
  const data = await api<{ lastSyncTimestamp: string }>('/sync/pull', {
    method: 'POST',
    body: { since },
  });
  await writeMeta('lastSyncTimestamp', data.lastSyncTimestamp);
}

export async function refreshCatalog(): Promise<Catalog | null> {
  if (!(await isOnline())) {
    const cached = await readMeta('catalog');
    return cached ? (JSON.parse(cached) as Catalog) : null;
  }
  const catalog = await api<Catalog>('/sync/catalog');
  await writeMeta('catalog', JSON.stringify(catalog));
  await writeMeta('catalogPulledAt', catalog.pulledAt);
  return catalog;
}

export async function loadCatalog(): Promise<Catalog | null> {
  const cached = await readMeta('catalog');
  return cached ? (JSON.parse(cached) as Catalog) : null;
}

export async function isCatalogStale(): Promise<boolean> {
  const pulledAt = await readMeta('catalogPulledAt');
  if (!pulledAt) {
    return true;
  }
  return Date.now() - new Date(pulledAt).getTime() > CATALOG_TTL_MS;
}

export async function runSync(): Promise<void> {
  await pushPending();
  await pullSince();
  if (await isCatalogStale()) {
    await refreshCatalog();
  }
}
