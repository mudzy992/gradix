import { describe, expect, it } from "vitest";
import {
  R4_SYNC_PUSH_MAX_ITEMS,
  isOffsetDateTime,
  isR4Uuid,
  isValidCursorSequence,
  validateR4SyncPush,
  type R4WorkEntryPushItem,
} from "./r4-sync";

const uuid = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;

function entryItem(overrides: Partial<R4WorkEntryPushItem> = {}): R4WorkEntryPushItem {
  return {
    localId: uuid("1"),
    entityType: "work_entry",
    workdayId: uuid("2"),
    workEntryId: uuid("3"),
    deviceSentAt: "2026-11-07T10:00:00+01:00",
    entry: {
      kind: "WORK",
      startedAt: "2026-11-07T08:00:00+01:00",
      endedAt: "2026-11-07T09:00:00+01:00",
      endState: "KNOWN_END",
      projectId: "prj_1",
      machineId: null,
      note: null,
    },
    ...overrides,
  } as R4WorkEntryPushItem;
}

describe("R4 sync protocol validation", () => {
  it("accepts an offset-bearing work entry and a submit-header operation", () => {
    expect(validateR4SyncPush([entryItem()])).toEqual({ ok: true });
    expect(validateR4SyncPush([{
      localId: uuid("4"),
      entityType: "workday",
      workdayId: uuid("2"),
      baseVersion: 1,
      deviceSentAt: "2026-11-07T10:00:00Z",
      status: "SUBMITTED",
    }])).toEqual({ ok: true });
  });

  it("rejects empty/oversized batches and duplicate local operation IDs before writes", () => {
    expect(validateR4SyncPush([])).toEqual({ ok: false, code: "SYNC_BATCH_TOO_LARGE" });
    const tooMany = Array.from({ length: R4_SYNC_PUSH_MAX_ITEMS + 1 }, (_, index) =>
      entryItem({ localId: uuid(String(index + 10)) }),
    );
    expect(validateR4SyncPush(tooMany)).toEqual({ ok: false, code: "SYNC_BATCH_TOO_LARGE" });
    expect(validateR4SyncPush([entryItem(), entryItem()])).toEqual({ ok: false, code: "SYNC_LOCAL_ID_INVALID" });
  });

  it("requires explicit timezone offsets and rejects invalid/ambiguous end states", () => {
    expect(isOffsetDateTime("2026-11-07T08:00:00+01:00")).toBe(true);
    expect(isOffsetDateTime("2026-11-07T08:00:00Z")).toBe(true);
    expect(isOffsetDateTime("2024-02-29T23:59:59-05:00")).toBe(true);
    expect(isOffsetDateTime("2026-02-30T09:00:00Z")).toBe(false);
    expect(isOffsetDateTime("2026-11-07T24:00:00Z")).toBe(false);
    expect(isOffsetDateTime("2026-11-07T09:00:00+25:00")).toBe(false);
    expect(isOffsetDateTime("2026-11-07T08:00:00")).toBe(false);
    expect(validateR4SyncPush([entryItem({
      entry: { ...entryItem().entry, startedAt: "2026-11-07T08:00:00" },
    })])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
    expect(validateR4SyncPush([entryItem({
      entry: { ...entryItem().entry, endedAt: null },
    })])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
  });

  it("supports an optional group target ID, which still requires server-side R3 authorization", () => {
    expect(validateR4SyncPush([entryItem({ workerId: "wrk_group_1" })])).toEqual({ ok: true });
    expect(validateR4SyncPush([entryItem({ workerId: "" })])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
    expect(validateR4SyncPush([entryItem({ workerId: "x".repeat(129) })])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
  });

  it("accepts R5.1 machine_work_log push items", () => {
    expect(validateR4SyncPush([{
      localId: uuid("80"),
      entityType: "machine_work_log",
      workLogId: "mwl_test_01",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      log: {
        machineId: "mch_1",
        projectId: null,
        startedAt: "2026-11-19T08:00:00+01:00",
        endedAt: "2026-11-19T09:00:00+01:00",
        mode: "WORK",
        meterEnd: 120.5,
        note: null,
      },
    }])).toEqual({ ok: true });
    expect(validateR4SyncPush([{
      localId: uuid("81"),
      entityType: "machine_work_log",
      workLogId: "mwl_test_02",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      log: {
        machineId: "mch_1",
        projectId: null,
        startedAt: "2026-11-19T09:00:00+01:00",
        endedAt: "2026-11-19T08:00:00+01:00",
        mode: "WORK",
        meterEnd: null,
        note: null,
      },
    }])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
  });

  it("accepts R5.2 fuel_entry push items", () => {
    expect(validateR4SyncPush([{
      localId: uuid("82"),
      entityType: "fuel_entry",
      fuelEntryId: "fuel_test_01",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      entry: {
        machineId: "mch_1",
        projectId: null,
        filledAt: "2026-11-19T08:00:00+01:00",
        liters: 45.5,
        totalAmount: "95.50",
        currencyCode: "BAM",
        unitPriceAmount: null,
        meterReading: null,
        note: null,
      },
    }])).toEqual({ ok: true });
  });

  it("accepts R5.3 haul push items", () => {
    expect(validateR4SyncPush([{
      localId: uuid("83"),
      entityType: "haul",
      haulId: "haul_test_01",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      haul: {
        machineId: "mch_1",
        projectId: null,
        segmentId: null,
        hauledAt: "2026-11-19T08:00:00+01:00",
        originText: "Depo",
        destinationText: "Gradilište",
        materialText: "Šljunak",
        quantity: 12.5,
        quantityUnit: "M3",
        scaleTicketText: null,
        tripCount: 2,
        note: null,
      },
    }])).toEqual({ ok: true });
    expect(validateR4SyncPush([{
      localId: uuid("84"),
      entityType: "haul",
      haulId: "haul_bad",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      haul: {
        machineId: "mch_1",
        projectId: null,
        segmentId: null,
        hauledAt: "2026-11-19T08:00:00+01:00",
        originText: "Depo",
        destinationText: "Gradilište",
        materialText: "Šljunak",
        quantity: 0,
        quantityUnit: "M3",
        scaleTicketText: null,
        tripCount: 1,
        note: null,
      },
    }])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
  });

  it("accepts R5.4 machine_daily_check push items", () => {
    expect(validateR4SyncPush([{
      localId: uuid("85"),
      entityType: "machine_daily_check",
      checkId: "mdc_test_01",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      check: {
        machineId: "mch_1",
        projectId: null,
        checkedAt: "2026-11-19T07:00:00+01:00",
        result: "PASS",
        checklistJson: {},
        note: null,
      },
    }])).toEqual({ ok: true });
    expect(validateR4SyncPush([{
      localId: uuid("86"),
      entityType: "machine_daily_check",
      checkId: "mdc_bad",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      check: {
        machineId: "mch_1",
        projectId: null,
        checkedAt: "2026-11-19T07:00:00+01:00",
        result: "MAYBE" as "PASS",
        checklistJson: {},
        note: null,
      },
    }])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
  });

  it("accepts R5.5 machine_fault push items", () => {
    expect(validateR4SyncPush([{
      localId: uuid("87"),
      entityType: "machine_fault",
      faultId: "mf_test_01",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      fault: {
        machineId: "mch_1",
        projectId: null,
        partnerId: null,
        reportedAt: "2026-11-19T08:00:00+01:00",
        title: "Curenje",
        description: null,
        priority: "MEDIUM",
        estimatedCostAmount: "100.00",
        currencyCode: "BAM",
        downtimeMinutes: null,
      },
    }])).toEqual({ ok: true });
    expect(validateR4SyncPush([{
      localId: uuid("88"),
      entityType: "machine_fault",
      faultId: "mf_bad",
      deviceSentAt: "2026-11-19T10:00:00+01:00",
      fault: {
        machineId: "mch_1",
        projectId: null,
        partnerId: null,
        reportedAt: "2026-11-19T08:00:00+01:00",
        title: "Curenje",
        description: null,
        priority: "MEDIUM",
        estimatedCostAmount: "100.00",
        currencyCode: null,
        downtimeMinutes: null,
      },
    }])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
  });

  it("enforces WORK/BREAK target rules and version constraints", () => {
    expect(validateR4SyncPush([entryItem({
      entry: { ...entryItem().entry, kind: "BREAK", projectId: null, machineId: null },
    })])).toEqual({ ok: true });
    expect(validateR4SyncPush([entryItem({
      entry: { ...entryItem().entry, kind: "BREAK", projectId: "prj_1" },
    })])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
    expect(validateR4SyncPush([entryItem({ baseVersion: 0 })])).toEqual({ ok: false, code: "SYNC_ITEM_INVALID" });
    expect(isR4Uuid("not-a-uuid")).toBe(false);
  });

  it("parses only decimal int8 cursors and rejects values above PostgreSQL BIGINT", () => {
    expect(isValidCursorSequence("0")).toBe(true);
    expect(isValidCursorSequence("9007199254740993")).toBe(true);
    expect(isValidCursorSequence("9223372036854775807")).toBe(true);
    expect(isValidCursorSequence("9223372036854775808")).toBe(false);
    expect(isValidCursorSequence("-1")).toBe(false);
    expect(isValidCursorSequence("01")).toBe(false);
  });
});
