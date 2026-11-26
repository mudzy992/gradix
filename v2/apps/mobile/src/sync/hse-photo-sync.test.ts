import { describe, expect, it } from "vitest";
import { createNodeSqlite } from "../test/node-sqlite";
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
