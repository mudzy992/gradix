import { describe, expect, it } from "vitest";
import type {
  R4SyncEvent,
  R4SyncPullPage,
  R4SyncPushItem,
  R4SyncPushItemResult,
  R4SyncPushResponse,
  R4WorkEntryPushItem,
} from "@gradix/domain";
import { businessDate } from "@gradix/domain";
import { chunkR4, runR4Sync, type R4SyncStore, type R4SyncTransport } from "./r4-engine";
import { sendResultMessage } from "../teren/outcome";

const uuid = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function item(local: number): R4WorkEntryPushItem {
  return {
    localId: uuid(String(local)),
    entityType: "work_entry",
    workdayId: uuid("100"),
    workEntryId: uuid(String(1000 + local)),
    deviceSentAt: "2026-11-07T09:01:00+01:00",
    entry: {
      kind: "WORK",
      startedAt: "2026-11-07T08:00:00+01:00",
      endedAt: "2026-11-07T09:00:00+01:00",
      endState: "KNOWN_END",
      projectId: "prj_simulator",
      machineId: null,
      note: `simulated ${local}`,
    },
  };
}

type Slot = { seq: number; status: "PENDING" | "COMMITTED" | "SKIPPED"; event: R4SyncEvent | null };

/** Deterministic, in-memory model of idempotent push and the DB cursor's pending-slot frontier. */
class SimulatedNetwork implements R4SyncTransport {
  private nextSeq = 1;
  private slots = new Map<number, Slot>();
  private receipts = new Map<string, { hash: string; result: R4SyncPushItemResult }>();
  private canonicalWorkdays = new Map<string, string>();
  private failAfterCommitLocalId: string | null = null;

  failResponseAfterCommit(localId: string) {
    this.failAfterCommitLocalId = localId;
  }

  reserve(): Slot {
    const slot: Slot = { seq: this.nextSeq++, status: "PENDING", event: null };
    this.slots.set(slot.seq, slot);
    return slot;
  }

  publish(slot: Slot, entityId: string, payload: Record<string, unknown>, entityType: R4SyncEvent["entityType"] = "work_entry") {
    slot.status = "COMMITTED";
    slot.event = {
      id: `evt-${slot.seq}`,
      cursorSeq: String(slot.seq),
      entityType,
      entityId,
      entityVersion: 1,
      payload,
      tombstone: false,
      createdAt: "2026-11-07T10:00:00.000Z",
    };
  }

  async push(items: readonly R4SyncPushItem[]): Promise<R4SyncPushResponse> {
    const results: R4SyncPushItemResult[] = [];
    for (const pushed of items) {
      const hash = canonical(pushed);
      const existing = this.receipts.get(pushed.localId);
      if (existing) {
        if (existing.hash !== hash) {
          results.push({ localId: pushed.localId, status: "REJECTED", entityId: null, version: null, cursor: null, code: "SYNC_LOCAL_ID_REUSED" });
        } else {
          results.push({ ...existing.result, status: "DUPLICATE" });
        }
        continue;
      }
      const workdaySlot = pushed.entityType === "work_entry" ? this.reserve() : null;
      const slot = this.reserve();
      const workDate = pushed.entityType === "work_entry"
        ? businessDate(new Date(pushed.entry.startedAt), "Europe/Sarajevo")
        : null;
      const canonicalWorkdayId = workDate
        ? this.canonicalWorkdays.get(workDate) ?? pushed.workdayId
        : pushed.workdayId;
      const entityId = pushed.entityType === "work_entry" ? pushed.workEntryId : pushed.workdayId;
      const result: R4SyncPushItemResult = {
        localId: pushed.localId,
        status: "APPLIED",
        entityId,
        version: 1,
        cursor: String(slot.seq),
        ...(workDate ? { canonicalWorkdayId } : {}),
      };
      if (pushed.entityType === "work_entry" && workdaySlot && workDate) {
        if (this.canonicalWorkdays.has(workDate)) {
          workdaySlot.status = "SKIPPED";
        } else {
          this.canonicalWorkdays.set(workDate, canonicalWorkdayId);
          this.publish(workdaySlot, canonicalWorkdayId, {
            id: canonicalWorkdayId,
            workerId: "worker_simulator",
            workDate,
            status: "DRAFT",
          }, "workday");
        }
      }
      this.publish(slot, entityId, {
        localId: pushed.localId,
        entityType: pushed.entityType,
        ...(workDate ? { workdayId: canonicalWorkdayId } : {}),
      });
      this.receipts.set(pushed.localId, { hash, result });
      results.push(result);
      if (this.failAfterCommitLocalId === pushed.localId) {
        this.failAfterCommitLocalId = null;
        throw Object.assign(new Error("simulated response loss"), { code: "NETWORK_ERROR" });
      }
    }
    return { results };
  }

