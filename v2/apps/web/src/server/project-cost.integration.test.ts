/**
 * R6.1 web: book twice → one row; no rate → VALIDATION; ACCOUNTANT cannot book.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { GET as listRoute } from "@/app/api/project-cost-entries/route";
import { POST as bookRoute } from "@/app/api/project-cost-entries/book/route";
import { POST as rateRoute } from "@/app/api/machine-cost-rates/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_r61w_${RUN}`;
const USER_OWNER = `usr_r61w_o_${RUN}`;
const USER_ACCT = `usr_r61w_a_${RUN}`;
const WORKER = `wrk_r61w_${RUN}`;
const MACHINE = `mch_r61w_${RUN}`;
const MACHINE_NO = `mch_r61w_n_${RUN}`;
const PROJECT = `prj_r61w_${RUN}`;
const LOG = `mwl_r61w_${RUN}`;
const LOG_NO = `mwl_r61w_n_${RUN}`;

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

describeDb("R6.1 project cost web API", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cookieOwner = "";
  let cookieAcct = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'R61 Web', $2)`, [COMPANY, `r61w-${RUN}`]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $3, 'O', 'wner', 'x', false), ($2, $4, 'A', 'cct', 'x', false)`,
      [USER_OWNER, USER_ACCT, `owner-r61w-${RUN}@test.example`, `acct-r61w-${RUN}@test.example`],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
                ($4, $5, $3, ARRAY['ACCOUNTANT']::"Role"[], 'COMPANY')`,
        [`mem_o_${RUN}`, USER_OWNER, COMPANY, `mem_a_${RUN}`, USER_ACCT],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at)
         VALUES ($1, $2, 'R', 'Adnik', '2024-01-01'::date)`,
        [WORKER, COMPANY],
      );
      await client.query(
        `INSERT INTO projects (id, company_id, code, name)
         VALUES ($1, $2, 'R61', 'Projekat R61')`,
        [PROJECT, COMPANY],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1, $2, 'BAG-61', 'Bager', $2 || '_cat_excavator'),
                ($3, $2, 'BAG-NO', 'Bez stope', $2 || '_cat_excavator')`,
        [MACHINE, COMPANY, MACHINE_NO],
      );
      await client.query(
        `INSERT INTO machine_work_logs
           (id, company_id, machine_id, worker_id, project_id, started_at, ended_at, mode, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'2026-11-19T08:00:00Z','2026-11-19T10:00:00Z','WORK',$6,$6),
                ($7,$2,$8,$4,$5,'2026-11-19T11:00:00Z','2026-11-19T12:00:00Z','WORK',$6,$6)`,
        [LOG, COMPANY, MACHINE, WORKER, PROJECT, USER_OWNER, LOG_NO, MACHINE_NO],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM project_cost_entries WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_cost_rates WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_work_logs WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machines WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM projects WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM workers WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM sessions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [COMPANY]);
    });
    await admin.query("DELETE FROM users WHERE id = ANY($1::text[])", [[USER_OWNER, USER_ACCT]]);
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.end();
  });

  it("ACCOUNTANT ne smije knjižiti", async () => {
    const res = await bookRoute(new NextRequest("http://t/api/project-cost-entries/book", {
      method: "POST",
      headers: { cookie: cookieAcct, "content-type": "application/json" },
      body: JSON.stringify({ workLogIds: [LOG] }),
    }));
    expect(res.status).toBe(403);
  });

  it("bez stope → VALIDATION; s stopom knjiži jednom (idempotent)", async () => {
    const noRate = await bookRoute(new NextRequest("http://t/api/project-cost-entries/book", {
      method: "POST",
      headers: { cookie: cookieOwner, "content-type": "application/json" },
      body: JSON.stringify({ workLogIds: [LOG_NO] }),
    }));
    expect(noRate.status).toBe(400);
    const noRateBody = await noRate.json() as { error?: { code?: string }; code?: string };
    const code = noRateBody.error?.code ?? noRateBody.code;
    expect(code).toBe("VALIDATION_FAILED");

    const rate = await rateRoute(new NextRequest("http://t/api/machine-cost-rates", {
      method: "POST",
      headers: { cookie: cookieOwner, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        amount: "100.00",
        validFrom: "2026-01-01",
      }),
    }));
    expect(rate.status).toBe(200);

    const first = await bookRoute(new NextRequest("http://t/api/project-cost-entries/book", {
      method: "POST",
      headers: { cookie: cookieOwner, "content-type": "application/json" },
      body: JSON.stringify({ workLogIds: [LOG] }),
    }));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { data: { outcome: string; booked: number } };
    expect(firstBody.data.outcome).toBe("OK");
    expect(firstBody.data.booked).toBe(1);

    const second = await bookRoute(new NextRequest("http://t/api/project-cost-entries/book", {
      method: "POST",
      headers: { cookie: cookieOwner, "content-type": "application/json" },
      body: JSON.stringify({ workLogIds: [LOG] }),
    }));
    expect(second.status).toBe(200);
    const secondBody = await second.json() as {
      data: { outcome: string; booked: number; skippedExisting: number };
    };
    expect(secondBody.data.booked).toBe(0);
    expect(secondBody.data.skippedExisting).toBe(1);

    const list = await listRoute(new NextRequest("http://t/api/project-cost-entries", {
      headers: { cookie: cookieOwner },
    }));
    const listBody = await list.json() as { data: { entries: Array<{ source_id: string }> } };
    expect(listBody.data.entries.filter((e) => e.source_id === LOG)).toHaveLength(1);
  });
});
