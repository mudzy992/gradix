/**
 * R5.1 web integracija: ACCOUNTANT read-only create, append-only revise.
 * Traži DATABASE_URL + DATABASE_ADMIN_URL; inače preskače.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { POST as createRoute, GET as listRoute } from "@/app/api/machine-work-logs/route";
import { POST as reviseRoute } from "@/app/api/machine-work-logs/[id]/revise/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_r51_${RUN}`;
const USER_OWNER = `usr_r51_o_${RUN}`;
const USER_ACCT = `usr_r51_a_${RUN}`;
const WORKER = `wrk_r51_${RUN}`;
const MACHINE = `mch_r51_${RUN}`;
const LOG = `mwl_r51_${RUN}`;

async function signIn(userId: string): Promise<string> {
  const sessionId = `ses_${userId}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await withCompany(admin, companyId(COMPANY), async (client) => {
    await client.query(
      `INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [sessionId, COMPANY, userId, `hash_${sessionId}`],
    );
  });
  await admin.end();
  return `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: sessionId, companyId: COMPANY })}`;
}

describeDb("R5.1 machine work-log web API", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cookieOwner = "";
  let cookieAcct = "";

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO companies (id, name, slug) VALUES ($1, 'R51 Web', $2)`,
      [COMPANY, `r51-${RUN}`],
    );
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $3, 'O', 'wner', 'x', false), ($2, $4, 'A', 'cct', 'x', false)`,
      [USER_OWNER, USER_ACCT, `owner-r51-${RUN}@test.example`, `acct-r51-${RUN}@test.example`],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
                ($4, $5, $3, ARRAY['ACCOUNTANT']::"Role"[], 'COMPANY')`,
        [`mem_o_${RUN}`, USER_OWNER, COMPANY, `mem_a_${RUN}`, USER_ACCT],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1, $2, 'R', 'Owner', '2024-01-01'::date, $3)`,
        [WORKER, COMPANY, USER_OWNER],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1, $2, 'EX-01', 'Bager test', $2 || '_cat_excavator')`,
        [MACHINE, COMPANY],
      );
      await client.query(
        `INSERT INTO machine_work_logs
           (id, company_id, machine_id, worker_id, started_at, ended_at, mode, created_by, updated_by)
         VALUES ($1, $2, $3, $4, '2026-11-19T08:00:00Z', '2026-11-19T10:00:00Z', 'WORK', $5, $5)`,
        [LOG, COMPANY, MACHINE, WORKER, USER_OWNER],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
  }, 60_000);

  afterAll(async () => {
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_OWNER, USER_ACCT]]);
    await admin.end();
  });

  it("ACCOUNTANT može listu ali ne može kreirati unos", async () => {
    const list = await listRoute(new NextRequest("http://interni/api/machine-work-logs", {
      headers: { cookie: cookieAcct },
    }));
    expect(list.status).toBe(200);
    const denied = await createRoute(new NextRequest("http://interni/api/machine-work-logs", {
      method: "POST",
      headers: { cookie: cookieAcct, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        startedAt: "2026-11-19T08:00:00+01:00",
        endedAt: "2026-11-19T10:00:00+01:00",
        mode: "WORK",
      }),
    }));
    expect(denied.status).toBe(403);
  });

  it("revise je append-only — original log ostaje, revizija se dodaje", async () => {
    const before = await withCompany(admin, companyId(COMPANY), async (client) => {
      const log = await client.query<{ mode: string; version: number }>(
        "SELECT mode, version FROM machine_work_logs WHERE company_id = $1 AND id = $2",
        [COMPANY, LOG],
      );
      const revisions = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM machine_work_log_revisions WHERE company_id = $1 AND work_log_id = $2",
        [COMPANY, LOG],
      );
      return { mode: log.rows[0]?.mode, version: log.rows[0]?.version, revisions: Number(revisions.rows[0]?.n ?? 0) };
    });
    const revised = await reviseRoute(
      new NextRequest(`http://interni/api/machine-work-logs/${LOG}/revise`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Ispravka režima rada zbog greške unosa.",
          payload: { mode: "IDLE" },
        }),
      }),
      { params: Promise.resolve({ id: LOG }) },
    );
    expect(revised.status).toBe(200);
    const after = await withCompany(admin, companyId(COMPANY), async (client) => {
      const log = await client.query<{ mode: string; version: number }>(
        "SELECT mode, version FROM machine_work_logs WHERE company_id = $1 AND id = $2",
        [COMPANY, LOG],
      );
      const revisions = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM machine_work_log_revisions WHERE company_id = $1 AND work_log_id = $2",
        [COMPANY, LOG],
      );
      return { mode: log.rows[0]?.mode, version: log.rows[0]?.version, revisions: Number(revisions.rows[0]?.n ?? 0) };
    });
    expect(after.mode).toBe(before.mode);
    expect(after.version).toBe(before.version);
    expect(after.revisions).toBe(before.revisions + 1);
  });
});
