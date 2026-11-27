import { describe, expect, it } from "vitest";
import { createNodeSqlite, openNodeSqlite } from "../test/node-sqlite";
import { migrateLocalDatabase } from "../db/migrations";
import { activateLocalAccount, createSqliteR4SyncStore, queueHseIncident } from "../db/r4-outbox";
import { pendingHsePhotos, runHsePhotoSync, type HsePhotoTransport } from "./hse-photo-sync";

const account = { companyId: "c1", userId: "u1" };
const sha = "a".repeat(64);

async function setup() {
  const db = createNodeSqlite();
  await migrateLocalDatabase(db);
  await activateLocalAccount(db, account);
  const item = await queueHseIncident(db, account, { incidentId: "incident-1", incident: {
    kind: "NEAR_MISS", severity: "MINOR", occurredAt: "2026-11-23T10:00:00Z", projectId: null,
    locationText: null, lat: null, lng: null, description: "Opasnost na gradilištu", immediateAction: null,
    injuredWorkerId: null, lostDays: 0, reportableToAuthority: false, updateBody: null,
    photos: [{ fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 4, sha256: sha }],
  }, photoData: [{ sha256: sha, base64: "/9j/AA==" }] }, "2026-11-23T10:00:00Z", () => "00000000-0000-4000-8000-000000000001");
  return { db, item };
}

describe("HSE nastavak fotografija", () => {
  it("ne šalje prije potvrde prijave, pa ponavlja izgubljenu potvrdu bez novog uploada", async () => {
    const { db, item } = await setup();
    expect(await pendingHsePhotos(db, account)).toHaveLength(0);
    await createSqliteR4SyncStore(db, account).markResult({ localId: item.localId, status: "APPLIED", entityId: "incident-1", version: 1, cursor: "1" });
    expect(await pendingHsePhotos(db, account)).toHaveLength(1);
    let confirmed = false;
    let puts = 0;
    const transport: HsePhotoTransport = {
      resume: async (_incident, _sha, action) => {
        if (action === "CONFIRM") { confirmed = true; throw new Error("Odgovor potvrde izgubljen"); }
        return confirmed ? { status: "confirmed", uploadUrl: null } : { status: "pending", uploadUrl: "https://example.test/upload" };
      },
      put: async () => { puts += 1; },
    };
    expect(await runHsePhotoSync(db, account, transport)).toEqual({ sent: 0, failed: 1 });
    expect((await pendingHsePhotos(db, account))[0]?.data_base64).toBe("/9j/AA==");
    expect(await runHsePhotoSync(db, account, transport)).toEqual({ sent: 1, failed: 0 });
    expect(puts).toBe(1);
    expect(await pendingHsePhotos(db, account)).toHaveLength(0);
    expect(await db.getFirstAsync("SELECT status, data_base64 FROM hse_photo_queue")).toEqual({ status: "sent", data_base64: "" });
    db.close();
  });

  it("nastavlja fotografiju nakon gašenja, prekida mreže i promjene naloga bez curenja bajtova", async () => {
    const setupResult = await setup();
    let db = setupResult.db;
    await createSqliteR4SyncStore(db, account).markResult({ localId: setupResult.item.localId, status: "APPLIED", entityId: "incident-1", version: 1, cursor: "1" });
    const failed: HsePhotoTransport = { resume: async () => { throw new Error("offline"); }, put: async () => { throw new Error("unexpected"); } };
    expect(await runHsePhotoSync(db, account, failed)).toEqual({ sent: 0, failed: 1 });
    const path = db.path; db.close(); db = openNodeSqlite(path);
    await activateLocalAccount(db, { companyId: "c1", userId: "u2" });
    expect(await pendingHsePhotos(db, { companyId: "c1", userId: "u2" })).toEqual([]);
    await expect(pendingHsePhotos(db, account)).rejects.toMatchObject({ code: "LOCAL_ACCOUNT_SCOPE_MISMATCH" });
    await activateLocalAccount(db, account);
    let uploaded = "";
    expect(await runHsePhotoSync(db, account, {
      resume: async (_id, _sha, action) => action === "CONFIRM" ? { status: "confirmed", uploadUrl: null } : { status: "pending", uploadUrl: "https://example.test" },
      put: async (_url, _type, data) => { uploaded = data; },
    })).toEqual({ sent: 1, failed: 0 });
    expect(uploaded).toBe("/9j/AA=="); db.close();
  });

  it("promjena naloga nakon dobijanja URL-a zaustavlja slanje bajtova", async () => {
    const { db, item } = await setup();
    await createSqliteR4SyncStore(db, account).markResult({ localId: item.localId, status: "APPLIED", entityId: "incident-1", version: 1, cursor: "1" });
    let puts = 0;
    await expect(runHsePhotoSync(db, account, {
      resume: async () => { await activateLocalAccount(db, { companyId: "c1", userId: "u2" }); return { status: "pending", uploadUrl: "https://example.test" }; },
      put: async () => { puts += 1; },
    })).rejects.toMatchObject({ code: "LOCAL_ACCOUNT_SCOPE_MISMATCH" });
    expect(puts).toBe(0);
    await activateLocalAccount(db, account);
    expect((await pendingHsePhotos(db, account))[0]?.data_base64).toBe("/9j/AA=="); db.close();
  });

  it("ne čuva prijavu kad nedostaju bajtovi fotografije", async () => {
    const { db } = await setup();
    const rows = await db.getAllAsync("SELECT local_id FROM outbox");
    expect(rows).toHaveLength(1);
    await expect(queueHseIncident(db, account, { incidentId: "broken", incident: {
      kind: "NEAR_MISS", severity: "MINOR", occurredAt: "2026-11-23T10:00:00Z", projectId: null,
      locationText: null, lat: null, lng: null, description: "Opasnost bez slike", immediateAction: null,
      injuredWorkerId: null, lostDays: 0, reportableToAuthority: false, updateBody: null,
      photos: [{ fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 4, sha256: sha }],
    } })).rejects.toMatchObject({ code: "PHOTO_DATA_MISSING" });
    expect(await db.getAllAsync("SELECT local_id FROM outbox")).toHaveLength(1);
    db.close();
  });
});
