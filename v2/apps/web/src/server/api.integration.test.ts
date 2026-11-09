/**
 * Integracijski testovi API-ja na PRAVOJ bazi. Ne mock-uju bazu: cilj je dokazati
 * da tenant izolacija, sesije i sync rade kroz cijeli put (ruta → servis → RLS → baza).
 *
 * Traži: DATABASE_URL (gradix_app) i DATABASE_ADMIN_URL (vlasnik šeme, za seed).
 * Bez njih se testovi preskaču — nikad ne prolaze lažno.
 */
import { NextRequest } from "next/server";
import type { R4WorkEntryPushItem } from "@gradix/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as refreshRoute } from "@/app/api/auth/refresh/route";
import { GET as meRoute } from "@/app/api/me/route";
import { POST as pushRoute } from "@/app/api/sync/push/route";
import { GET as pullRoute } from "@/app/api/sync/pull/route";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY_A = "cmp_it_a";
const COMPANY_B = "cmp_it_b";
const USER_A = "usr_it_a";
const USER_B = "usr_it_b";
const USER_WORKER_A = "usr_it_worker_a";
const USER_WORKER_B = "usr_it_worker_b";
const WORKER_A = "wrk_it_a";
const WORKER_B = "wrk_it_b";
const PROJECT_A = "prj_it_a";
const WORKDAY_A = randomUUID();
const WORKDAY_B = randomUUID();
const WORKDAY_CANONICAL_RACE = randomUUID();
const WORK_ENTRY_A = randomUUID();
const WORK_ENTRY_CANONICAL_RACE = randomUUID();
const WORK_ENTRY_OPEN = randomUUID();
const WORK_ENTRY_B = randomUUID();
const PASSWORD = "test-lozinka-123";

function jsonRequest(url: string, body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers });
}

function getRequest(url: string, cookie?: string): NextRequest {
  return new NextRequest(url, { headers: cookie ? { cookie } : {} });
}

