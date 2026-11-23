/**
 * R5.3 web integracija: ACCOUNTANT read-only, DRIVER create, revise append-only.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { GET as listRoute, POST as createRoute } from "@/app/api/hauls/route";
import { POST as reviseRoute } from "@/app/api/hauls/[id]/revise/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_r53_${RUN}`;
const USER_OWNER = `usr_r53_o_${RUN}`;
const USER_ACCT = `usr_r53_a_${RUN}`;
const USER_DRIVER = `usr_r53_d_${RUN}`;
const WORKER = `wrk_r53_${RUN}`;
const MACHINE = `mch_r53_${RUN}`;
const HAUL = `haul_r53_${RUN}`;

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

describeDb("R5.3 haul web API", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cookieOwner = "";
  let cookieAcct = "";
  let cookieDriver = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'R53 Web', $2)`, [COMPANY, `r53-${RUN}`]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $3, 'O', 'wner', 'x', false), ($2, $4, 'A', 'cct', 'x', false), ($5, $6, 'D', 'river', 'x', false)`,
      [
        USER_OWNER, USER_ACCT, `owner-r53-${RUN}@test.example`, `acct-r53-${RUN}@test.example`,
        USER_DRIVER, `driver-r53-${RUN}@test.example`,
      ],
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
         VALUES ($1, $2, 'KAM-53', 'Kamion test', $2 || '_cat_truck')`,
        [MACHINE, COMPANY],
      );
      await client.query(
        `INSERT INTO hauls
           (id, company_id, machine_id, driver_worker_id, hauled_at,
            origin_text, destination_text, material_text, quantity, quantity_unit,
            trip_count, created_by, updated_by)
         VALUES ($1,$2,$3,$4,'2026-11-19T08:00:00Z','Depo','Gradilište','Šljunak',10,'M3',1,$5,$5)`,
        [HAUL, COMPANY, MACHINE, WORKER, USER_OWNER],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
    cookieDriver = await signIn(USER_DRIVER);
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM haul_revisions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM hauls WHERE company_id = $1", [COMPANY]);
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
    const list = await listRoute(new NextRequest("http://interni/api/hauls", { headers: { cookie: cookieAcct } }));
    expect(list.status).toBe(200);
    const body = await list.json() as { data: { hauls: { quantity: number }[] } };
    expect(body.data.hauls[0]?.quantity).toBe(10);
    const denied = await createRoute(new NextRequest("http://interni/api/hauls", {
      method: "POST",
      headers: { cookie: cookieAcct, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        hauledAt: "2026-11-19T08:00:00+01:00",
        originText: "A",
        destinationText: "B",
        materialText: "Šljunak",
        quantity: 5,
        quantityUnit: "M3",
      }),
    }));
    expect(denied.status).toBe(403);
  });

  it("DRIVER može kreirati unos", async () => {
    const created = await createRoute(new NextRequest("http://interni/api/hauls", {
      method: "POST",
      headers: { cookie: cookieDriver, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        hauledAt: "2026-11-19T09:00:00+01:00",
        originText: "Depo",
        destinationText: "Trasa",
        materialText: "Asfalt",
        quantity: 8,
        quantityUnit: "T",
        tripCount: 2,
      }),
    }));
    expect(created.status).toBe(200);
  });

  it("revise je append-only i čuva original u payloadu", async () => {
    const revised = await reviseRoute(
      new NextRequest(`http://interni/api/hauls/${HAUL}/revise`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Ispravka količine zbog pogrešnog unosa.",
          payload: { quantity: 11 },
        }),
      }),
      { params: Promise.resolve({ id: HAUL }) },
    );
    expect(revised.status).toBe(200);
    const check = await withCompany(admin, companyId(COMPANY), async (client) => {
      const row = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM haul_revisions WHERE haul_id = $1",
        [HAUL],
      );
      const qty = await client.query<{ quantity: string }>(
        "SELECT quantity::text FROM hauls WHERE id = $1",
        [HAUL],
      );
      const payload = await client.query<{ payload: { original: { quantity: number }; quantity: number } }>(
        "SELECT payload FROM haul_revisions WHERE haul_id = $1 ORDER BY created_at DESC LIMIT 1",
        [HAUL],
      );
      return {
        revisions: Number(row.rows[0]?.n ?? 0),
        quantity: qty.rows[0]?.quantity,
        originalQty: payload.rows[0]?.payload.original.quantity,
        changeQty: payload.rows[0]?.payload.quantity,
      };
    });
    expect(check.revisions).toBe(1);
    expect(check.quantity).toBe("10.000");
    expect(check.originalQty).toBe(10);
    expect(check.changeQty).toBe(11);
  });
});