  async pull(cursor: string, limit: number): Promise<R4SyncPullPage> {
    const after = Number(cursor);
    const head = this.nextSeq - 1;
    const floor = 0;
    if (!Number.isInteger(after) || after < floor) throw Object.assign(new Error("expired"), { code: "SYNC_CURSOR_EXPIRED" });
    if (after > head) throw Object.assign(new Error("invalid"), { code: "SYNC_CURSOR_INVALID" });
    const firstPending = [...this.slots.values()]
      .filter((slot) => slot.status === "PENDING")
      .map((slot) => slot.seq)
      .sort((a, b) => a - b)[0];
    if (firstPending !== undefined && firstPending <= after) throw Object.assign(new Error("crosses pending"), { code: "SYNC_CURSOR_INVALID" });
    const safeFrontier = Math.max(after, firstPending === undefined ? head : Math.min(head, firstPending - 1));
    const available = [...this.slots.values()]
      .filter((slot) => slot.status === "COMMITTED" && slot.seq > after && slot.seq <= safeFrontier && slot.event)
      .sort((a, b) => a.seq - b.seq);
    const hasExtra = available.length > limit;
    const selected = available.slice(0, limit).map((slot) => slot.event!);
    const next = hasExtra ? Number(selected.at(-1)?.cursorSeq ?? after) : safeFrontier;
    return {
      events: selected,
      cursor: String(next),
      cursorFloor: String(floor),
      hasMore: hasExtra || safeFrontier < head,
    };
  }
}

function memoryStore(initial: readonly R4SyncPushItem[] = []): R4SyncStore & {
  pendingItems: R4SyncPushItem[];
  cursor: string;
  applied: R4SyncEvent[];
  retries: string[];
  failNextApply: boolean;
} {
  const state = {
    pendingItems: [...initial],
    cursor: "0",
    applied: [] as R4SyncEvent[],
    retries: [] as string[],
    failNextApply: false,
    pending: async () => state.pendingItems,
    markResult: async (result: R4SyncPushItemResult) => {
      state.pendingItems = state.pendingItems.filter((entry) => entry.localId !== result.localId);
    },
    markRetry: async (localId: string, code: string) => {
      state.retries.push(`${localId}:${code}`);
    },
    readCursor: async () => state.cursor,
    applyPullPage: async (page: R4SyncPullPage) => {
      if (state.failNextApply) {
        state.failNextApply = false;
        throw Object.assign(new Error("simulated SQLite transaction failure"), { code: "SYNC_STORAGE_COMMIT_FAILED" });
      }
      const seen = new Set(state.applied.map((event) => event.id));
      const next = [...state.applied];
      for (const event of page.events) if (!seen.has(event.id)) next.push(event);
      // The two persistent values are changed together, matching the future SQLite transaction.
      state.applied = next;
      state.cursor = page.cursor;
    },
  };
  return state;
}

