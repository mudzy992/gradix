import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { GET as listRoute, POST as createRoute } from "@/app/api/fuel-entries/route";
import { POST as reviseRoute } from "@/app/api/fuel-entries/[id]/revise/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_r52_${RUN}`;
const USER_OWNER = `usr_r52_o_${RUN}`;
const USER_ACCT = `usr_r52_a_${RUN}`;
const USER_DRIVER = `usr_r52_d_${RUN}`;
const WORKER = `wrk_r52_${RUN}`;
const MACHINE = `mch_r52_${RUN}`;
const ENTRY = `fuel_r52_${RUN}`;

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

describeDb("R5.2 fuel-entry web API", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cookieOwner = "";
  let cookieAcct = "";
  let cookieDriver = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'R52 Web', $2)`, [COMPANY, `r52-${RUN}`]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $3, 'O', 'wner', 'x', false), ($2, $4, 'A', 'cct', 'x', false), ($5, $6, 'D', 'river', 'x', false)`,
      [USER_OWNER, USER_ACCT, `owner-r52-${RUN}@test.example`, `acct-r52-${RUN}@test.example`, USER_DRIVER, `driver-r52-${RUN}@test.example`],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
                ($4, $5, $3, ARRAY['ACCOUNTANT']::"Role"[], 'COMPANY'),
                ($6, $7, $3, ARRAY['DRIVER']::"Role"[], 'COMPANY')`,
        [`mem_o_${RUN}`, USER_OWNER, COMPANY, `mem_a_${RUN}`, USER_ACCT, `mem_d_${RUN}`, USER_DRIVER],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1, $2, 'D', 'River', '2024-01-01'::date, $3)`,
        [WORKER, COMPANY, USER_DRIVER],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1, $2, 'KAM-01', 'Kamion test', $2 || '_cat_truck')`,
        [MACHINE, COMPANY],
      );
      await client.query(
        `INSERT INTO fuel_entries
           (id, company_id, machine_id, driver_worker_id, filled_at, liters,
            amount_cents, currency_code, created_by, updated_by)
         VALUES ($1, $2, $3, $4, '2026-11-19T08:00:00Z', 40.5, 8500, 'BAM', $5, $5)`,
        [ENTRY, COMPANY, MACHINE, WORKER, USER_OWNER],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
    cookieDriver = await signIn(USER_DRIVER);
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM fuel_entry_revisions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_meter_readings WHERE company_id = $1", [COMPANY]);
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

  it("ACCOUNTANT može listu ali ne može kreirati unos", async () => {
    const list = await listRoute(new NextRequest("http://interni/api/fuel-entries", { headers: { cookie: cookieAcct } }));
    expect(list.status).toBe(200);
    const body = await list.json() as { data: { entries: { amount: string | null }[] } };
    expect(body.data.entries[0]?.amount).toBe("85.00");
    const denied = await createRoute(new NextRequest("http://interni/api/fuel-entries", {
      method: "POST",
      headers: { cookie: cookieAcct, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        filledAt: "2026-11-19T08:00:00+01:00",
        liters: 10,
        totalAmount: "25.00",
      }),
    }));
    expect(denied.status).toBe(403);
  });

  it("DRIVER vidi zapis ali ne cijenu", async () => {
    const list = await listRoute(new NextRequest("http://interni/api/fuel-entries", { headers: { cookie: cookieDriver } }));
    expect(list.status).toBe(200);
    const body = await list.json() as { data: { entries: { amount: string | null; liters: number }[] } };
    expect(body.data.entries.length).toBeGreaterThan(0);
    expect(body.data.entries[0]?.amount).toBeNull();
    expect(body.data.entries[0]?.liters).toBe(40.5);
    const created = await createRoute(new NextRequest("http://interni/api/fuel-entries", {
      method: "POST",
      headers: { cookie: cookieDriver, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        filledAt: "2026-11-19T09:00:00+01:00",
        liters: 20,
      }),
    }));
    expect(created.status).toBe(200);
    const stored = await admin.query<{ amount_cents: string | null }>(
      `SELECT amount_cents::text FROM public.fuel_entries WHERE company_id = $1 AND liters = 20`,
      [COMPANY],
    );
    expect(stored.rows[0]?.amount_cents).toBeNull();
    for (const totalAmount of ["0.00", "50.00"]) {
      const denied = await createRoute(new NextRequest("http://interni/api/fuel-entries", {
        method: "POST",
        headers: { cookie: cookieDriver, "content-type": "application/json" },
        body: JSON.stringify({
          machineId: MACHINE, filledAt: "2026-11-19T10:00:00+01:00", liters: 21, totalAmount,
        }),
      }));
      expect(denied.status).toBe(400);
    }
  });

  it("ured unosi stvarnu nulu, a prazan iznos odbija", async () => {
    const zero = await createRoute(new NextRequest("http://interni/api/fuel-entries", {
      method: "POST",
      headers: { cookie: cookieOwner, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE, driverWorkerId: WORKER, filledAt: "2026-11-19T12:00:00+01:00",
        liters: 7, totalAmount: "0.00",
      }),
    }));
    expect(zero.status).toBe(200);
    const stored = await admin.query<{ amount_cents: string | null }>(
      `SELECT amount_cents::text FROM public.fuel_entries WHERE company_id = $1 AND liters = 7`,
      [COMPANY],
    );
    expect(stored.rows[0]?.amount_cents).toBe("0");
    const missing = await createRoute(new NextRequest("http://interni/api/fuel-entries", {
      method: "POST",
      headers: { cookie: cookieOwner, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE, driverWorkerId: WORKER, filledAt: "2026-11-19T13:00:00+01:00", liters: 8,
      }),
    }));
    expect(missing.status).toBe(400);
  });

  it("revise je append-only", async () => {
    const revised = await reviseRoute(
      new NextRequest(`http://interni/api/fuel-entries/${ENTRY}/revise`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Ispravka litre zbog pogrešnog očitanja.",
          payload: { liters: 41 },
        }),
      }),
      { params: Promise.resolve({ id: ENTRY }) },
    );
    expect(revised.status).toBe(200);
    const revisions = await withCompany(admin, companyId(COMPANY), async (client) => {
      const row = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM fuel_entry_revisions WHERE fuel_entry_id = $1",
        [ENTRY],
      );
      const liters = await client.query<{ liters: string }>(
        "SELECT liters::text FROM fuel_entries WHERE id = $1",
        [ENTRY],
      );
      return { revisions: Number(row.rows[0]?.n ?? 0), liters: liters.rows[0]?.liters };
    });
    expect(revisions.revisions).toBe(1);
    expect(revisions.liters).toBe("40.500");
  });
});