function cookieFrom(response: Response, name: string): string {
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return setCookie ? (setCookie.split(";")[0] as string) : "";
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function workEntryItem(localId: string, workdayId: string, workEntryId: string, note: string): R4WorkEntryPushItem {
  return {
    localId,
    entityType: "work_entry" as const,
    workdayId,
    workEntryId,
    deviceSentAt: new Date().toISOString(),
    entry: {
      kind: "WORK" as const,
      startedAt: "2026-11-07T08:00:00+01:00",
      endedAt: "2026-11-07T09:00:00+01:00",
      endState: "KNOWN_END" as const,
      projectId: PROJECT_A,
      machineId: null,
      note,
    },
  };
}

function workdaySubmitItem(localId: string, workdayId: string, baseVersion: number) {
  return {
    localId,
    entityType: "workday" as const,
    workdayId,
    baseVersion,
    deviceSentAt: new Date().toISOString(),
    status: "SUBMITTED" as const,
  };
}

describeDb("API (integracija na pravoj bazi)", () => {
  const admin = new Pool({ connectionString: adminUrl });

  async function cleanFixtures() {
    await admin.query("DELETE FROM public.sync_conflicts WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.sync_receipts WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.work_entries WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.workdays WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.sync_change_log WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.sync_cursor_slots WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.sync_cursor_allocators WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.projects WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.workers WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.sessions WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.memberships WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.machines WHERE company_id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM public.users WHERE id = ANY($1)", [[USER_A, USER_B, USER_WORKER_A, USER_WORKER_B]]);
  }

  beforeAll(async () => {
    await cleanFixtures();
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await admin.query(
      "INSERT INTO companies (id, name, slug) VALUES ($1, 'IT Firma A', 'it-firma-a'), ($2, 'IT Firma B', 'it-firma-b')",
      [COMPANY_A, COMPANY_B],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'it-a@test.example', $5, 'Test', 'A', false),
              ($2, 'it-b@test.example', $5, 'Test', 'B', false),
              ($3, 'it-worker-a@test.example', $5, 'Worker', 'A', false),
              ($4, 'it-worker-b@test.example', $5, 'Worker', 'B', false)`,
      [USER_A, USER_B, USER_WORKER_A, USER_WORKER_B, hash],
    );
    await admin.query(
      `INSERT INTO memberships (id, user_id, company_id, roles, scope) VALUES
       ('mem_it_a', $1, $3, ARRAY['ADMIN']::"Role"[], 'COMPANY'),
       ('mem_it_b', $2, $4, ARRAY['OWNER']::"Role"[], 'COMPANY'),
       ('mem_it_worker_a', $5, $3, ARRAY['WORKER']::"Role"[], 'SELF'),
       ('mem_it_worker_b', $6, $3, ARRAY['WORKER']::"Role"[], 'SELF')`,
      [USER_A, USER_B, COMPANY_A, COMPANY_B, USER_WORKER_A, USER_WORKER_B],
    );
    await admin.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id) VALUES
       ($1, $3, 'Worker', 'A', '2025-01-01', $4),
       ($2, $3, 'Worker', 'B', '2025-01-01', $5)`,
      [WORKER_A, WORKER_B, COMPANY_A, USER_WORKER_A, USER_WORKER_B],
    );
    await admin.query(
      `INSERT INTO projects (id, company_id, code, name) VALUES
       ($1, $2, 'IT-R4-A', 'R4 project A'),
       ($3, $4, 'IT-R4-B', 'R4 project B')`,
      [PROJECT_A, COMPANY_A, "prj_it_b", COMPANY_B],
    );
    await admin.query(
      `INSERT INTO machines (id, company_id, code, name, category_id) VALUES
       ('mch_it_a', $1, 'IT-BAG', 'Bager A', $1 || '_cat_other'),
       ('mch_it_b', $2, 'IT-KAM', 'Kamion B', $2 || '_cat_other')`,
      [COMPANY_A, COMPANY_B],
    );
  });

  afterAll(async () => {
    await cleanFixtures();
    await admin.end();
  });

  it("prijava vraća sesiju i cookie", async () => {
    const response = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.example", password: PASSWORD }));
    expect(response.status).toBe(200);
    const body = await bodyOf<{ success: boolean; data: { companyId: string } }>(response);
    expect(body.data.companyId).toBe(COMPANY_A);
    expect(cookieFrom(response, "gx_at")).not.toBe("");
    expect(cookieFrom(response, "gx_rt")).not.toBe("");
  });

  it("nepoznat email i pogrešna lozinka daju isti kod", async () => {
    const wrongPassword = await loginRoute(
      jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.example", password: "pogresna-lozinka" }),
    );
    const missingUser = await loginRoute(
      jsonRequest("http://localhost/api/auth/login", { email: "nema@test.example", password: "pogresna-lozinka" }),
    );
    expect(wrongPassword.status).toBe(401);
    expect(missingUser.status).toBe(401);
    expect((await bodyOf<{ error: { code: string } }>(wrongPassword)).error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect((await bodyOf<{ error: { code: string } }>(missingUser)).error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("/api/me bez sesije je 401", async () => {
    expect((await meRoute(getRequest("http://localhost/api/me"))).status).toBe(401);
  });

  it("/api/me vraća samo mašine svoje firme", async () => {
    const login = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.example", password: PASSWORD }));
    const cookie = cookieFrom(login, "gx_at");
    const me = await meRoute(getRequest("http://localhost/api/me", cookie));
    expect(me.status).toBe(200);
    const body = await bodyOf<{ data: { machineCount: number; company: { name: string } } }>(me);
    expect(body.data.company.name).toBe("IT Firma A");
    expect(body.data.machineCount).toBe(1);
  });

  it("refresh rotira token, ponovna upotreba gasi sesije", async () => {
    const login = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-b@test.example", password: PASSWORD }));
    const refreshToken = (await bodyOf<{ data: { refreshToken: string } }>(login)).data.refreshToken;

    const first = await refreshRoute(jsonRequest("http://localhost/api/auth/refresh", { refreshToken }));
    expect(first.status).toBe(200);
    const nextToken = (await bodyOf<{ data: { refreshToken: string } }>(first)).data.refreshToken;
    expect(nextToken).not.toBe(refreshToken);

    const replay = await refreshRoute(jsonRequest("http://localhost/api/auth/refresh", { refreshToken }));
    expect((await bodyOf<{ error: { code: string } }>(replay)).error.code).toBe("AUTH_REFRESH_REUSE");

    // Nakon reuse-a sve sesije korisnika su opozvane, uključujući novi token.
    const afterReuse = await refreshRoute(jsonRequest("http://localhost/api/auth/refresh", { refreshToken: nextToken }));
    expect(afterReuse.status).toBe(401);
  });

  it("R4 push je idempotentan; pull je ograničen na radnika i firmu", async () => {
    const loginWorkerA = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-worker-a@test.example", password: PASSWORD }));
    const cookieWorkerA = cookieFrom(loginWorkerA, "gx_at");
    const payloadA = { items: [workEntryItem(randomUUID(), WORKDAY_A, WORK_ENTRY_A, "Iskop A")] };

    const pushErrorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await pushRoute(jsonRequest("http://localhost/api/sync/push", payloadA, cookieWorkerA));
    const pushErrors = pushErrorLog.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    pushErrorLog.mockRestore();
    expect(first.status, pushErrors).toBe(200);
    const firstBody = await bodyOf<{ data: { results: { localId: string; status: string; entityId: string | null; cursor: string | null; canonicalWorkdayId?: string }[] } }>(first);
    expect(firstBody.data.results[0]).toMatchObject({
      status: "APPLIED",
      entityId: WORK_ENTRY_A,
      canonicalWorkdayId: WORKDAY_A,
    });
    expect(firstBody.data.results[0]?.cursor).toBeTruthy();

    const second = await pushRoute(jsonRequest("http://localhost/api/sync/push", payloadA, cookieWorkerA));
    const secondBody = await bodyOf<{ data: { results: { status: string; entityId: string | null }[] } }>(second);
    expect(secondBody.data.results[0]).toMatchObject({ status: "DUPLICATE", entityId: WORK_ENTRY_A });

    const reusedLocalId = workEntryItem(payloadA.items[0]!.localId, WORKDAY_A, WORK_ENTRY_A, "different payload");
    const reused = await pushRoute(jsonRequest("http://localhost/api/sync/push", { items: [reusedLocalId] }, cookieWorkerA));
    const reusedBody = await bodyOf<{ data: { results: { status: string; code?: string }[] } }>(reused);
    expect(reusedBody.data.results[0]).toMatchObject({ status: "REJECTED", code: "SYNC_LOCAL_ID_REUSED" });

    const canonicalRace = workEntryItem(randomUUID(), WORKDAY_CANONICAL_RACE, WORK_ENTRY_CANONICAL_RACE, "drugi segment istog dana");
    canonicalRace.entry.startedAt = "2026-11-07T09:00:00+01:00";
    canonicalRace.entry.endedAt = "2026-11-07T10:00:00+01:00";
    const canonicalResponse = await pushRoute(jsonRequest("http://localhost/api/sync/push", { items: [canonicalRace] }, cookieWorkerA));
    const canonicalBody = await bodyOf<{ data: { results: { status: string; canonicalWorkdayId?: string }[] } }>(canonicalResponse);
    expect(canonicalBody.data.results[0]).toMatchObject({ status: "APPLIED", canonicalWorkdayId: WORKDAY_A });

    const overlapping = workEntryItem(randomUUID(), randomUUID(), randomUUID(), "preklopljeni segment");
    const overlapResponse = await pushRoute(jsonRequest("http://localhost/api/sync/push", { items: [overlapping] }, cookieWorkerA));
    const overlapBody = await bodyOf<{ data: { results: { status: string; code?: string; conflictId?: string }[] } }>(overlapResponse);
    expect(overlapBody.data.results[0]).toMatchObject({ status: "CONFLICT", code: "WORK_ENTRY_OVERLAP" });
    expect(overlapBody.data.results[0]?.conflictId).toBeTruthy();

    const openEntry = workEntryItem(randomUUID(), randomUUID(), WORK_ENTRY_OPEN, "otvoren segment");
    openEntry.entry.startedAt = "2026-11-07T13:00:00+01:00";
    openEntry.entry.endedAt = null;
    openEntry.entry.endState = "OPEN";
    const openResponse = await pushRoute(jsonRequest("http://localhost/api/sync/push", { items: [openEntry] }, cookieWorkerA));
    const openBody = await bodyOf<{ data: { results: { status: string; canonicalWorkdayId?: string }[] } }>(openResponse);
    expect(openBody.data.results[0]).toMatchObject({ status: "APPLIED", canonicalWorkdayId: WORKDAY_A });

    const submitResponse = await pushRoute(jsonRequest("http://localhost/api/sync/push", {
      items: [workdaySubmitItem(randomUUID(), WORKDAY_A, 1)],
    }, cookieWorkerA));
    const submitBody = await bodyOf<{ data: { results: { status: string; code?: string }[] } }>(submitResponse);
    expect(submitBody.data.results[0]).toMatchObject({ status: "REJECTED", code: "SYNC_ITEM_REJECTED" });

    const loginWorkerB = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-worker-b@test.example", password: PASSWORD }));
    const cookieWorkerB = cookieFrom(loginWorkerB, "gx_at");
    const payloadB = { items: [workEntryItem(randomUUID(), WORKDAY_B, WORK_ENTRY_B, "Iskop B")] };
    const pushB = await pushRoute(jsonRequest("http://localhost/api/sync/push", payloadB, cookieWorkerB));
    expect(pushB.status).toBe(200);

    const ownPull = await pullRoute(getRequest("http://localhost/api/sync/pull", cookieWorkerA));
    const ownBody = await bodyOf<{ data: { events: { entityId: string; entityType: string; payload: Record<string, unknown> | null }[]; cursor: string } }>(ownPull);
    expect(ownBody.data.events.map((event) => event.entityId)).toEqual([
      WORKDAY_A,
      WORK_ENTRY_A,
      WORK_ENTRY_CANONICAL_RACE,
      overlapBody.data.results[0]?.conflictId,
      WORK_ENTRY_OPEN,
    ]);
    expect(ownBody.data.events.map((event) => event.entityType)).toEqual([
      "workday", "work_entry", "work_entry", "sync_conflict", "work_entry",
    ]);
    const pushedEntry = ownBody.data.events.find((event) => event.entityType === "work_entry");
    expect(pushedEntry?.payload?.reviewFlags).toContain("PROJECT_NOT_ASSIGNED_ON_WORK_DATE");
    expect(ownBody.data.events.every((event) => !JSON.stringify(event.payload).match(/phone|email/i))).toBe(true);
    expect(ownBody.data.cursor).toBeTruthy();

    const loginAdmin = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.example", password: PASSWORD }));
    const officePull = await pullRoute(getRequest("http://localhost/api/sync/pull", cookieFrom(loginAdmin, "gx_at")));
    const officeBody = await bodyOf<{ data: { events: { entityId: string; entityType: string }[] } }>(officePull);
    expect(officeBody.data.events.map((event) => `${event.entityType}:${event.entityId}`).sort()).toEqual([
      `workday:${WORKDAY_A}`,
      `work_entry:${WORK_ENTRY_A}`,
      `work_entry:${WORK_ENTRY_CANONICAL_RACE}`,
      `work_entry:${WORK_ENTRY_OPEN}`,
      `workday:${WORKDAY_B}`,
      `work_entry:${WORK_ENTRY_B}`,
      `sync_conflict:${overlapBody.data.results[0]?.conflictId}`,
    ].sort());

    const loginCompanyB = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-b@test.example", password: PASSWORD }));
    const cookieCompanyB = cookieFrom(loginCompanyB, "gx_at");
    const companyBPull = await pullRoute(getRequest("http://localhost/api/sync/pull", cookieCompanyB));
    const companyBBody = await bodyOf<{ data: { events: unknown[] } }>(companyBPull);
    expect(companyBBody.data.events).toHaveLength(0);
    const crossTenantCursor = await pullRoute(getRequest(
      `http://localhost/api/sync/pull?cursor=${encodeURIComponent(ownBody.data.cursor)}`,
      cookieCompanyB,
    ));
    expect(crossTenantCursor.status).toBe(400);
    expect((await bodyOf<{ error: { code: string } }>(crossTenantCursor)).error.code).toBe("SYNC_CURSOR_INVALID");
  });

  it("R4 push odbija prekoračene limite i ne prihvata tijelo starog notes protokola", async () => {
    const login = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-worker-a@test.example", password: PASSWORD }));
    const cookie = cookieFrom(login, "gx_at");
    const tooMany = Array.from({ length: 101 }, (_, index) => workEntryItem(randomUUID(), randomUUID(), randomUUID(), `bulk-${index}`));
    const batchResponse = await pushRoute(jsonRequest("http://localhost/api/sync/push", { items: tooMany }, cookie));
    expect(batchResponse.status).toBe(400);
    expect((await bodyOf<{ error: { code: string } }>(batchResponse)).error.code).toBe("SYNC_BATCH_TOO_LARGE");

    const oversizedBody = Array.from({ length: 100 }, (_, index) =>
      workEntryItem(randomUUID(), randomUUID(), randomUUID(), `${index}${"x".repeat(11_000)}`),
    );
    const bodyResponse = await pushRoute(jsonRequest("http://localhost/api/sync/push", { items: oversizedBody }, cookie));
    expect(bodyResponse.status).toBe(413);
    expect((await bodyOf<{ error: { code: string } }>(bodyResponse)).error.code).toBe("SYNC_BODY_TOO_LARGE");

    const oldNotes = await pushRoute(jsonRequest("http://localhost/api/sync/push", {
      deviceId: "old-device",
      items: [{ localId: "old-note", entityType: "note", payload: { text: "legacy" }, clientAt: new Date().toISOString() }],
    }, cookie));
    expect(oldNotes.status).toBe(400);
    expect((await bodyOf<{ error: { code: string } }>(oldNotes)).error.code).toBe("SYNC_ITEM_INVALID");

    const largeItem = workEntryItem(randomUUID(), randomUUID(), randomUUID(), "x".repeat(17_000));
    const itemResponse = await pushRoute(jsonRequest("http://localhost/api/sync/push", { items: [largeItem] }, cookie));
    expect(itemResponse.status).toBe(413);
    expect((await bodyOf<{ error: { code: string } }>(itemResponse)).error.code).toBe("SYNC_ITEM_TOO_LARGE");
  });

  it("opaque pull cursors su tenant-bound i ne prihvataju stari since watermark", async () => {
    const login = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-worker-a@test.example", password: PASSWORD }));
    const cookie = cookieFrom(login, "gx_at");
    const oldSince = await pullRoute(getRequest("http://localhost/api/sync/pull?since=2030-01-01T00:00:00Z", cookie));
    expect(oldSince.status).toBe(400);
    expect((await bodyOf<{ error: { code: string } }>(oldSince)).error.code).toBe("SYNC_CURSOR_INVALID");

    const malformed = await pullRoute(getRequest("http://localhost/api/sync/pull?cursor=not-a-cursor", cookie));
    expect(malformed.status).toBe(400);
    expect((await bodyOf<{ error: { code: string } }>(malformed)).error.code).toBe("SYNC_CURSOR_INVALID");
  });
});
