/**
 * Sync engine — čista logika, bez React-a i bez expo modula, pa se testira u Node-u.
 *
 * Pravila su ista kao na serveru (packages/domain/src/sync.ts):
 *  - batch se reže na SYNC_PUSH_MAX_ITEMS
 *  - ponovljeni push istog localId vraća isti serverId (nije greška)
 *  - greška jednog zapisa ne obara ostale
 *  - watermark se pomjera samo na osnovu odgovora servera
 *
 * Ovo je spike iz Faze 1: dokazuje da offline zapis preživi prekid mreže i da se
 * ponovno slanje ne duplira. R4 dodaje konflikte po entitetu.
 */
import { SYNC_PUSH_MAX_ITEMS } from "@gradix/domain";

export type QueueRow = {
  localId: string;
  text: string;
  clientAt: string;
  attempts: number;
};

export type PushResult = {
  localId: string;
  serverId: string;
  duplicate: boolean;
};

export type Transport = {
  push: (
    items: { localId: string; entityType: "note"; payload: Record<string, unknown>; clientAt: string }[],
  ) => Promise<{ results: PushResult[] }>;
  pull: (since: string) => Promise<{ items: unknown[]; lastSyncTimestamp: string }>;
};

export type QueueStore = {
  pending: () => Promise<QueueRow[]>;
  markSent: (localId: string, serverId: string) => Promise<void>;
  markFailed: (localId: string) => Promise<void>;
  readWatermark: () => Promise<string>;
  writeWatermark: (value: string) => Promise<void>;
};

export type SyncOutcome = {
  sent: number;
  failed: number;
  duplicate: number;
  watermark: string;
  error: string | null;
};

/** Dijeli red u batcheve; red se NIKAD ne šalje cijeli ako je veći od limita. */
export function chunk<T>(rows: readonly T[], size = SYNC_PUSH_MAX_ITEMS): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

export async function runSync(store: QueueStore, transport: Transport): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { sent: 0, failed: 0, duplicate: 0, watermark: "", error: null };

  try {
    const rows = await store.pending();
    for (const batch of chunk(rows)) {
      const response = await transport.push(
        batch.map((row) => ({
          localId: row.localId,
          entityType: "note" as const,
          payload: { text: row.text },
          clientAt: row.clientAt,
        })),
      );
      const byLocalId = new Map(response.results.map((result) => [result.localId, result]));
      for (const row of batch) {
        const result = byLocalId.get(row.localId);
        if (result) {
          await store.markSent(row.localId, result.serverId);
          outcome.sent += 1;
          if (result.duplicate) outcome.duplicate += 1;
        } else {
          await store.markFailed(row.localId);
          outcome.failed += 1;
        }
      }
    }

    const since = await store.readWatermark();
    const pulled = await transport.pull(since);
    if (pulled.lastSyncTimestamp) {
      await store.writeWatermark(pulled.lastSyncTimestamp);
      outcome.watermark = pulled.lastSyncTimestamp;
    }
  } catch (error) {
    // Mreža je pala: zapisi ostaju u redu, ništa se ne gubi i ništa se ne duplira.
    outcome.error = error instanceof Error ? error.message : "Nepoznata greška";
  }

  return outcome;
}
