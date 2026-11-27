/**
 * R5.4 web integracija: ACCOUNTANT read-only, revise append-only, attachment size.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { GET as listRoute, POST as createRoute } from "@/app/api/machine-daily-checks/route";
import { POST as reviseRoute } from "@/app/api/machine-daily-checks/[id]/revise/route";
import { POST as attachmentsPost } from "@/app/api/machine-daily-checks/[id]/attachments/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";
import { MAX_ATTACHMENT_BYTES } from "./storage";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_r54_${RUN}`;
const USER_OWNER = `usr_r54_o_${RUN}`;
const USER_ACCT = `usr_r54_a_${RUN}`;
const USER_OP = `usr_r54_op_${RUN}`;
const WORKER = `wrk_r54_${RUN}`;
const MACHINE = `mch_r54_${RUN}`;
const CHECK = `mdc_r54_${RUN}`;

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

describeDb("R5.4 daily check web API", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cookieOwner = "";
  let cookieAcct = "";
  let cookieOp = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'R54 Web', $2)`, [COMPANY, `r54-${RUN}`]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $3, 'O', 'wner', 'x', false), ($2, $4, 'A', 'cct', 'x', false), ($5, $6, 'O', 'p', 'x', false)`,
      [
        USER_OWNER, USER_ACCT, `owner-r54-${RUN}@test.example`, `acct-r54-${RUN}@test.example`,
        USER_OP, `op-r54-${RUN}@test.example`,
      ],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
                ($4, $5, $3, ARRAY['ACCOUNTANT']::"Role"[], 'COMPANY'),
                ($6, $7, $3, ARRAY['MACHINE_OPERATOR']::"Role"[], 'COMPANY')`,
        [`mem_o_${RUN}`, USER_OWNER, COMPANY, `mem_a_${RUN}`, USER_ACCT, `mem_op_${RUN}`, USER_OP],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1, $2, 'R', 'Ukovalac', '2024-01-01'::date, $3)`,
        [WORKER, COMPANY, USER_OP],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1, $2, 'BAG-54', 'Bager test', $2 || '_cat_excavator')`,
        [MACHINE, COMPANY],
      );
      await client.query(
        `INSERT INTO machine_daily_checks
           (id, company_id, machine_id, worker_id, checked_at, result, created_by, updated_by)
         VALUES ($1,$2,$3,$4,'2026-11-19T07:00:00Z','PASS',$5,$5)`,
        [CHECK, COMPANY, MACHINE, WORKER, USER_OWNER],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
    cookieOp = await signIn(USER_OP);
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM attachments WHERE entity_type = 'MACHINE_DAILY_CHECK' AND company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_daily_check_revisions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_daily_checks WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM sessions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machines WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM workers WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [COMPANY]);
    });
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_OWNER, USER_ACCT, USER_OP]]);
    await admin.end();
  });

  it("ACCOUNTANT može listu ali ne može kreirati unos", async () => {
    const list = await listRoute(new NextRequest("http://localhost/api/machine-daily-checks", {
      headers: { cookie: cookieAcct },
    }));
    expect(list.status).toBe(200);
    const create = await createRoute(new NextRequest("http://localhost/api/machine-daily-checks", {
      method: "POST",
      headers: { cookie: cookieAcct, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        checkedAt: "2026-11-19T08:00:00+01:00",
        result: "PASS",
      }),
    }));
    expect(create.status).toBe(403);
  });

  it("OPERATOR može kreirati; OWNER revise append-only", async () => {
    const create = await createRoute(new NextRequest("http://localhost/api/machine-daily-checks", {
      method: "POST",
      headers: { cookie: cookieOp, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        checkedAt: "2026-11-19T08:30:00+01:00",
        result: "CONDITIONAL",
        note: "Ulje na granici",
      }),
    }));
    expect(create.status).toBe(200);
    const revise = await reviseRoute(
      new NextRequest(`http://localhost/api/machine-daily-checks/${CHECK}/revise`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({ reason: "Ispravka napomene zbog greške.", payload: { note: "ok" } }),
      }),
      { params: Promise.resolve({ id: CHECK }) },
    );
    expect(revise.status).toBe(200);
  });

  it("attachment size > MAX → odbijeno", async () => {
    const response = await attachmentsPost(
      new NextRequest(`http://localhost/api/machine-daily-checks/${CHECK}/attachments`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "veliki.jpg",
          sizeBytes: MAX_ATTACHMENT_BYTES + 1,
          sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          headBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"),
        }),
      }),
      { params: Promise.resolve({ id: CHECK }) },
    );
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toMatch(/10 MB/i);
  });
});
