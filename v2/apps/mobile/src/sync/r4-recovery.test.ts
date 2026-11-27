import { describe, expect, it } from "vitest";
import type { R4SyncPushItem, R4SyncPushItemResult } from "@gradix/domain";
import { activateLocalAccount, createSqliteR4SyncStore, pendingOutboxCount, queueHseAction, queueHseIncident,
  queueSiteDiary, queueSiteDiaryItem, readLegacyDiaryItems, recoverLegacyDiaryItem } from "../db/r4-outbox";
import { migrateLocalDatabase } from "../db/migrations";
import { createNodeSqlite, openNodeSqlite } from "../test/node-sqlite";
import { runR4Sync, type R4SyncTransport } from "./r4-engine";

const account = { companyId: "c1", userId: "u1" };
const other = { companyId: "c1", userId: "u2" };
const day = "2026-11-23";
const stamp = `${day}T10:00:00Z`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const result = (item: R4SyncPushItem, status: R4SyncPushItemResult["status"]): R4SyncPushItemResult => ({
  localId: item.localId, status, entityId: status === "REJECTED" ? null : "server", version: 1, cursor: "1",
  ...(status === "REJECTED" ? { code: "SYNC_ITEM_REJECTED" } : {}),
});
const pull: R4SyncTransport["pull"] = async () => ({ cursor: "", cursorFloor: "", hasMore: false, events: [] });

async function setup() {
  const db = createNodeSqlite(); await migrateLocalDatabase(db); await activateLocalAccount(db, account); return db;
}
async function diary(db: Awaited<ReturnType<typeof setup>>) {
  return queueSiteDiary(db, account, { diaryId: "diary", baseVersion: 1, diary: {
    projectId: "p1", diaryDate: day, weather: null, temperatureC: null, workedHours: null,
    description: "Temelj", visitors: null, events: null, delays: [], signedName: null,
  } }, stamp, () => id(2));
}
async function quantity(db: Awaited<ReturnType<typeof setup>>) {
  return queueSiteDiaryItem(db, account, { diaryItemId: "item", diaryProjectId: "p1", diaryDate: day,
    item: { boqItemId: null, description: "Iskop", unit: "m3", quantity: "5", source: "MANUAL" } }, stamp, () => id(1));
}

