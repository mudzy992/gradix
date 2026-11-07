import { describe, expect, it } from "vitest";
import { chunk, runSync, type QueueRow, type QueueStore, type Transport } from "./engine";

/** In-memory store: isti ugovor kao SQLite, ali bez uređaja. */
function memoryStore(rows: QueueRow[]): QueueStore & { rows: QueueRow[]; watermark: string } {
  const state = {
    rows,
    watermark: "1970-01-01T00:00:00.000Z",
    pending: async () => state.rows.filter((row) => row.attempts === 0),
    markSent: async (localId: string, serverId: string) => {
      state.rows = state.rows.filter((row) => row.localId !== localId || serverId === "");
    },
    markFailed: async (localId: string) => {
      state.rows = state.rows.map((row) =>
        row.localId === localId ? { ...row, attempts: row.attempts + 1 } : row,
      );
    },
    readWatermark: async () => state.watermark,
    writeWatermark: async (value: string) => {
      state.watermark = value;
    },
  };
  return state;
}

function transport(options: { failFirst?: boolean } = {}): Transport & { pushes: number } {
  let calls = 0;
  const api = {
    pushes: 0,
    push: async (items: { localId: string }[]) => {
      calls += 1;
      api.pushes += 1;
      if (options.failFirst && calls === 1) throw new Error("NETWORK_ERROR");
      return {
        results: items.map((item) => ({
          localId: item.localId,
          serverId: `srv-${item.localId}`,
          duplicate: false,
        })),
      };
    },
    pull: async () => ({ items: [], lastSyncTimestamp: "2026-11-07T10:00:00.000Z" }),
  };
  return api;
}

const row = (localId: string): QueueRow => ({
  localId,
  text: "Iskop kanala",
  clientAt: "2026-11-07T09:00:00.000Z",
  attempts: 0,
});

describe("offline sync engine", () => {
  it("reže red na batcheve od 200", () => {
    const rows = Array.from({ length: 450 }, (_, index) => row(`l-${index}`));
    expect(chunk(rows).map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(chunk([]).length).toBe(0);
  });

  it("šalje zapise i pomjera watermark", async () => {
    const store = memoryStore([row("l-1"), row("l-2")]);
    const outcome = await runSync(store, transport());
    expect(outcome.sent).toBe(2);
    expect(outcome.failed).toBe(0);
    expect(outcome.error).toBeNull();
    expect(outcome.watermark).toBe("2026-11-07T10:00:00.000Z");
    expect(store.rows.length).toBe(0);
  });

  it("prekid mreže ne gubi zapise i ne duplira ih pri ponovnom slanju", async () => {
    const store = memoryStore([row("l-1")]);
    const flaky = transport({ failFirst: true });

    const first = await runSync(store, flaky);
    expect(first.sent).toBe(0);
    expect(first.error).toBe("NETWORK_ERROR");
    expect(store.rows.length).toBe(1);

    const second = await runSync(store, flaky);
    expect(second.sent).toBe(1);
    expect(second.duplicate).toBe(0);
    expect(flaky.pushes).toBe(2);
  });

  it("zapis koji server ne potvrdi ide u failed, ali se ne gubi", async () => {
    const store = memoryStore([row("l-1")]);
    const partial: Transport = {
      push: async () => ({ results: [] }),
      pull: async () => ({ items: [], lastSyncTimestamp: "" }),
    };
    const outcome = await runSync(store, partial);
    expect(outcome.failed).toBe(1);
    expect(store.rows[0]?.attempts).toBe(1);
  });

  it("zapis poslan u prethodnom pokušaju se ne šalje dvaput", async () => {
    const first = memoryStore([row("l-1"), row("l-2")]);
    await runSync(first, transport());
    // Store sada ima samo neposlane; novi sync ne šalje ništa.
    const second = await runSync(first, transport());
    expect(second.sent).toBe(0);
  });
});
