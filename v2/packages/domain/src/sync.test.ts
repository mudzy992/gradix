import { describe, expect, it } from "vitest";
import {
  MAX_CLOCK_SKEW_SECONDS,
  SYNC_PUSH_MAX_ITEMS,
  isSinceValid,
  nextWatermark,
  validatePushBatch,
  type SyncPushItem,
} from "./sync";

const now = new Date("2026-11-07T12:00:00Z");

function item(overrides: Partial<SyncPushItem> = {}): SyncPushItem {
  return {
    localId: "local-1",
    entityType: "note",
    payload: { text: "Iskop kanala, dionica 2" },
    clientAt: new Date(now.getTime() - 60_000),
    ...overrides,
  };
}

describe("sync push", () => {
  it("prihvata normalan batch", () => {
    expect(validatePushBatch([item(), item({ localId: "local-2" })], now)).toEqual({ ok: true });
  });

  it("prazan batch i prevelik batch su greška", () => {
    expect(validatePushBatch([], now)).toEqual({ ok: false, code: "SYNC_BATCH_TOO_LARGE" });
    const tooMany = Array.from({ length: SYNC_PUSH_MAX_ITEMS + 1 }, (_, i) =>
      item({ localId: `local-${i}` }),
    );
    expect(validatePushBatch(tooMany, now)).toEqual({ ok: false, code: "SYNC_BATCH_TOO_LARGE" });
  });

  it("duplikat localId u istom batch-u je greška, ne tiha deduplikacija", () => {
    expect(validatePushBatch([item(), item()], now)).toEqual({
      ok: false,
      code: "SYNC_LOCAL_ID_INVALID",
    });
  });

  it("nepoznat tip entiteta se odbija", () => {
    expect(
      validatePushBatch([{ ...item(), entityType: "invoice" as never }], now),
    ).toEqual({ ok: false, code: "SYNC_ENTITY_TYPE_UNKNOWN" });
  });

  it("vrijeme uređaja previše u budućnosti se odbija", () => {
    const future = new Date(now.getTime() + (MAX_CLOCK_SKEW_SECONDS + 1) * 1000);
    expect(validatePushBatch([item({ clientAt: future })], now)).toEqual({
      ok: false,
      code: "SYNC_CLIENT_AT_INVALID",
    });
  });

  it("neispravan localId se odbija", () => {
    expect(validatePushBatch([item({ localId: "" })], now)).toEqual({
      ok: false,
      code: "SYNC_LOCAL_ID_INVALID",
    });
  });
});

describe("sync pull watermark", () => {
  it("watermark je najmanji serverAt vraćenih redova (red na granici dolazi ponovo)", () => {
    const since = new Date("2026-11-07T10:00:00Z");
    const rows = [
      { serverAt: new Date("2026-11-07T10:05:00Z") },
      { serverAt: new Date("2026-11-07T10:01:00Z") },
      { serverAt: new Date("2026-11-07T10:09:00Z") },
    ];
    expect(nextWatermark(rows, since).toISOString()).toBe("2026-11-07T10:01:00.000Z");
  });

  it("bez novih redova watermark se ne pomjera", () => {
    const since = new Date("2026-11-07T10:00:00Z");
    expect(nextWatermark([], since).toISOString()).toBe(since.toISOString());
  });

  it("since u budućnosti je greška, ne prazan rezultat", () => {
    expect(isSinceValid(new Date("2027-01-01T00:00:00Z"), now)).toBe(false);
    expect(isSinceValid(new Date("2026-11-07T11:00:00Z"), now)).toBe(true);
    expect(isSinceValid(new Date("nepostojeci"), now)).toBe(false);
  });
});