describe("F9 oporavak i zavisnosti", () => {
  it("nakon izgubljenog odgovora i ponovnog otvaranja prvo sigurno ponavlja roditelja pa stavku", async () => {
    let db = await setup();
    const child = await quantity(db); const parent = await diary(db);
    const calls: string[][] = [];
    const first = await runR4Sync(createSqliteR4SyncStore(db, account), { pull, push: async (items) => {
      calls.push(items.map((x) => x.localId)); throw new Error("response lost after server commit");
    } });
    expect(first.retry).toBe(1); expect(calls).toEqual([[parent.localId]]);
    const path = db.path; db.close(); db = openNodeSqlite(path);
    const second = await runR4Sync(createSqliteR4SyncStore(db, account), { pull, push: async (items) => {
      calls.push(items.map((x) => x.localId)); return { results: items.map((x) => result(x, x.localId === parent.localId ? "DUPLICATE" : "APPLIED")) };
    } });
    expect(second).toMatchObject({ duplicate: 1, applied: 1, error: null });
    expect(calls).toEqual([[parent.localId], [parent.localId], [child.localId]]); db.close();
  });

  it("odbijen dnevnik i incident blokiraju količinu i mjeru i poslije novog pokretanja", async () => {
    const db = await setup(); const child = await quantity(db); const parent = await diary(db);
    const incident = await queueHseIncident(db, account, { incidentId: "incident", incident: {
      kind: "NEAR_MISS", severity: "MINOR", occurredAt: stamp, projectId: null, locationText: null, lat: null, lng: null,
      description: "Opasnost", immediateAction: null, injuredWorkerId: null, lostDays: 0, reportableToAuthority: false, photos: [], updateBody: null,
    } }, stamp, () => id(3));
    const action = await queueHseAction(db, account, { actionId: "action", action: { incidentId: "incident", inspectionId: null,
      description: "Popraviti", responsibleWorkerId: "w", dueOn: day } }, stamp, () => id(4));
    const seen: string[] = [];
    const transport: R4SyncTransport = { pull, push: async (items) => { seen.push(...items.map((i) => i.localId));
      return { results: items.map((i) => result(i, "REJECTED")) }; } };
    await runR4Sync(createSqliteR4SyncStore(db, account), transport);
    await runR4Sync(createSqliteR4SyncStore(db, account), transport);
    expect(seen).toEqual([parent.localId, incident.localId]);
    expect(await db.getFirstAsync<{ status: string }>("SELECT status FROM outbox WHERE local_id = ?", [child.localId])).toEqual({ status: "pending" });
    expect(await db.getFirstAsync<{ status: string }>("SELECT status FROM outbox WHERE local_id = ?", [action.localId])).toEqual({ status: "pending" });
    db.close();
  });

  it("potpis ne zaobilazi nepotvrđenu ili odbijenu stavku istog dana", async () => {
    const db = await setup(); const child = await quantity(db);
    const signed = await queueSiteDiary(db, account, { diaryId: "diary", baseVersion: 1, diary: {
      projectId: "p1", diaryDate: day, weather: null, temperatureC: null, workedHours: null,
      description: null, visitors: null, events: null, delays: [], signedName: "Šef Gradilišta",
      signature: { signedAt: stamp, autoSnapshotJson: "{}" },
    } }, stamp, () => id(7));
    const seen: string[] = [];
    await runR4Sync(createSqliteR4SyncStore(db, account), { pull, push: async (items) => {
      seen.push(...items.map((i) => i.localId)); return { results: items.map((i) => result(i, "REJECTED")) };
    } });
    expect(seen).toEqual([child.localId]);
    expect(await db.getFirstAsync<{ status: string }>("SELECT status FROM outbox WHERE local_id = ?", [signed.localId])).toEqual({ status: "pending" });
    db.close();
  });

  it("stari odbijeni red zadržava original, traži eksplicitan poslovni ključ i novi ID samo jednom", async () => {
    const db = await setup(); const original = await quantity(db);
    const old = { ...original } as R4SyncPushItem & { diaryProjectId?: string; diaryDate?: string };
    delete old.diaryProjectId; delete old.diaryDate;
    await db.runAsync("UPDATE outbox SET payload_json = ?, status = 'rejected', last_error = 'DIARY_REFERENCE_REQUIRED' WHERE local_id = ?", [JSON.stringify(old), original.localId]);
    expect(await readLegacyDiaryItems(db, account)).toMatchObject([{ localId: original.localId, description: "Iskop", quantity: "5" }]);
    await expect(recoverLegacyDiaryItem(db, account, original.localId, "p1", "2026-02-30", () => id(5))).rejects.toThrow();
    await activateLocalAccount(db, other);
    await expect(recoverLegacyDiaryItem(db, account, original.localId, "p1", day, () => id(5))).rejects.toMatchObject({ code: "LOCAL_ACCOUNT_SCOPE_MISMATCH" });
    await activateLocalAccount(db, account);
    await recoverLegacyDiaryItem(db, account, original.localId, "p1", day, () => id(5));
    expect(await readLegacyDiaryItems(db, account)).toEqual([]);
    await expect(recoverLegacyDiaryItem(db, account, original.localId, "p1", day, () => id(6))).rejects.toThrow();
    const saved = await db.getAllAsync<{ payload_json: string; last_error: string | null }>("SELECT payload_json, last_error FROM outbox ORDER BY rowid");
    expect(JSON.parse(saved[0]!.payload_json)).toEqual(old);
    expect(saved[0]!.last_error).toBe(`DIARY_REFERENCE_RECOVERED:${id(5)}`);
    expect(JSON.parse(saved[1]!.payload_json)).toMatchObject({ localId: id(5), diaryProjectId: "p1", diaryDate: day, diaryItemId: "item" });
    expect(await pendingOutboxCount(db, account)).toBe(1); db.close();
  });
});
