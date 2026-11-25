import { describe, expect, it } from "vitest";
import type { R4SyncPullPage, R4WorkEntryPayload } from "@gradix/domain";
import { getLogoutSummary, logoutMobile } from "../api/session-lifecycle";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { createNodeSqlite } from "../test/node-sqlite";
import { migrateLocalDatabase } from "./migrations";
import {
  activateLocalAccount,
  createSqliteR4SyncStore,
  LocalOutboxError,
  pendingOutboxCount,
  queueForemanGroupWorkEntries,
  queueHseAction,
  queueHseIncident,
  queueHseTraining,
  queueSiteDiary,
  queueSiteDiaryItem,
  readForemanWorkerRoster,
  saveForemanWorkerRoster,
  type LocalAccount,
} from "./r4-outbox";

const ACCOUNT_A: LocalAccount = { companyId: "company-A", userId: "user-A" };
const ACCOUNT_B: LocalAccount = { companyId: "company-A", userId: "user-B" };
const PROJECT = "project-allowed";
const WORK_DATE = "2026-11-09";
const entry: R4WorkEntryPayload = {
  kind: "WORK",
  startedAt: `${WORK_DATE}T08:00:00+01:00`,
  endedAt: `${WORK_DATE}T09:00:00+01:00`,
  endState: "KNOWN_END",
  projectId: PROJECT,
  machineId: null,
  note: null,
};

function localUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function freshDb() {
  const sqlite = createNodeSqlite("gradix-r4-outbox-");
  await migrateLocalDatabase(sqlite);
  return sqlite;
}

