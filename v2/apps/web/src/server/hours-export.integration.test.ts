/** R6.2: CSV export LOCKED/CONFIRMED only; ACCOUNTANT ok; WORKER 403. */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { GET as hoursExportGet } from "@/app/api/workdays/hours-export/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_r62_${RUN}`;
const USER_OWNER = `usr_r62_o_${RUN}`;
const USER_ACCT = `usr_r62_a_${RUN}`;
const USER_WORKER = `usr_r62_w_${RUN}`;
const WORKER = `wrk_r62_${RUN}`;
const PROJECT = `prj_r62_${RUN}`;
const WD_LOCKED = `wd_r62_l_${RUN}`;
const WD_SUB = `wd_r62_s_${RUN}`;
const WE_LOCKED = `we_r62_l_${RUN}`;
const WE_SUB = `we_r62_s_${RUN}`;

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

describeDb("R6.2 hours export API", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cookieOwner = "";
  let cookieAcct = "";
  let cookieWorker = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'R62', $2)`, [COMPANY, `r62-${RUN}`]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1,$4,'O','wner','x',false), ($2,$5,'A','cct','x',false), ($3,$6,'W','ork','x',false)`,
      [
        USER_OWNER, USER_ACCT, USER_WORKER,
        `owner-r62-${RUN}@test.example`, `acct-r62-${RUN}@test.example`, `wrk-r62-${RUN}@test.example`,
      ],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY'),
                ($4,$5,$3,ARRAY['ACCOUNTANT']::"Role"[],'COMPANY'),
                ($6,$7,$3,ARRAY['WORKER']::"Role"[],'SELF')`,
        [`mem_o_${RUN}`, USER_OWNER, COMPANY, `mem_a_${RUN}`, USER_ACCT, `mem_w_${RUN}`, USER_WORKER],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at)
         VALUES ($1,$2,'Amar','Hadžić','2024-01-01'::date)`,
        [WORKER, COMPANY],
      );
      await client.query(
        `INSERT INTO projects (id, company_id, code, name) VALUES ($1,$2,'R62','Projekat R62')`,
        [PROJECT, COMPANY],
      );
      await client.query(
        `INSERT INTO workdays
           (id, company_id, worker_id, work_date, status, approval_status, created_by, updated_by)
         VALUES ($1,$3,$4,'2026-11-10'::date,'SUBMITTED','LOCKED',$5,$5),
                ($2,$3,$4,'2026-11-11'::date,'SUBMITTED','SUBMITTED',$5,$5)`,
        [WD_LOCKED, WD_SUB, COMPANY, WORKER, USER_OWNER],
      );
      await client.query(
        `INSERT INTO work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
         VALUES
           ($1,$3,$4,$5,'WORK','2026-11-10T07:00:00Z','2026-11-10T15:00:00Z','KNOWN_END',$6,$7,$7),
           ($2,$3,$8,$5,'WORK','2026-11-11T07:00:00Z','2026-11-11T15:00:00Z','KNOWN_END',$6,$7,$7)`,
        [WE_LOCKED, WE_SUB, COMPANY, WD_LOCKED, WORKER, PROJECT, USER_OWNER, WD_SUB],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
    cookieWorker = await signIn(USER_WORKER);
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM work_entries WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM workdays WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM projects WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM workers WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM sessions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [COMPANY]);
    });
    await admin.query("DELETE FROM users WHERE id = ANY($1::text[])", [[USER_OWNER, USER_ACCT, USER_WORKER]]);
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.end();
  }, 60_000);

  it("OWNER CSV sadrži LOCKED, ne SUBMITTED", async () => {
    const res = await hoursExportGet(
      new NextRequest("http://localhost/api/workdays/hours-export?from=2026-11-01&to=2026-11-30", {
        headers: { cookie: cookieOwner },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("LOCKED");
    expect(text).toContain("Amar Hadžić");
    expect(text).toContain("8.000");
    expect(text).not.toContain("2026-11-11");
  });

  it("ACCOUNTANT smije izvoziti", async () => {
    const res = await hoursExportGet(
      new NextRequest("http://localhost/api/workdays/hours-export?from=2026-11-01&to=2026-11-30", {
        headers: { cookie: cookieAcct },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("LOCKED");
  });

  it("WORKER dobija 403", async () => {
    const res = await hoursExportGet(
      new NextRequest("http://localhost/api/workdays/hours-export?from=2026-11-01&to=2026-11-30", {
        headers: { cookie: cookieWorker },
      }),
    );
    expect(res.status).toBe(403);
  });
});
