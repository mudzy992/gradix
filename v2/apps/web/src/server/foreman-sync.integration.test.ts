/**
 * R4 group-pull/push gate: a site supervisor sees only minimal worker identities whose R3
 * assignments overlap the supervisor's project assignment on the requested company work_date.
 * The same rule is enforced again at push time; a forged target worker/project is rejected.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { GET as foremanWorkersRoute } from "@/app/api/sync/foreman-workers/route";
import { GET as syncPullRoute } from "@/app/api/sync/pull/route";
import { POST as syncPushRoute } from "@/app/api/sync/push/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { setUserActive } from "./access-service";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const COMPANY = `cmp_foreman_${RUN}`;
const USER = `usr_foreman_${RUN}`;
const FOREMAN = `wrk_foreman_${RUN}`;
const TARGET = `wrk_target_${RUN}`;
const OUTSIDE = `wrk_outside_${RUN}`;
const FUTURE = `wrk_future_${RUN}`;
const PROJECT = `prj_foreman_${RUN}`;
const OTHER_PROJECT = `prj_outside_${RUN}`;

function getRequest(url: string, cookie: string): NextRequest {
  return new NextRequest(url, { headers: { cookie } });
}

function postRequest(url: string, body: unknown, cookie: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { cookie, "content-type": "application/json" },
  });
}

describeDb("R4 SITE_SUPERVISOR roster and group push (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 4 });
  let workDate = "";
  let cookie = "";
  let visibleConflictId = "";

  beforeAll(async () => {
    await admin.query(
      "INSERT INTO public.companies (id, name, slug) VALUES ($1, 'Foreman sync test', $2)",
      [COMPANY, `foreman-${RUN}`],
    );
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, $2, 'test-hash', 'Sef', 'Test', false)`,
      [USER, `foreman-${RUN}@test.example`],
    );
    const date = await admin.query<{ work_date: string }>(
      `SELECT (clock_timestamp() AT TIME ZONE timezone)::date::text AS work_date
         FROM public.companies WHERE id = $1`,
      [COMPANY],
    );
    workDate = date.rows[0]!.work_date;

    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO public.workers (id, company_id, first_name, last_name, phone, email, hired_at, user_id)
         VALUES ($1, $4, 'Sef', 'Test', '+38760000001', 'foreman-private@test.example', $5::date, $6),
                ($2, $4, 'Radnik', 'UOpsegu', '+38760000002', 'target-private@test.example', $5::date, NULL),
                ($3, $4, 'Radnik', 'Izvan', '+38760000003', 'outside-private@test.example', $5::date, NULL),
                ($7, $4, 'Radnik', 'Buduci', '+38760000004', 'future-private@test.example', $5::date, NULL)`,
        [FOREMAN, TARGET, OUTSIDE, COMPANY, workDate, USER, FUTURE],
      );
      await client.query(
        `INSERT INTO public.projects (id, company_id, code, name)
         VALUES ($1, $3, $4, 'Foreman scoped project'), ($2, $3, $5, 'Out-of-scope project')`,
        [PROJECT, OTHER_PROJECT, COMPANY, `F-${RUN}`, `O-${RUN}`],
      );
      await client.query(
        `INSERT INTO public.project_assignments
           (id, company_id, project_id, worker_id, from_date, to_date, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $5::date, $6),
                ($7, $2, $3, $8, $5::date, $5::date, $6),
                ($9, $2, $10, $11, $5::date, $5::date, $6),
                ($12, $2, $3, $13, ($5::date + 1), NULL, $6)`,
        [
          `pas_foreman_${RUN}`, COMPANY, PROJECT, FOREMAN, workDate, USER,
          `pas_target_${RUN}`, TARGET,
          `pas_outside_${RUN}`, OTHER_PROJECT, OUTSIDE,
          `pas_future_${RUN}`, FUTURE,
        ],
      );
      await client.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['SITE_SUPERVISOR']::"Role"[], 'PROJECTS')`,
        [`mem_foreman_${RUN}`, USER, COMPANY],
      );
      await client.query(
        `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, clock_timestamp() + interval '1 day')`,
        [`ses_foreman_${RUN}`, COMPANY, USER, `hash_foreman_${RUN}`],
      );
    });
    cookie = `${ACCESS_COOKIE}=${issueAccessToken({
      sub: USER,
      sid: `ses_foreman_${RUN}`,
      companyId: COMPANY,
    })}`;
  }, 60_000);

  it("pull vraća samo ime i ID radnika dodijeljenih šefu na projektu i work_date", async () => {
    const response = await foremanWorkersRoute(getRequest(
      `http://interni/api/sync/foreman-workers?projectId=${PROJECT}&workDate=${workDate}`,
      cookie,
    ));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      success: boolean;
      data: { workDate: string; workers: { id: string; name: string }[] };
    };
    expect(body.data.workDate).toBe(workDate);
    expect(body.data.workers).toEqual([
      { id: TARGET, name: "Radnik UOpsegu" },
      { id: FOREMAN, name: "Sef Test" },
    ]);
    expect(body.data.workers.every((worker) => Object.keys(worker).sort().join(",") === "id,name")).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("+38760000001");
    expect(serialized).not.toContain("foreman-private@test.example");
    expect(serialized).not.toContain("+38760000002");
    expect(serialized).not.toContain("target-private@test.example");
    expect(serialized).not.toContain(OUTSIDE);
    expect(serialized).not.toContain(FUTURE);
  });

  it("šef ne može pullati projekat van svog R3 opsega", async () => {
    const response = await foremanWorkersRoute(getRequest(
      `http://interni/api/sync/foreman-workers?projectId=${OTHER_PROJECT}&workDate=${workDate}`,
      cookie,
    ));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  });

  it("offline grupni push upisuje samo dodijeljenog radnika; forged out-of-scope target is rejected", async () => {
    const makeItem = (workerId: string, projectId: string, workEntryId: string) => ({
      localId: randomUUID(),
      entityType: "work_entry" as const,
      workerId,
      workdayId: randomUUID(),
      workEntryId,
      deviceSentAt: new Date().toISOString(),
      entry: {
        kind: "WORK" as const,
        startedAt: `${workDate}T08:00:00+00:00`,
        endedAt: `${workDate}T09:00:00+00:00`,
        endState: "KNOWN_END" as const,
        projectId,
        machineId: null,
        note: null,
      },
    });
    const allowedEntry = randomUUID();
    const forbiddenEntry = randomUUID();
    const futureEntry = randomUUID();
    const response = await syncPushRoute(postRequest("http://interni/api/sync/push", {
      items: [
        makeItem(TARGET, PROJECT, allowedEntry),
        makeItem(OUTSIDE, OTHER_PROJECT, forbiddenEntry),
        makeItem(FUTURE, PROJECT, futureEntry),
      ],
    }, cookie));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      success: boolean;
      data: { results: { localId: string; status: string; code?: string; entityId?: string | null }[] };
    };
    expect(body.data.results.map((result) => [result.status, result.code])).toEqual([
      ["APPLIED", undefined],
      ["REJECTED", "FOREMAN_SCOPE_FORBIDDEN"],
      ["REJECTED", "FOREMAN_SCOPE_FORBIDDEN"],
    ]);

    const rows = await admin.query<{ id: string; worker_id: string; created_by: string }>(
      `SELECT id, worker_id, created_by FROM public.work_entries
        WHERE company_id = $1 AND id = ANY($2::text[]) ORDER BY id`,
      [COMPANY, [allowedEntry, forbiddenEntry, futureEntry]],
    );
    expect(rows.rows).toEqual([{ id: allowedEntry, worker_id: TARGET, created_by: USER }]);

    const hiddenEntry = randomUUID();
    const hiddenWorkday = randomUUID();
    const hiddenStartedAt = `${workDate}T10:00:00+00:00`;
    const hiddenEndedAt = `${workDate}T11:00:00+00:00`;
    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO public.workdays
           (id, company_id, worker_id, work_date, status, header_version, created_by, updated_by)
         VALUES ($1, $2, $3, $4::date, 'DRAFT', 1, $5, $5)`,
        [hiddenWorkday, COMPANY, OUTSIDE, workDate, USER],
      );
      await client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state,
            project_id, machine_id, note, version, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'WORK', $5::timestamptz, $6::timestamptz, 'KNOWN_END',
                 $7, NULL, 'ne smije se vratiti', 1, $8, $8)`,
        [hiddenEntry, COMPANY, hiddenWorkday, OUTSIDE, hiddenStartedAt, hiddenEndedAt, OTHER_PROJECT, USER],
      );
      const reservation = await client.query<{ seq: string }>(
        "SELECT public.sync_cursor_reserve($1, $2, 300)::text AS seq",
        [COMPANY, `foreman-hidden-${RUN}`],
      );
      await client.query(
        `SELECT public.sync_cursor_publish(
           $1, $2::bigint, $3, $4, 'work_entry', $5, 1, $6::jsonb, false
         )`,
        [COMPANY, reservation.rows[0]!.seq, `foreman-hidden-${RUN}`, "f".repeat(64), hiddenEntry,
          JSON.stringify({
            id: hiddenEntry,
            workdayId: hiddenWorkday,
            workerId: OUTSIDE,
            workerName: "Radnik Izvan",
            workDate,
            kind: "WORK",
            projectId: OTHER_PROJECT,
            startedAt: hiddenStartedAt,
            endedAt: hiddenEndedAt,
            endState: "KNOWN_END",
            machineId: null,
            note: "ne smije se vratiti",
            reviewFlags: [],
            version: 1,
          })],
      );

      const tombstoneReservation = await client.query<{ seq: string }>(
        "SELECT public.sync_cursor_reserve($1, $2, 300)::text AS seq",
        [COMPANY, `foreman-tombstone-${RUN}`],
      );
      await client.query(
        `SELECT public.sync_cursor_publish(
           $1, $2::bigint, $3, $4, 'work_entry', $5, 2, NULL, true
         )`,
        [COMPANY, tombstoneReservation.rows[0]!.seq, `foreman-tombstone-${RUN}`, "e".repeat(64), allowedEntry],
      );

      const conflictId = randomUUID();
      visibleConflictId = conflictId;
      const receivedPayload = {
        kind: "WORK",
        startedAt: `${workDate}T12:00:00+00:00`,
        endedAt: `${workDate}T13:00:00+00:00`,
        endState: "KNOWN_END",
        projectId: PROJECT,
        machineId: null,
        note: "conflict payload",
      };
      await client.query(
        `INSERT INTO public.sync_conflicts
           (id, company_id, actor_id, local_id, received_payload, payload_hash, server_version)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 1)`,
        [conflictId, COMPANY, USER, `local-conflict-${RUN}`, JSON.stringify(receivedPayload), "c".repeat(64)],
      );
      const conflictReservation = await client.query<{ seq: string }>(
        "SELECT public.sync_cursor_reserve($1, $2, 300)::text AS seq",
        [COMPANY, `foreman-conflict-${RUN}`],
      );
      await client.query(
        `SELECT public.sync_cursor_publish(
           $1, $2::bigint, $3, $4, 'sync_conflict', $5, 1, $6::jsonb, false
         )`,
        [COMPANY, conflictReservation.rows[0]!.seq, `foreman-conflict-${RUN}`, "c".repeat(64), conflictId,
          JSON.stringify({
            id: conflictId,
            localId: `local-conflict-${RUN}`,
            workEntryId: null,
            workerId: TARGET,
            workerName: "Radnik UOpsegu",
            workDate,
            reason: "SYNC_VERSION_CONFLICT",
            receivedPayload,
            serverVersion: 1,
          })],
      );
    });

    const pulled = await syncPullRoute(getRequest("http://interni/api/sync/pull", cookie));
    expect(pulled.status).toBe(200);
    const pullBody = await pulled.json() as {
      success: boolean;
      data: { events: { entityId: string; entityType: string; payload: Record<string, unknown> | null }[] };
    };
    // Pull garantuje opseg i skup vidljivih događaja, ne redoslijed tipova u stranici.
    expect(pullBody.data.events.map((event) => event.entityType).sort())
      .toEqual(["work_entry", "workday", "sync_conflict"].sort());
    expect(new Set(pullBody.data.events.map((event) => event.entityId))).toEqual(new Set([
      body.data.results[0]!.entityId,
      allowedEntry,
      visibleConflictId,
    ]));
    expect(pullBody.data.events.every((event) => !JSON.stringify(event.payload).match(/phone|email/i))).toBe(true);
    expect(JSON.stringify(pullBody)).not.toContain(OUTSIDE);
    expect(JSON.stringify(pullBody)).not.toContain("ne smije se vratiti");
  });
  it("izgubljen telefon: administratorski opoziv sesije zaustavlja push i pull tog uređaja (401)", async () => {
    const adminUser = `usr_admin_${RUN}`;
    // users je posebno RLS-zaštićena tabela: admin fixture ide admin konekcijom, kao u beforeAll.
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, $2, 'test-hash', 'Admin', 'Test', false)`,
      [adminUser, `admin-${RUN}@test.example`],
    );
    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY')`,
        [`mem_admin_${RUN}`, adminUser, COMPANY],
      );
    });

    const before = await syncPullRoute(getRequest("http://interni/api/sync/pull?limit=10", cookie));
    expect(before.status).toBe(200);

    // Administrator gasi nalog/sesije izgubljenog telefona (ista serverska putanja kao UI deaktivacija).
    const revoked = await setUserActive(app, companyId(COMPANY), { userId: adminUser, roles: ["OWNER"] }, USER, false);
    expect(revoked).toMatchObject({ ok: true });
    if ("ok" in revoked) expect(revoked.revokedSessions).toBeGreaterThanOrEqual(1);

    const pullAfter = await syncPullRoute(getRequest("http://interni/api/sync/pull?limit=10", cookie));
    expect(pullAfter.status).toBe(401);
    expect(await pullAfter.json()).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });

    const pushAfter = await syncPushRoute(postRequest("http://interni/api/sync/push", { items: [] }, cookie));
    expect(pushAfter.status).toBe(401);
    expect(await pushAfter.json()).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
  });

  afterAll(async () => {
    await app.end();
    await admin.end();
  });


});