describe("R4 deterministic sync simulator", () => {
  it("splits outbox into protocol-sized batches", () => {
    expect(chunkR4(Array.from({ length: 245 }, (_, index) => item(index + 1))).map((batch) => batch.length))
      .toEqual([100, 100, 45]);
    expect(() => chunkR4([item(1)], 101)).toThrow(RangeError);
  });

  it("lost response after server commit retries idempotently without duplicating a segment", async () => {
    const queued = item(1);
    const server = new SimulatedNetwork();
    const store = memoryStore([queued]);
    server.failResponseAfterCommit(queued.localId);

    const first = await runR4Sync(store, server);
    expect(first.error).toBe("NETWORK_ERROR");
    expect(store.pendingItems).toHaveLength(1);

    const second = await runR4Sync(store, server);
    expect(second.duplicate).toBe(1);
    expect(second.applied).toBe(0);
    expect(store.pendingItems).toHaveLength(0);
    const page = await server.pull("0", 200);
    expect(page.events).toHaveLength(2);
    expect(page.events.map((event) => event.entityType)).toEqual(["workday", "work_entry"]);
    expect(page.events[0]?.id).toBe("evt-1");
  });

  it("rejects a new payload that reuses another operation's stable localId", async () => {
    const server = new SimulatedNetwork();
    const original = item(7);
    await server.push([original]);
    const reused: R4WorkEntryPushItem = {
      ...original,
      entry: { ...original.entry, note: "different immutable content" },
    };
    const response = await server.push([reused]);
    expect(response.results[0]).toMatchObject({
      localId: original.localId,
      status: "REJECTED",
      code: "SYNC_LOCAL_ID_REUSED",
    });
    expect((await server.pull("0", 200)).events).toHaveLength(2);
  });

  it("canonicalizes two client workday IDs for the same worker/date and publishes one day", async () => {
    const server = new SimulatedNetwork();
    const first = item(11);
    const second = { ...item(12), workdayId: uuid("200") };
    const [firstResult] = (await server.push([first])).results;
    const [secondResult] = (await server.push([second])).results;

    expect(firstResult?.canonicalWorkdayId).toBe(first.workdayId);
    expect(secondResult?.canonicalWorkdayId).toBe(first.workdayId);
    const page = await server.pull("0", 200);
    expect(page.events.filter((event) => event.entityType === "workday")).toHaveLength(1);
    expect(page.events.filter((event) => event.entityType === "work_entry")).toHaveLength(2);
    expect(page.cursor).toBe("4");
  });

  it("never advances across a lower PENDING cursor slot and later deduplicates the replay", async () => {
    const server = new SimulatedNetwork();
    const low = server.reserve();
    const high = server.reserve();
    server.publish(high, "entry-high", { label: "committed second" });
    const store = memoryStore();

    const blocked = await runR4Sync(store, server);
    expect(blocked.error).toBeNull();
    expect(blocked.cursorBlockedByPendingSlot).toBe(true);
    expect(blocked.cursor).toBe("0");
    expect(store.applied).toHaveLength(0);

    server.publish(low, "entry-low", { label: "committed first" });
    const complete = await runR4Sync(store, server);
    expect(complete.cursor).toBe("2");
    expect(complete.pulledEvents).toBe(2);
    expect(store.applied.map((event) => event.cursorSeq)).toEqual(["1", "2"]);
  });

  it("REGRESIJA telefon 2026-11-07: pull padne (serverski 500) poslije uspješnog pusha — push ishod ostaje, poruka ne laže", async () => {
    // Na stagingu je pull pucao u bazi (cursor_floor), a aplikacija je to prikazala kao
    // "Nema veze sa serverom" iako je push prošao. Motor mora sačuvati push rezultate,
    // a poruka korisniku mora reći da je poslano, uz napomenu da potvrda nije stigla.
    const server = new SimulatedNetwork();
    const store = memoryStore([item(21)]);
    const brokenPull: R4SyncTransport = {
      push: (items) => server.push(items),
      pull: async () => {
        throw Object.assign(new Error('column reference "cursor_floor" is ambiguous'), { code: "SYNC_PULL_RESPONSE_INVALID" });
      },
    };
    const outcome = await runR4Sync(store, brokenPull);
    expect(outcome.applied).toBe(1);
    expect(outcome.error).toBe("SYNC_PULL_RESPONSE_INVALID");
    expect(store.pendingItems).toHaveLength(0);
    const message = sendResultMessage(outcome);
    expect(message).toContain("poslano 1");
    expect(message).not.toContain("Nema veze sa serverom");
  });

  it("rolls back a failed local pull-page transaction and applies the whole page on retry", async () => {
    const server = new SimulatedNetwork();
    const first = server.reserve();
    const second = server.reserve();
    server.publish(first, "entry-1", { label: "one" });
    server.publish(second, "entry-2", { label: "two" });
    const store = memoryStore();
    store.failNextApply = true;

    const failed = await runR4Sync(store, server);
    expect(failed.error).toBe("SYNC_STORAGE_COMMIT_FAILED");
    expect(store.cursor).toBe("0");
    expect(store.applied).toHaveLength(0);

    const retried = await runR4Sync(store, server);
    expect(retried.error).toBeNull();
    expect(store.cursor).toBe("2");
    expect(store.applied).toHaveLength(2);
    expect(new Set(store.applied.map((event) => event.id)).size).toBe(2);
  });
});