describe("R4 SQLite outbox and account privacy", () => {
  it("queues a foreman group offline from only the cached R3 worker roster", async () => {
    const sqlite = await freshDb();
    const { raw } = sqlite;
    const db = sqlite;
    await activateLocalAccount(db, ACCOUNT_A);
    await saveForemanWorkerRoster(db, ACCOUNT_A, PROJECT, WORK_DATE, [
      { id: "worker-1", name: "Amina Radnik" },
      { id: "worker-2", name: "Boris Radnik" },
    ]);
    const roster = await readForemanWorkerRoster(db, ACCOUNT_A, PROJECT, WORK_DATE);
    expect(roster.workers).toEqual([
      { id: "worker-1", name: "Amina Radnik" },
      { id: "worker-2", name: "Boris Radnik" },
    ]);

    let sequence = 0;
    const queued = await queueForemanGroupWorkEntries(db, ACCOUNT_A, {
      projectId: PROJECT,
      workDate: WORK_DATE,
      workerIds: ["worker-1", "worker-2"],
      entry,
      deviceSentAt: `${WORK_DATE}T09:05:00+01:00`,
    }, () => localUuid(++sequence));

    expect(queued).toHaveLength(2);
    expect(queued.map((item) => ("workerId" in item ? item.workerId : null))).toEqual(["worker-1", "worker-2"]);
    expect(await pendingOutboxCount(db, ACCOUNT_A)).toBe(2);
    expect(await createSqliteR4SyncStore(db, ACCOUNT_A).pending()).toEqual(queued);
    const rosterColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(foreman_workers_cache)");
    expect(rosterColumns.map((column) => column.name)).not.toContain("phone");
    expect(rosterColumns.map((column) => column.name)).not.toContain("email");
    raw.close();
  });

  it("rejects a worker ID absent from the scoped local roster before adding any outbox row", async () => {
    const sqlite = await freshDb();
    const { raw } = sqlite;
    const db = sqlite;
    await activateLocalAccount(db, ACCOUNT_A);
    await saveForemanWorkerRoster(db, ACCOUNT_A, PROJECT, WORK_DATE, [{ id: "worker-1", name: "Amina Radnik" }]);
    await expect(queueForemanGroupWorkEntries(db, ACCOUNT_A, {
      projectId: PROJECT,
      workDate: WORK_DATE,
      workerIds: ["worker-outside"],
      entry,
      deviceSentAt: `${WORK_DATE}T09:05:00+01:00`,
    })).rejects.toMatchObject({ code: "FOREMAN_WORKER_OUTSIDE_CACHED_SCOPE" });
    expect(await pendingOutboxCount(db, ACCOUNT_A)).toBe(0);
    raw.close();
  });

  it("account switch purges caches, retains rows, and a stale store cannot send the prior account's row", async () => {
    const sqlite = await freshDb();
    const { raw } = sqlite;
    const db = sqlite;
    await activateLocalAccount(db, ACCOUNT_A);
    await saveForemanWorkerRoster(db, ACCOUNT_A, PROJECT, WORK_DATE, [{ id: "worker-1", name: "Amina Radnik" }]);
    await queueForemanGroupWorkEntries(db, ACCOUNT_A, {
      projectId: PROJECT,
      workDate: WORK_DATE,
      workerIds: ["worker-1"],
      entry,
      deviceSentAt: `${WORK_DATE}T09:05:00+01:00`,
    }, (() => { let i = 10; return () => localUuid(++i); })());
    const staleStore = createSqliteR4SyncStore(db, ACCOUNT_A);

    const switched = await activateLocalAccount(db, ACCOUNT_B);
    expect(switched.changed).toBe(true);
    expect(switched.pendingForOtherAccounts).toBe(1);
    expect(await createSqliteR4SyncStore(db, ACCOUNT_B).pending()).toEqual([]);
    await expect(staleStore.pending()).rejects.toMatchObject({ code: "LOCAL_ACCOUNT_SCOPE_MISMATCH" });
    await expect(runSqliteR4Sync(db, ACCOUNT_A)).resolves.toMatchObject({
      applied: 0,
      retry: 0,
      error: "LOCAL_ACCOUNT_SCOPE_MISMATCH",
    });
    expect(await readForemanWorkerRoster(db, ACCOUNT_B, PROJECT, WORK_DATE)).toEqual({ workers: [], fetchedAt: null });

    await activateLocalAccount(db, ACCOUNT_A);
    expect(await createSqliteR4SyncStore(db, ACCOUNT_A).pending()).toHaveLength(1);
    expect(await pendingOutboxCount(db, ACCOUNT_B)).toBe(0);
    raw.close();
  });

  it("logout always requires confirmation, clears private caches/cursor, and preserves pending rows", async () => {
    const sqlite = await freshDb();
    const { raw } = sqlite;
    const db = sqlite;
    await activateLocalAccount(db, ACCOUNT_A);
    await saveForemanWorkerRoster(db, ACCOUNT_A, PROJECT, WORK_DATE, [{ id: "worker-1", name: "Amina Radnik" }]);
    await queueForemanGroupWorkEntries(db, ACCOUNT_A, {
      projectId: PROJECT,
      workDate: WORK_DATE,
      workerIds: ["worker-1"],
      entry,
      deviceSentAt: `${WORK_DATE}T09:05:00+01:00`,
    }, (() => { let i = 20; return () => localUuid(++i); })());
    await db.runAsync("INSERT INTO projects_cache (id, code, name, status) VALUES ('p1', 'P1', 'Cache', 'ACTIVE')");
    await db.runAsync(
      "INSERT INTO notes (local_id, text, client_at, status) VALUES ('legacy-r0-1', 'old note', ?, 'pending')",
      [`${WORK_DATE}T07:00:00Z`],
    );
    await createSqliteR4SyncStore(db, ACCOUNT_A).applyPullPage({
      events: [{
        id: "conflict-event-1",
        cursorSeq: "1",
        entityType: "sync_conflict",
        entityId: "conflict-1",
        entityVersion: 1,
        payload: { receivedPayload: { note: "original offline payload" } },
        tombstone: false,
        createdAt: `${WORK_DATE}T10:00:00.000Z`,
      }],
      cursor: "opaque-A", cursorFloor: "opaque-floor-A", hasMore: false,
    });

    let revocations = 0;
    const revoke = async () => { revocations += 1; return true; };
    const summary = await getLogoutSummary(db);
    expect(summary).toMatchObject({ pendingCount: 1, legacyR0Count: 1 });
    const cancelled = await logoutMobile(db, false, revoke);
    expect(cancelled).toMatchObject({ loggedOut: false, requiresConfirmation: true, pendingCount: 2 });
    expect(revocations).toBe(0);
    expect(await getActiveLocalAccountForTest(db)).toEqual(ACCOUNT_A);

    const loggedOut = await logoutMobile(db, true, revoke);
    expect(loggedOut).toMatchObject({ loggedOut: true, requiresConfirmation: false, pendingCount: 2, serverRevoked: true });
    expect(revocations).toBe(1);
    expect(await getActiveLocalAccountForTest(db)).toBeNull();
    expect(await pendingOutboxCount(db, ACCOUNT_A)).toBe(1);
    expect((await db.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM projects_cache"))?.count).toBe(0);
    expect((await db.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM foreman_workers_cache"))?.count).toBe(0);
    expect((await db.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM sync_events WHERE entity_type <> 'sync_conflict'"))?.count).toBe(0);
    expect((await db.getFirstAsync<{ payload_json: string }>("SELECT payload_json FROM sync_events WHERE entity_type = 'sync_conflict'"))?.payload_json)
      .toContain("original offline payload");
    expect((await db.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM sync_cursors"))?.count).toBe(0);
    expect((await db.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM notes WHERE local_id = 'legacy-r0-1'"))?.count).toBe(1);
    raw.close();
  });

  it("applies a pull page and its opaque cursor atomically and deduplicates replayed events", async () => {
    const sqlite = await freshDb();
    const { raw } = sqlite;
    const db = sqlite;
    await activateLocalAccount(db, ACCOUNT_A);
    const store = createSqliteR4SyncStore(db, ACCOUNT_A);
    const badPage = {
      events: [{
        id: "event-bad",
        cursorSeq: "1",
        entityType: "unsupported",
        entityId: "x",
        entityVersion: 1,
        payload: null,
        tombstone: false,
        createdAt: `${WORK_DATE}T10:00:00.000Z`,
      }],
      cursor: "opaque-bad",
      cursorFloor: "opaque-floor",
      hasMore: false,
    } as unknown as R4SyncPullPage;
    await expect(store.applyPullPage(badPage)).rejects.toThrow();
    expect(await store.readCursor()).toBe("");
    expect((await db.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM sync_events"))?.count).toBe(0);

    const page: R4SyncPullPage = {
      events: [{
        id: "event-1",
        cursorSeq: "1",
        entityType: "work_entry",
        entityId: "entry-1",
        entityVersion: 1,
        payload: { workerId: "worker-1", workerName: "Amina Radnik" },
        tombstone: false,
        createdAt: `${WORK_DATE}T10:00:00.000Z`,
      }],
      cursor: "opaque-cursor-1",
      cursorFloor: "opaque-floor-0",
      hasMore: false,
    };
    await store.applyPullPage(page);
    await store.applyPullPage(page);
    expect(await store.readCursor()).toBe("opaque-cursor-1");
    expect((await db.getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM sync_events"))?.count).toBe(1);
    raw.close();
  });

  /*
   * F9 — dnevnik i HSE u offline redu.
   *
   * Tri stvari se ovdje dokazuju, i to su tri stvari koje bi na terenu najskuplje pukle:
   *   1. svih pet tipova stvarno ulazi u `outbox` (novi `CHECK` iz v3 ih prima);
   *   2. neispravna prijava se odbija PRIJE upisa — telefon ne nosi smeće do servera;
   *   3. `localId` je ključ idempotencije, pa dvostruki dodir ne pravi drugi red.
   */
  it("F9: dnevnik, količina i tri HSE zapisa ulaze u outbox kao 'pending'", async () => {
    const sqlite = await freshDb();
    const { raw } = sqlite;
    const db = sqlite;
    await activateLocalAccount(db, ACCOUNT_A);

    const incident = {
      kind: "NEAR_MISS" as const,
      severity: "MINOR" as const,
      occurredAt: `${WORK_DATE}T09:15:00+01:00`,
      projectId: PROJECT,
      locationText: "Kota 2",
      lat: null,
      lng: null,
      description: "Daska pala pored radnika, bez povrede.",
      immediateAction: "Zona obilježena.",
      injuredWorkerId: null,
      lostDays: 0,
      reportableToAuthority: false,
      photos: [],
      updateBody: "Svjedok: vjetar je odnio dasku.",
    };

    await queueSiteDiary(db, ACCOUNT_A, {
      diaryId: "diary-local-1",
      baseVersion: 3,
      diary: {
        projectId: PROJECT,
        diaryDate: WORK_DATE,
        weather: "RAIN",
        temperatureC: "12.5",
        workedHours: "7.50",
        description: "Kiša cijeli dan, betoniranje stalo.",
        visitors: null,
        events: null,
        signedName: null,
        delays: [{
          kind: "RAIN",
          fromAt: `${WORK_DATE}T08:00:00+01:00`,
          toAt: `${WORK_DATE}T11:00:00+01:00`,
          hours: "3.00",
          note: "Jaka kiša",
        }],
      },
    }, `${WORK_DATE}T17:00:00.000Z`, () => localUuid(101));
    await queueSiteDiaryItem(db, ACCOUNT_A, {
      diaryItemId: "diary-item-1", diaryProjectId: PROJECT, diaryDate: WORK_DATE,
      item: { boqItemId: null, description: "Beton C25/30", unit: "m3", quantity: "12.500", source: "MANUAL" },
    }, `${WORK_DATE}T17:01:00.000Z`, () => localUuid(102));
    await queueHseIncident(db, ACCOUNT_A, { incidentId: "incident-local-1", incident },
      `${WORK_DATE}T09:20:00.000Z`, () => localUuid(103));
    await queueHseAction(db, ACCOUNT_A, {
      actionId: "action-local-1",
      action: {
        incidentId: "incident-local-1",
        inspectionId: null,
        description: "Ograditi ivicu skele",
        responsibleWorkerId: "worker-1",
        dueOn: WORK_DATE,
      },
    }, `${WORK_DATE}T09:30:00.000Z`, () => localUuid(104));
    await queueHseTraining(db, ACCOUNT_A, {
      trainingId: "training-local-1",
      training: {
        kind: "TOOLBOX",
        title: "Toolbox: rad na visini",
        topic: "Vezivanje pojasa",
        heldAt: `${WORK_DATE}T07:00:00+01:00`,
        projectId: PROJECT,
        location: "Konstrukcija",
        durationMinutes: 15,
        attendees: [{
          workerId: "worker-1",
          signatureName: "Amina Radnik",
          signedAt: `${WORK_DATE}T07:15:00+01:00`,
        }],
      },
    }, `${WORK_DATE}T07:16:00.000Z`, () => localUuid(105));

    expect(await pendingOutboxCount(db, ACCOUNT_A)).toBe(5);
    const rows = await db.getAllAsync<{ entity_type: string; status: string }>(
      /* Redoslijed je po `local_id` (uuid fiksture), a ne po vremenu: `created_at` je tekst i
         namjerno se ne koristi kao sorter u testu, jer bi tvrdnja zavisila od kazaljke sata. */
      "SELECT entity_type, status FROM outbox WHERE company_id = ? AND user_id = ? ORDER BY local_id",
      [ACCOUNT_A.companyId, ACCOUNT_A.userId],
    );
    expect(rows.map((row) => row.entity_type).sort()).toEqual([
      "hse_action", "hse_incident", "hse_training", "site_diary", "site_diary_item",
    ]);
    expect(rows.every((row) => row.status === "pending")).toBe(true);

    /*
     * Idempotencija ima DVA sloja i oba su namjerna:
     *  - isti `localId` sa ISTIM sadržajem je ponovni poziv (npr. nakon prekida) — ne pravi drugi red;
     *  - isti `localId` sa DRUGAČIJIM sadržajem je greška u kodu, ne nova prijava — odbija se, jer bi
     *    inače dvije različite prijave nosile isti ključ idempotencije i jedna nestala na serveru.
     */
    await queueHseIncident(db, ACCOUNT_A, { incidentId: "incident-local-1", incident },
      `${WORK_DATE}T09:20:00.000Z`, () => localUuid(103));
    expect(await pendingOutboxCount(db, ACCOUNT_A)).toBe(5);
    await expect(queueHseIncident(db, ACCOUNT_A, { incidentId: "incident-local-1", incident },
      `${WORK_DATE}T09:21:00.000Z`, () => localUuid(103))).rejects.toThrow(/Lokalni ID već postoji/);
    raw.close();
  });

  it("F9: neispravna prijava se odbija PRIJE upisa (mjera bez roka, toolbox bez teme, zastoj > 24 h)", async () => {
    const sqlite = await freshDb();
    const { raw } = sqlite;
    const db = sqlite;
    await activateLocalAccount(db, ACCOUNT_A);

    await expect(queueHseAction(db, ACCOUNT_A, {
      actionId: "action-bad",
      action: {
        incidentId: "incident-local-9",
        inspectionId: null,
        description: "Nešto uraditi",
        responsibleWorkerId: "worker-1",
        dueOn: "nije datum",
      },
    })).rejects.toBeInstanceOf(LocalOutboxError);

    await expect(queueHseTraining(db, ACCOUNT_A, {
      trainingId: "training-bad",
      training: {
        kind: "TOOLBOX",
        title: "Toolbox",
        topic: null,
        heldAt: `${WORK_DATE}T07:00:00+01:00`,
        projectId: PROJECT,
        location: null,
        durationMinutes: 15,
        attendees: [{
          workerId: "worker-1",
          signatureName: "Amina Radnik",
          signedAt: `${WORK_DATE}T07:15:00+01:00`,
        }],
      },
    })).rejects.toBeInstanceOf(LocalOutboxError);

    await expect(queueSiteDiary(db, ACCOUNT_A, {
      diaryId: "diary-bad",
      baseVersion: 1,
      diary: {
        projectId: PROJECT,
        diaryDate: WORK_DATE,
        weather: "RAIN",
        temperatureC: null,
        workedHours: null,
        description: null,
        visitors: null,
        events: null,
        signedName: null,
        delays: [{
          kind: "RAIN",
          fromAt: `${WORK_DATE}T08:00:00+01:00`,
          toAt: `${WORK_DATE}T20:00:00+01:00`,
          hours: "30.00",
          note: null,
        }],
      },
    })).rejects.toBeInstanceOf(LocalOutboxError);

    expect(await pendingOutboxCount(db, ACCOUNT_A)).toBe(0);
    raw.close();
  });
});

async function getActiveLocalAccountForTest(db: Awaited<ReturnType<typeof freshDb>>) {
  const row = await db.getFirstAsync<{ company_id: string; user_id: string }>(
    "SELECT company_id, user_id FROM active_account WHERE singleton = 1",
  );
  return row ? { companyId: row.company_id, userId: row.user_id } : null;
}
