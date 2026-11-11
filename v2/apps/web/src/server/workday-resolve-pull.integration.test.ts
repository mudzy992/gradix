/**
 * R4a-2 korak 2c: ishod razrješenja kroz pravi pull endpoint.
 * Radnik (autor primljenog unosa) i šef (autor server unosa / opseg) dobijaju
 * ishod tačno jednom (cursor), bez interne napomene; radnik čiji je server
 * unos odbačen vidi ishod iako nije pošiljalac primljenog unosa.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId } from "@gradix/db";
import { GET as pullRoute } from "@/app/api/sync/pull/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { resolveWorkdayConflict, type ResolveActor } from "./workday-resolve";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_pll_${RUN}`;
const HASH = "b".repeat(64);
const INTERNAL = `INTERNA-PULL-${RUN}`;
const reason = "Dupli unos istog segmenta s telefona";

const adminActor: ResolveActor = {
  userId: `usr_pll_admin_${RUN}`, companyId: companyId(CO), roles: ["ADMIN"], email: "a@test.example",
};

async function pullAs(userId: string, sessionId: string, cursor?: string) {
  const cookie = `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: sessionId, companyId: CO })}`;
  const url = `http://interni/api/sync/pull${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const response = await pullRoute(new NextRequest(url, { headers: { cookie } }));
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: { events: { entityType: string; entityId: string; payload: Record<string, unknown> | null }[]; cursor: string };
  };
  return body.data;
}

async function seedConflict(admin: Pool, suffix: string, date: string, actorUser: string): Promise<string> {
  await admin.query(
    `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
     VALUES ('wd_pll_${suffix}_${RUN}', $1, 'wrk_pll_worker_${RUN}', $2::date, 'DRAFT', 'usr_pll_foreman_${RUN}', 'usr_pll_foreman_${RUN}')`,
    [CO, date],
  );
  await admin.query(
    `INSERT INTO public.work_entries
       (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
     VALUES ('we_pll_${suffix}_${RUN}', $1, 'wd_pll_${suffix}_${RUN}', 'wrk_pll_worker_${RUN}', 'WORK',
             ($2 || 'T07:30:00Z')::timestamptz, ($2 || 'T15:30:00Z')::timestamptz, 'KNOWN_END', 'prj_pll_a_${RUN}',
             'usr_pll_foreman_${RUN}', 'usr_pll_foreman_${RUN}')`,
    [CO, date],
  );
  await admin.query(
    `INSERT INTO public.sync_conflicts
       (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version)
     VALUES ('cnf_pll_${suffix}_${RUN}', $1, $3, 'local-pll-${suffix}-${RUN}', 'we_pll_${suffix}_${RUN}', $2::jsonb, $4, 1)`,
    [CO, JSON.stringify({ kind: "WORK", startedAt: `${date}T08:00:00Z`, endedAt: `${date}T16:00:00Z`, endState: "KNOWN_END", projectId: `prj_pll_a_${RUN}`, machineId: null, note: null }), actorUser, HASH],
  );
  return `cnf_pll_${suffix}_${RUN}`;
}

describeDb("R4a-2 pull ishoda (PostgreSQL + ruta)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 4 });

  beforeAll(async () => {
    await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'PLL test', $2)", [CO, `pll-${RUN}`]);
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ('usr_pll_admin_${RUN}', 'admin-${RUN}@test.example', 'x', 'Amina', 'Karić', false),
              ('usr_pll_worker_${RUN}', 'worker-${RUN}@test.example', 'x', 'Amar', 'Hadžić', false),
              ('usr_pll_foreman_${RUN}', 'foreman-${RUN}@test.example', 'x', 'Mario', 'Perić', false)`,
    );
    for (const [user, role] of [[`usr_pll_admin_${RUN}`, "ADMIN"], [`usr_pll_worker_${RUN}`, "WORKER"], [`usr_pll_foreman_${RUN}`, "SITE_SUPERVISOR"]] as const) {
      await admin.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY[$4]::"Role"[], 'COMPANY')`,
        [`mem_${user}`, user, CO, role],
      );
      await admin.query(
        `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, 'hash', clock_timestamp() + interval '1 day')`,
        [`ses_${user}`, CO, user],
      );
    }
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id, hired_at)
       VALUES ('wrk_pll_worker_${RUN}', $1, 'Amar', 'Hadžić', 'usr_pll_worker_${RUN}', '2024-01-01'),
              ('wrk_pll_foreman_${RUN}', $1, 'Mario', 'Perić', 'usr_pll_foreman_${RUN}', '2024-01-01')`,
      [CO],
    );
    await admin.query(
      "INSERT INTO public.projects (id, company_id, code, name) VALUES ('prj_pll_a_${RUN}', $1, 'A-${RUN}', 'A')",
      [CO],
    );
    await admin.query(
      `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date)
       VALUES ('pas_pll_w_${RUN}', $1, 'prj_pll_a_${RUN}', 'wrk_pll_worker_${RUN}', '2026-01-01'),
              ('pas_pll_f_${RUN}', $1, 'prj_pll_a_${RUN}', 'wrk_pll_foreman_${RUN}', '2026-01-01')`,
      [CO],
    );
  }, 60_000);

  afterAll(async () => { await admin.end(); await app.end(); });

  it("radnik i šef dobiju ishod tačno jednom, bez interne napomene", async () => {
    const conflictId = await seedConflict(admin, "one", "2026-11-10", `usr_pll_worker_${RUN}`);
    const resolved = await resolveWorkdayConflict(app, adminActor, {
      conflictId, kind: "ACCEPT_SERVER", reason, internalNote: INTERNAL, idempotencyKey: `key-pll-1-${RUN}`,
    });
    expect(resolved.outcome).toBe("RESOLVED");

    // Radnik (autor primljenog unosa): ishod stiže pull-om.
    const first = await pullAs(`usr_pll_worker_${RUN}`, `ses_usr_pll_worker_${RUN}`);
    const outcomes = first.events.filter((e) => e.entityType === "sync_conflict" && e.entityId === conflictId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.payload).toMatchObject({ status: "RESOLVED", kind: "ACCEPT_SERVER", reason });
    expect(JSON.stringify(outcomes[0]!.payload)).not.toContain(INTERNAL);
    expect(outcomes[0]!.payload).toMatchObject({ localId: `local-pll-one-${RUN}`, workerId: `wrk_pll_worker_${RUN}`, workDate: "2026-11-10" });

    // Tačno jednom: sljedeći pull od kursora prvog nema taj događaj.
    const second = await pullAs(`usr_pll_worker_${RUN}`, `ses_usr_pll_worker_${RUN}`, first.cursor);
    expect(second.events.filter((e) => e.entityId === conflictId)).toHaveLength(0);

    // Šef (autor server unosa, u opsegu): isti ishod, sanitizovan payload.
    const foremanPage = await pullAs(`usr_pll_foreman_${RUN}`, `ses_usr_pll_foreman_${RUN}`);
    const foremanOutcomes = foremanPage.events.filter((e) => e.entityType === "sync_conflict" && e.entityId === conflictId);
    expect(foremanOutcomes).toHaveLength(1);
    expect(foremanOutcomes[0]!.payload).toMatchObject({ status: "RESOLVED", kind: "ACCEPT_SERVER", reason });
    const serialized = JSON.stringify(foremanOutcomes[0]!.payload);
    expect(serialized).not.toContain(INTERNAL);
    expect(serialized).not.toContain("resolvedByParty");
  });

  it("radnik čiji je server unos odbačen vidi ishod iako nije pošiljalac", async () => {
    // Primljeni unos je poslao šef za radnika; server unos (istog radnika) biva odbačen.
    const conflictId = await seedConflict(admin, "two", "2026-11-11", `usr_pll_foreman_${RUN}`);
    const resolved = await resolveWorkdayConflict(app, adminActor, {
      conflictId, kind: "ACCEPT_RECEIVED", reason, internalNote: INTERNAL, idempotencyKey: `key-pll-2-${RUN}`,
    });
    expect(resolved.outcome).toBe("RESOLVED");

    const page = await pullAs(`usr_pll_worker_${RUN}`, `ses_usr_pll_worker_${RUN}`);
    const outcomes = page.events.filter((e) => e.entityType === "sync_conflict" && e.entityId === conflictId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.payload).toMatchObject({ status: "RESOLVED", kind: "ACCEPT_RECEIVED", reason });
    expect(JSON.stringify(outcomes[0]!.payload)).not.toContain(INTERNAL);
  });
});
