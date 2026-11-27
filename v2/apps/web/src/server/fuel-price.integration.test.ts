import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { POST as priceRoute } from "@/app/api/fuel-entries/[id]/price/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_r52p_${RUN}`;
const USER_OWNER = `usr_r52p_o_${RUN}`;
const USER_ACCT = `usr_r52p_a_${RUN}`;
const USER_DRIVER = `usr_r52p_d_${RUN}`;
const WORKER = `wrk_r52p_${RUN}`;
const MACHINE = `mch_r52p_${RUN}`;
const ENTRY = `fuel_r52p_${RUN}`;

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

function priceRequest(cookie: string, totalAmount: string): NextRequest {
  return new NextRequest(`http://interni/api/fuel-entries/${ENTRY}/price`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ totalAmount }),
  });
}

describeDb("R5.2 fuel unknown amount can be priced later", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cookieOwner = "";
  let cookieAcct = "";
  let cookieDriver = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'R52 Price', $2)`, [COMPANY, `r52p-${RUN}`]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $3, 'O', 'wner', 'x', false), ($2, $4, 'A', 'cct', 'x', false), ($5, $6, 'D', 'river', 'x', false)`,
      [USER_OWNER, USER_ACCT, `owner-r52p-${RUN}@test.example`, `acct-r52p-${RUN}@test.example`, USER_DRIVER, `driver-r52p-${RUN}@test.example`],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
                ($4, $5, $3, ARRAY['ACCOUNTANT']::"Role"[], 'COMPANY'),
                ($6, $7, $3, ARRAY['DRIVER']::"Role"[], 'COMPANY')`,
        [`mem_po_${RUN}`, USER_OWNER, COMPANY, `mem_pa_${RUN}`, USER_ACCT, `mem_pd_${RUN}`, USER_DRIVER],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1, $2, 'D', 'River', '2024-01-01'::date, $3)`,
        [WORKER, COMPANY, USER_DRIVER],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1, $2, 'KAM-P', 'Kamion cijena', $2 || '_cat_truck')`,
        [MACHINE, COMPANY],
      );
      await client.query(
        `INSERT INTO fuel_entries
           (id, company_id, machine_id, driver_worker_id, filled_at, liters,
            amount_cents, currency_code, created_by, updated_by)
         VALUES ($1, $2, $3, $4, '2026-11-19T08:00:00Z', 12, NULL, 'BAM', $5, $5)`,
        [ENTRY, COMPANY, MACHINE, WORKER, USER_DRIVER],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
    cookieDriver = await signIn(USER_DRIVER);
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM audit_events WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM fuel_entries WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM sessions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machines WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM workers WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [COMPANY]);
    });
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_OWNER, USER_ACCT, USER_DRIVER]]);
    await admin.end();
  });

  it("ured naknadno upisuje nepoznat iznos, vozač ne može", async () => {
    const denied = await priceRoute(priceRequest(cookieDriver, "0.00"), { params: Promise.resolve({ id: ENTRY }) });
    expect(denied.status).toBe(403);
    const negative = await priceRoute(priceRequest(cookieAcct, "-1.00"), { params: Promise.resolve({ id: ENTRY }) });
    expect(negative.status).toBe(400);
    const priced = await priceRoute(priceRequest(cookieAcct, "0.00"), { params: Promise.resolve({ id: ENTRY }) });
    expect(priced.status).toBe(200);
    const stored = await admin.query<{ amount_cents: string | null }>(
      `SELECT amount_cents::text FROM public.fuel_entries WHERE company_id = $1 AND id = $2`,
      [COMPANY, ENTRY],
    );
    expect(stored.rows[0]?.amount_cents).toBe("0");
    const again = await priceRoute(priceRequest(cookieOwner, "10.00"), { params: Promise.resolve({ id: ENTRY }) });
    expect(again.status).toBe(409);
    const still = await admin.query<{ amount_cents: string | null }>(
      `SELECT amount_cents::text FROM public.fuel_entries WHERE company_id = $1 AND id = $2`,
      [COMPANY, ENTRY],
    );
    expect(still.rows[0]?.amount_cents).toBe("0");
    const audit = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.audit_events
        WHERE company_id = $1 AND action = 'fuel.priced' AND entity_id = $2`,
      [COMPANY, ENTRY],
    );
    expect(audit.rows[0]?.n).toBe(1);
  });
});
