/**
 * R5.5 web: prag → WAITING_APPROVAL, approve prolaz, ACCOUNTANT RO, Money.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { GET as listRoute, POST as createRoute } from "@/app/api/machine-faults/route";
import { POST as reviseRoute } from "@/app/api/machine-faults/[id]/revise/route";
import { POST as approveRoute } from "@/app/api/machine-faults/[id]/approve/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_r55_${RUN}`;
const USER_OWNER = `usr_r55_o_${RUN}`;
const USER_ACCT = `usr_r55_a_${RUN}`;
const USER_OP = `usr_r55_op_${RUN}`;
const WORKER = `wrk_r55_${RUN}`;
const MACHINE = `mch_r55_${RUN}`;

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

describeDb("R5.5 machine fault web API", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cookieOwner = "";
  let cookieAcct = "";
  let cookieOp = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'R55 Web', $2)`, [COMPANY, `r55-${RUN}`]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $3, 'O', 'wner', 'x', false), ($2, $4, 'A', 'cct', 'x', false), ($5, $6, 'O', 'p', 'x', false)`,
      [
        USER_OWNER, USER_ACCT, `owner-r55-${RUN}@test.example`, `acct-r55-${RUN}@test.example`,
        USER_OP, `op-r55-${RUN}@test.example`,
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
         VALUES ($1, $2, 'BAG-55', 'Bager test', $2 || '_cat_excavator')`,
        [MACHINE, COMPANY],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
    cookieOp = await signIn(USER_OP);
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM approval_requests WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_fault_revisions WHERE company_id = $1", [COMPANY]);
      /* F8: kvar pokazuje na nalog (`service_orders` → RESTRICT), pa nalog ne može otići dok
         veza stoji. Redoslijed: prvo veza na NULL, pa nalog, pa kvar. */
      await client.query("UPDATE machine_faults SET service_order_id = NULL WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM service_order_events WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM service_orders WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_faults WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM sessions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machines WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM workers WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [COMPANY]);
    });
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_OWNER, USER_ACCT, USER_OP]]);
    await admin.end();
  });

  it("ACCOUNTANT vidi listu bez create dugmeta (API create = 403)", async () => {
    const list = await listRoute(new NextRequest("http://t/api/machine-faults", {
      headers: { cookie: cookieAcct },
    }));
    expect(list.status).toBe(200);
    const create = await createRoute(new NextRequest("http://t/api/machine-faults", {
      method: "POST",
      headers: { cookie: cookieAcct, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        reportedAt: "2026-11-19T08:00:00+01:00",
        title: "Test",
        priority: "LOW",
      }),
    }));
    expect(create.status).toBe(403);
  });

  it("prag troška → WAITING_APPROVAL; approve → APPROVED; Money u listi", async () => {
    const create = await createRoute(new NextRequest("http://t/api/machine-faults", {
      method: "POST",
      headers: { cookie: cookieOp, "content-type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE,
        reportedAt: "2026-11-19T08:00:00+01:00",
        title: "Skupi servis",
        priority: "HIGH",
        estimatedCostAmount: "600.00",
        currencyCode: "BAM",
      }),
    }));
    expect(create.status).toBe(200);
    const createdBody = await create.json() as { data: { outcome: string; id: string } };
    expect(createdBody.data.outcome).toBe("OK");
    const created = createdBody.data;

    // A field user without a linked worker must not fall back to the company-wide list.
    await withCompany(admin, companyId(COMPANY), (client) => client.query(
      "UPDATE workers SET user_id = NULL WHERE company_id = $1 AND id = $2", [COMPANY, WORKER],
    ));
    try {
      const unlinked = await listRoute(new NextRequest("http://t/api/machine-faults", { headers: { cookie: cookieOp } }));
      const unlinkedBody = await unlinked.json() as { data: { faults: unknown[] } };
      expect(unlinkedBody.data.faults).toEqual([]);
    } finally {
      await withCompany(admin, companyId(COMPANY), (client) => client.query(
        "UPDATE workers SET user_id = $3 WHERE company_id = $1 AND id = $2", [COMPANY, WORKER, USER_OP],
      ));
    }

    const list = await listRoute(new NextRequest("http://t/api/machine-faults", {
      headers: { cookie: cookieOwner },
    }));
    const body = await list.json() as {
      data: { faults: Array<{ id: string; status: string; estimated_cost: string | null; currency_code: string | null }> };
    };
    const row = body.data.faults.find((f) => f.id === created.id);
    expect(row?.status).toBe("WAITING_APPROVAL");
    expect(row?.estimated_cost).toBe("600.00");
    expect(row?.currency_code).toBe("BAM");

    const blocked = await reviseRoute(
      new NextRequest(`http://t/api/machine-faults/${created.id}/revise`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Pokušaj prelaska u rad bez odobrenja.",
          payload: { status: "IN_PROGRESS" },
        }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(blocked.status).toBe(403);

    const approve = await approveRoute(
      new NextRequest(`http://t/api/machine-faults/${created.id}/approve`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(approve.status).toBe(200);

    const after = await listRoute(new NextRequest("http://t/api/machine-faults", {
      headers: { cookie: cookieOwner },
    }));
    const afterBody = await after.json() as { data: { faults: Array<{ id: string; status: string }> } };
    expect(afterBody.data.faults.find((f) => f.id === created.id)?.status).toBe("APPROVED");
  });
});
