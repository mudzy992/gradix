/**
 * R5.1 web integracija: ACCOUNTANT read-only create, append-only revise.
 * Traži DATABASE_URL + DATABASE_ADMIN_URL; inače preskače.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { POST as createRoute, GET as listRoute } from "@/app/api/machine-work-logs/route";
import { POST as reviseRoute } from "@/app/api/machine-work-logs/[id]/revise/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_r51_web";
const USER_OWNER = "usr_r51_owner";
const USER_ACCT = "usr_r51_acct";
const WORKER = "wrk_r51_owner";
const MACHINE = "mch_r51_web";
const LOG = "mwl_r51_web";

async function signIn(userId: string): Promise<string> {
  const sessionId = `ses_${userId}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await withCompany(admin, companyId(COMPANY), async (client) => {
    await client.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    await client.query(
      "INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + interval '1 day')",
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
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_OWNER, USER_ACCT]]);
    await admin.query(
      "INSERT INTO companies (id, name, slug, timezone) VALUES ($1, 'R51 Web', 'r51-web', 'Europe/Sarajevo')",
      [COMPANY],
    );
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, is_active)
       VALUES ($1, 'owner-r51@local.test', 'O', 'wner', 'x', true), ($2, 'acct-r51@local.test', 'A', 'cct', 'x', true)`,
      [USER_OWNER, USER_ACCT],
    );
    await admin.query(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'OWNER'), ($1, $3, 'ACCOUNTANT')`,
      [COMPANY, USER_OWNER, USER_ACCT],
    );
    await admin.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, is_active, user_id)
       VALUES ($1, $2, 'R', 'Owner', true, $3)`,
      [WORKER, COMPANY, USER_OWNER],
    );
    const categoryId = `cat_${COMPANY}`;
    await admin.query(
      `INSERT INTO equipment_categories (id, company_id, name, meter_kind, sort_order)
       VALUES ($1, $2, 'Građevinske', 'HOURS', 1)
       ON CONFLICT DO NOTHING`,
      [categoryId, COMPANY],
    );
    await admin.query(
      `INSERT INTO machines (id, company_id, code, name, category_id, is_active)
       VALUES ($1, $2, 'EX-01', 'Bager test', $3, true)`,
      [MACHINE, COMPANY, categoryId],
    );
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
  }, 60_000);

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
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM machine_work_log_revisions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_work_logs WHERE company_id = $1", [COMPANY]);
      await client.query(
        `INSERT INTO machine_work_logs
           (id, company_id, machine_id, worker_id, started_at, ended_at, mode, created_by, updated_by)
         VALUES ($1, $2, $3, $4, '2026-11-19T08:00:00Z', '2026-11-19T10:00:00Z', 'WORK', $5, $5)`,
        [LOG, COMPANY, MACHINE, WORKER, USER_OWNER],
      );
    });
    const res = await reviseRoute(
      new NextRequest(`http://interni/api/machine-work-logs/${LOG}/revise`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({ reason: "Ispravka test zapisa", payload: { note: "nova napomena" } }),
      }),
      { params: Promise.resolve({ id: LOG }) },
    );
    expect(res.status).toBe(200);
    const rows = await admin.query<{ version: number; revisions: string }>(
      `SELECT mwl.version::text,
              (SELECT count(*)::text FROM machine_work_log_revisions r WHERE r.work_log_id = mwl.id) AS revisions
         FROM machine_work_logs mwl WHERE mwl.id = $1`,
      [LOG],
    );
    expect(Number(rows.rows[0]?.revisions ?? 0)).toBe(1);
    expect(Number(rows.rows[0]?.version ?? 0)).toBe(1);
  });
});