/**
 * F5 web: trošak se knjiži DOGAĐAJEM, ne dugmetom; bez cijene je `PENDING`, a ne nula.
 *
 * Zašto ovaj test više ne zove `book` rutu: ruta je ukinuta (`project-cost-entries/book`). Ono
 * što se provjerava je bitnije — da upis sata goriva bez iznosa ostavi `PENDING` red koji NE
 * ulazi u zbroj, i da unos cijene taj red prevede u `POSTED` tačno jednom.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { GET as listRoute } from "@/app/api/costs/route";
import { POST as rateRoute } from "@/app/api/machine-cost-rates/route";
import { POST as priceRoute } from "@/app/api/fuel-entries/[id]/price/route";
import { bookMachineWorkLogCostInCompany, createManualCost } from "./cost-entry-service";
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
const FUEL = `fuel_r61w_${RUN}`;

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
      /*
       * Točenje BEZ iznosa — to je D1 slučaj iz Modula 5: trošak postoji (gorivo je u rezervoaru),
       * ali cijena još nije poznata. Takav red ide u `PENDING`.
       */
      await client.query(
        `INSERT INTO public.fuel_entries
           (id, company_id, machine_id, driver_worker_id, project_id, filled_at, liters,
            amount_cents, currency_code, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'2026-11-19T13:00:00Z',50,NULL,'BAM',$6,$6)`,
        [FUEL, COMPANY, MACHINE, WORKER, PROJECT, USER_OWNER],
      );
    });
    cookieOwner = await signIn(USER_OWNER);
    cookieAcct = await signIn(USER_ACCT);
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      // Ledger je append-only: teardown isključuje korisničke trigere za svoju transakciju.
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM cost_entries WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM attachments WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM fuel_entries WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM machine_cost_rate_snapshots WHERE company_id = $1", [COMPANY]);
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

  it("gorivo bez iznosa ostaje PENDING i NE ulazi u zbroj", async () => {
    /*
     * Točenje je upisano u fixture-u direktno u tabelu (bez servisa), pa se trošak knjiži ovdje
     * kroz istu funkciju koju servis zove — bitno je da iznos NIJE poznat.
     */
    await withCompany(admin, companyId(COMPANY), async (client) => {
      const { bookFuelEntryCost } = await import("./cost-entry-service");
      const booked = await bookFuelEntryCost(client, {
        companyId: COMPANY,
        actorId: USER_OWNER,
        fuelEntryId: FUEL,
      });
      expect(booked.pending).toBe(1);
    });

    const list = await listRoute(new NextRequest(`http://t/api/costs?projectId=${PROJECT}`, {
      headers: { cookie: cookieOwner },
    }));
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      data: {
        entries: Array<{ source_id: string; amount: string | null; status: string }>;
        totals: { posted: string; pending_count: number };
      };
    };
    const pending = body.data.entries.find((entry) => entry.source_id === FUEL);
    expect(pending).toMatchObject({ amount: null, status: "PENDING" });
    // Zbroj `POSTED` troška ne sadrži `PENDING`: „nepoznato“ nije nula, ali nije ni iznos.
    expect(body.data.totals.posted).toBe("0.00");
    expect(body.data.totals.pending_count).toBe(1);
  });

  it("unos cijene prevodi PENDING u POSTED tačno jednom", async () => {
    const priced = await priceRoute(
      new NextRequest(`http://t/api/fuel-entries/${FUEL}/price`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({ totalAmount: "120.00" }),
      }),
      { params: Promise.resolve({ id: FUEL }) },
    );
    expect(priced.status).toBe(200);

    const list = await listRoute(new NextRequest(`http://t/api/costs?projectId=${PROJECT}`, {
      headers: { cookie: cookieOwner },
    }));
    const body = (await list.json()) as {
      data: {
        entries: Array<{ source_id: string; amount: string | null; status: string }>;
        totals: { posted: string; pending_count: number };
      };
    };
    const posted = body.data.entries.find((entry) => entry.source_id === FUEL);
    expect(posted).toMatchObject({ amount: "120.00", status: "POSTED" });
    expect(body.data.totals.posted).toBe("120.00");
    expect(body.data.totals.pending_count).toBe(0);

    // Drugi pokušaj ne dira iznos (cijena se ne prepisuje; ispravka je storno).
    const again = await priceRoute(
      new NextRequest(`http://t/api/fuel-entries/${FUEL}/price`, {
        method: "POST",
        headers: { cookie: cookieOwner, "content-type": "application/json" },
        body: JSON.stringify({ totalAmount: "999.00" }),
      }),
      { params: Promise.resolve({ id: FUEL }) },
    );
    expect(again.status).toBe(409);
  });

  it("sat mašine BEZ stope ostaje PENDING (trošak postoji, cijena ne)", async () => {
    const booked = await bookMachineWorkLogCostInCompany(admin, {
      companyId: COMPANY,
      actorId: USER_OWNER,
      workLogId: LOG_NO,
    });
    expect(booked.pending).toBe(1);
  });

  it("sa stopom knjiži jednom (idempotentno po izvoru)", async () => {
    const rate = await rateRoute(new NextRequest("http://t/api/machine-cost-rates", {
      method: "POST",
      headers: { cookie: cookieOwner, "content-type": "application/json" },
      body: JSON.stringify({ machineId: MACHINE, amount: "100.00", validFrom: "2026-01-01" }),
    }));
    expect(rate.status).toBe(200);

    const first = await bookMachineWorkLogCostInCompany(admin, {
      companyId: COMPANY,
      actorId: USER_OWNER,
      workLogId: LOG,
    });
    expect(first).toMatchObject({ posted: 1, pending: 0 });

    const second = await bookMachineWorkLogCostInCompany(admin, {
      companyId: COMPANY,
      actorId: USER_OWNER,
      workLogId: LOG,
    });
    expect(second).toMatchObject({ posted: 0, skipped: 1 });

    const list = await listRoute(new NextRequest(`http://t/api/costs?projectId=${PROJECT}`, {
      headers: { cookie: cookieOwner },
    }));
    const body = (await list.json()) as {
      data: { entries: Array<{ source_id: string; amount: string | null; status: string }> };
    };
    const rows = body.data.entries.filter((entry) => entry.source_id === LOG);
    expect(rows).toHaveLength(1);
    // 2 h × 100.00 = 200.00
    expect(rows[0]).toMatchObject({ amount: "200.00", status: "POSTED" });
  });

  it("ručni trošak ne knjiži neispravan prilog ili kategoriju, a spreman prilog zamrzava pri upisu", async () => {
    const category = await withCompany(admin, companyId(COMPANY), async (client) => {
      const rows = await client.query<{ id: string }>("SELECT id FROM cost_categories WHERE company_id = $1 AND is_active ORDER BY code LIMIT 1", [COMPANY]);
      return rows.rows[0]!.id;
    });
    const actor = { companyId: COMPANY, userId: USER_OWNER, roles: ["OWNER"] as const };
    const input = { projectId: PROJECT, categoryId: category, occurredOn: "2026-11-19", amount: "10.00" };
    const count = async () => withCompany(admin, companyId(COMPANY), async (client) => {
      const rows = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM cost_entries WHERE company_id = $1 AND source_type = 'MANUAL'", [COMPANY]);
      return rows.rows[0]!.n;
    });
    const before = await count();
    expect(await createManualCost(admin, actor, { ...input, attachmentId: "missing" })).toMatchObject({ outcome: "VALIDATION_FAILED", code: "ATTACHMENT" });
    expect(await count()).toBe(before);
    expect(await createManualCost(admin, actor, { ...input, categoryId: "missing" })).toMatchObject({ outcome: "VALIDATION_FAILED", code: "CATEGORY" });
    expect(await count()).toBe(before);
    const unrelatedId = `att_other_${RUN}`;
    await withCompany(admin, companyId(COMPANY), (client) => client.query(
      `INSERT INTO attachments (id, company_id, entity_type, entity_id, object_key, file_name, content_type, size_bytes, sha256, status, uploaded_at, created_by)
       VALUES ($1,$2,'PROJECT','another-project',$3,'racun.pdf','application/pdf',10,$4,'ready',now(),$5)`,
      [unrelatedId, COMPANY, `other/${RUN}`, "b".repeat(64), USER_OWNER],
    ));
    expect(await createManualCost(admin, actor, { ...input, attachmentId: unrelatedId })).toMatchObject({ outcome: "VALIDATION_FAILED", code: "ATTACHMENT" });
    expect(await count()).toBe(before);
    const attachmentId = `att_cost_${RUN}`;
    await withCompany(admin, companyId(COMPANY), (client) => client.query(
      `INSERT INTO attachments (id, company_id, entity_type, entity_id, object_key, file_name, content_type, size_bytes, sha256, status, uploaded_at, created_by)
       VALUES ($1,$2,'PROJECT',$3,$4,'racun.pdf','application/pdf',10,$5,'ready',now(),$6)`,
      [attachmentId, COMPANY, PROJECT, `test/${RUN}`, "a".repeat(64), USER_OWNER],
    ));
    const created = await createManualCost(admin, actor, { ...input, attachmentId });
    expect(created).toMatchObject({ outcome: "OK", id: expect.any(String) });
    const stored = await withCompany(admin, companyId(COMPANY), (client) => client.query<{ rate_snapshot: object }>(
      "SELECT rate_snapshot FROM cost_entries WHERE company_id = $1 AND id = $2", [COMPANY, created.id],
    ));
    expect(stored.rows[0]?.rate_snapshot).toEqual({ attachment_id: attachmentId });
  });

  it("ACCOUNTANT vidi troškove, ali ne smije knjižiti ručni trošak", async () => {
    const list = await listRoute(new NextRequest("http://t/api/costs", {
      headers: { cookie: cookieAcct },
    }));
    expect(list.status).toBe(200);
    const manual = await bookRouteManual(cookieAcct);
    expect(manual).toBe(403);
  });
});

/** Ručni trošak kroz rutu — dozvola `projects.costs.book` je ono što se provjerava. */
async function bookRouteManual(cookie: string): Promise<number> {
  const { POST } = await import("@/app/api/costs/manual/route");
  const response = await POST(
    new NextRequest("http://t/api/costs/manual", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT, categoryId: "nepostoji", occurredOn: "2026-11-19", amount: "10.00" }),
    }),
  );
  return response.status;
}
