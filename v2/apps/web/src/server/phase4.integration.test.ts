/**
 * F4 (Modul 5) — integracioni test na PRAVOJ bazi: razložen trošak, snapshot, dvostruka dodjela,
 * gorivo sa odstupanjem, stacionaža, šablon pregleda sa kritičnim nalazom i iskorištenost.
 *
 * Zašto integracioni, a ne samo unit: pola pravila F4 živi u bazi (EXCLUDE/triger preklapanja,
 * CHECK nad `deviation_status`, FORCE RLS, triger `APPROVED → service_order`). Unit test ih ne
 * može ni vidjeti, a upravo su ona mjesta gdje greška prolazi u produkciju.
 *
 * Test pokriva SPEC §5 tačke 1–12 onoliko koliko je provjerljivo kroz servise i API rute.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { GET as componentsGet, POST as componentsPost } from "@/app/api/machines/[id]/cost-components/route";
import { GET as rateGet, POST as ratePost } from "@/app/api/machines/[id]/cost-rate/route";
import { GET as utilGet } from "@/app/api/machines/[id]/utilization/route";
import { POST as rentalPost } from "@/app/api/machines/[id]/rental/route";
import { GET as pricesGet, POST as pricesPost } from "@/app/api/fuel-prices/route";
import { GET as tanksGet, POST as tanksPost } from "@/app/api/fuel-tanks/route";
import { PATCH as tankCountPatch } from "@/app/api/fuel-tanks/[id]/count/route";
import { GET as deviationsGet } from "@/app/api/fuel-entries/deviations/route";
import { PATCH as explainPatch } from "@/app/api/fuel-entries/[id]/explain/route";
import { GET as segmentsGet, POST as segmentsPost } from "@/app/api/route-segments/route";
import { GET as templatesGet, POST as templatesPost } from "@/app/api/check-templates/route";
import { POST as dailyCheckPost } from "@/app/api/machine-daily-checks/route";
import { POST as photoPost } from "@/app/api/machine-daily-checks/[id]/photo/route";
import { POST as fuelPost } from "@/app/api/fuel-entries/route";
import { POST as bookPost } from "@/app/api/project-cost-entries/book/route";
import { GET as costEntriesGet } from "@/app/api/project-cost-entries/route";
import { POST as faultApprove } from "@/app/api/machine-faults/[id]/approve/route";
import { POST as faultCreate } from "@/app/api/machine-faults/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_f4_${RUN}`;
const OTHER = `cmp_f4o_${RUN}`;
const USER_OWNER = `usr_f4o_${RUN}`;
const USER_OTHER = `usr_f4x_${RUN}`;
const USER_FIELD = `usr_f4f_${RUN}`;
const WORKER = `wrk_f4_${RUN}`;
const WORKER_FIELD = `wrk_f4f_${RUN}`;
const MACHINE = `mch_f4_${RUN}`;
const MACHINE_OTHER = `mch_f4x_${RUN}`;
const PROJECT = `prj_f4_${RUN}`;
const PROJECT_B = `prj_f4b_${RUN}`;
const PARTNER = `prt_f4_${RUN}`;

async function signIn(userId: string, company: string): Promise<string> {
  const sessionId = `ses_${userId}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await withCompany(admin, companyId(company), async (client) => {
    await client.query(
      `INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [sessionId, company, userId, `hash_${sessionId}`],
    );
  });
  await admin.end();
  return `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: sessionId, companyId: company })}`;
}

function req(cookie: string, path: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(`http://t${path}`, {
    method,
    headers: body === undefined
      ? { cookie }
      : { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type Envelope<T> = { success: boolean; data: T; error?: { code?: string; message?: string } };

describeDb("F4 mehanizacija — baza", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  let cookieOwner = "";
  let cookieOther = "";
  let cookieField = "";

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO companies (id, name, slug, planned_hours_per_month)
       VALUES ($1, 'F4 firma', $2, 160), ($3, 'F4 tuđa', $4, 160)`,
      [COMPANY, `f4-${RUN}`, OTHER, `f4o-${RUN}`],
    );
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $4, 'V', 'Lasnik', 'x', false),
              ($2, $5, 'T', 'Uđi', 'x', false),
              ($3, $6, 'R', 'Ukovalac', 'x', false)`,
      [
        USER_OWNER, USER_OTHER, USER_FIELD,
        `owner-f4-${RUN}@test.example`, `other-f4-${RUN}@test.example`, `field-f4-${RUN}@test.example`,
      ],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY'),
                ($4,$5,$3,ARRAY['MACHINE_OPERATOR']::"Role"[],'COMPANY')`,
        [`mem_o_${RUN}`, USER_OWNER, COMPANY, `mem_f_${RUN}`, USER_FIELD],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1,$3,'R','Ukovalac','2024-01-01'::date,$4),
                ($2,$3,'V','Ozač','2024-01-01'::date,NULL)`,
        [WORKER_FIELD, WORKER, COMPANY, USER_FIELD],
      );
      await client.query(
        `INSERT INTO projects (id, company_id, code, name)
         VALUES ($1,$3,'F4','Projekat F4'), ($2,$3,'F4B','Projekat F4B')`,
        [PROJECT, PROJECT_B, COMPANY],
      );
      await client.query(
        `INSERT INTO partners (id, company_id, code, name, kind)
         VALUES ($1,$2,'PRV-F4','Prevoznik F4','SERVICE')`,
        [PARTNER, COMPANY],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1,$2,'F4-1','Bager F4',$2 || '_cat_excavator')`,
        [MACHINE, COMPANY],
      );
    });
    await withCompany(admin, companyId(OTHER), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY')`,
        [`mem_x_${RUN}`, USER_OTHER, OTHER],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1,$2,'X-1','Tuđi bager',$2 || '_cat_excavator')`,
        [MACHINE_OTHER, OTHER],
      );
    });
    cookieOwner = await signIn(USER_OWNER, COMPANY);
    cookieOther = await signIn(USER_OTHER, OTHER);
    cookieField = await signIn(USER_FIELD, COMPANY);
  }, 60_000);

  afterAll(async () => {
    /*
     * Dodjele se ne mogu obrisati redovnim putem: `project_assignments` je historijski dokaz i
     * triger zabranjuje DELETE (Modul 3). Za čišćenje testa koristi se `session_replication_role
     * = replica` — to isključuje KORISNIČKE trigere, pa čišćenje ne mora da poništava redove po
     * redu i ne ostavlja smeće u bazi.
     */
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM public.project_assignments WHERE company_id = $1", [COMPANY]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await withCompany(admin, companyId(COMPANY), async (db) => {
      for (const table of [
        "machine_meter_readings", "project_cost_entries", "machine_cost_rate_snapshots",
        "machine_cost_components", "machine_cost_rates", "machine_work_logs", "service_orders",
        "approval_requests", "machine_faults", "machine_daily_checks", "check_templates",
        "attachments", "usage_overrides",
        "fuel_entries", "fuel_prices", "fuel_tanks", "hauls", "route_segments", "projects",
        "machines", "partners", "workers", "sessions", "memberships",
      ]) {
        await db.query(`DELETE FROM ${table} WHERE company_id = $1`, [COMPANY]);
      }
    });
    await admin.query("DELETE FROM companies WHERE id = ANY($1::text[])", [[COMPANY, OTHER]]);
    await admin.end();
    await pool.end();
  });

  /* ---------------------------------------------------------------- §5.1 stopa */

  it("§5.1 komponente → izračunata stopa; mjesečna rata podijeljena sa 160", async () => {
    const perHour = await componentsPost(
      req(cookieOwner, `/api/machines/${MACHINE}/cost-components`, "POST", {
        machineId: MACHINE, component: "FUEL", basis: "PER_HOUR", amount: "18.00", validFrom: "2026-01-01",
      }),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    expect(perHour.status).toBe(200);
    const monthly = await componentsPost(
      req(cookieOwner, `/api/machines/${MACHINE}/cost-components`, "POST", {
        machineId: MACHINE, component: "DEPRECIATION", basis: "PER_MONTH", amount: "16000.00", validFrom: "2026-01-01",
      }),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    expect(monthly.status).toBe(200);

    const rate = await rateGet(req(cookieOwner, `/api/machines/${MACHINE}/cost-rate`), {
      params: Promise.resolve({ id: MACHINE }),
    });
    const body = (await rate.json()) as Envelope<{ rate: { calculated_rate: string; planned_hours_per_month: number } }>;
    // 1800 + 1600000/160 (=10000) = 11800 centi = 118.00
    expect(body.data.rate.calculated_rate).toBe("118.00");
    expect(body.data.rate.planned_hours_per_month).toBe(160);
  });

  it("§5.1 ručna stopa traži razlog i nadjačava izračunatu", async () => {
    const withoutReason = await ratePost(
      req(cookieOwner, `/api/machines/${MACHINE}/cost-rate`, "POST", {
        machineId: MACHINE, amount: "150.00", validFrom: "2026-02-01",
      }),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    expect(withoutReason.status).toBe(422);
    const failure = (await withoutReason.json()) as { error?: { code?: string } };
    // Zaseban kod: ekran tada traži RAZLOG, ne popravku iznosa.
    expect(failure.error?.code).toBe("COST_RATE_MANUAL_OVERRIDE");

    const withReason = await ratePost(
      req(cookieOwner, `/api/machines/${MACHINE}/cost-rate`, "POST", {
        machineId: MACHINE, amount: "150.00", validFrom: "2026-02-01",
        reason: "Najam po dnevnoj cijeni — čeka se račun dobavljača.",
      }),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    expect(withReason.status).toBe(200);
    const body = (await withReason.json()) as Envelope<{
      rate: { effective_rate: string; calculated_rate: string; is_manual: boolean };
    }>;
    expect(body.data.rate.is_manual).toBe(true);
    expect(body.data.rate.effective_rate).toBe("150.00");
    // Izračunata OSTAJE vidljiva — odstupanje ne smije biti skriveno.
    expect(body.data.rate.calculated_rate).toBe("118.00");
  });

  /* ---------------------------------------------------------------- §5.2 snapshot */

  it("§5.2 knjiženje zamrzava stopu; promjena komponente ne mijenja stari trošak", async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO machine_work_logs
           (id, company_id, machine_id, worker_id, project_id, started_at, ended_at, mode, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'2026-02-10T08:00:00Z','2026-02-10T10:00:00Z','WORK',$6,$6)`,
        [`mwl_f4_${RUN}`, COMPANY, MACHINE, WORKER, PROJECT, USER_OWNER],
      );
    });
    const booked = await bookPost(
      req(cookieOwner, "/api/project-cost-entries/book", "POST", { workLogIds: [`mwl_f4_${RUN}`] }),
    );
    expect(booked.status).toBe(200);

    const list = await costEntriesGet(req(cookieOwner, "/api/project-cost-entries"));
    const entries = (await list.json()) as Envelope<{ entries: { rate: string; amount: string }[] }>;
    expect(entries.data.entries).toHaveLength(1);
    // 2 h × 150.00 (ručna stopa na 2026-02-10) = 300.00
    expect(entries.data.entries[0]!.amount).toBe("300.00");

    const snapshot = await withCompany(pool, companyId(COMPANY), async (client) =>
      client.query<{ rate_snapshot: { rate_cents: string }; component_breakdown: unknown[] }>(
        `SELECT rate_snapshot, component_breakdown FROM public.project_cost_entries
          WHERE company_id = $1 AND source_type = 'MACHINE_WORK_LOG'`,
        [COMPANY],
      ),
    );
    expect(snapshot.rows[0]!.rate_snapshot.rate_cents).toBe("15000");
    // Razlaganje ostaje uz snapshot i kad je stopa ručna — vidi se kolika bi bila izračunata.
    expect(snapshot.rows[0]!.component_breakdown.length).toBeGreaterThan(0);

    // Ista knjižba dvaput ne pravi drugi red (idempotencija po izvoru).
    const again = await bookPost(
      req(cookieOwner, "/api/project-cost-entries/book", "POST", { workLogIds: [`mwl_f4_${RUN}`] }),
    );
    const againBody = (await again.json()) as Envelope<{ booked: number; skippedExisting: number }>;
    expect(againBody.data.booked).toBe(0);
    expect(againBody.data.skippedExisting).toBe(1);
  });

  it("§5.2 snapshot se ne može prepisati (baza brani izmjenu)", async () => {
    // Namjerno kroz ADMIN konekciju: aplikacijskoj ulozi nedostaje UPDATE na tabeli, pa bi test
    // prošao i da trigera nema. Ovako jedini razlog pada može biti sam triger.
    await expect(
      admin.query(
        `UPDATE public.project_cost_entries
            SET rate_snapshot = '{"rate_cents":"1"}'::jsonb
          WHERE company_id = $1`,
        [COMPANY],
      ),
    ).rejects.toThrow(/COST_SNAPSHOT_IMMUTABLE/);
  });

  /* ---------------------------------------------------------------- §5.4 iskorištenost */

  it("§5.4 obje kolone iskorištenosti + MTBF/MTTR", async () => {
    // WORK 2 h (gore) + IDLE 1 h + BREAKDOWN 1 h; radna sedmica × 8 h.
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO machine_work_logs
           (id, company_id, machine_id, worker_id, project_id, started_at, ended_at, mode, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'2026-02-10T10:00:00Z','2026-02-10T11:00:00Z','IDLE',$6,$6),
                ($7,$2,$3,$4,$5,'2026-02-10T11:00:00Z','2026-02-10T12:00:00Z','BREAKDOWN',$6,$6)`,
        [`mwl_f4i_${RUN}`, COMPANY, MACHINE, WORKER, PROJECT, USER_OWNER, `mwl_f4b_${RUN}`],
      );
    });
    const res = await utilGet(
      req(cookieOwner, `/api/machines/${MACHINE}/utilization?from=2026-02-10&to=2026-02-10`),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    const body = (await res.json()) as Envelope<{
      utilization_pct: number;
      work_hours: number;
      idle_hours: number;
      breakdown_hours: number;
      calendar_hours: number;
      calendar_utilization_pct: number | null;
    }>;
    expect(body.data.work_hours).toBe(2);
    expect(body.data.idle_hours).toBe(1);
    expect(body.data.breakdown_hours).toBe(1);
    // Primarna: 2 / (2+1+1) = 50%
    expect(body.data.utilization_pct).toBe(50);
    // Sekundarna: kalendarski radni sati jednog radnog dana (utorak 10.02.2026) = 8 h → 25%
    expect(body.data.calendar_hours).toBe(8);
    expect(body.data.calendar_utilization_pct).toBe(25);
  });

  /* ---------------------------------------------------------------- §5.10 dvostruka dodjela */

  it("§5.10 ista mašina ne može na dva projekta u istom periodu", async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO project_assignments (id, company_id, project_id, machine_id, from_date, created_by)
         VALUES ($1,$2,$3,$4,'2026-03-01',$5)`,
        [`pas_f4_${RUN}`, COMPANY, PROJECT, MACHINE, USER_OWNER],
      );
    });
    await expect(
      withCompany(pool, companyId(COMPANY), async (client) => {
        await client.query(
          `INSERT INTO project_assignments (id, company_id, project_id, machine_id, from_date, created_by)
           VALUES ($1,$2,$3,$4,'2026-03-15',$5)`,
          [`pas_f4b_${RUN}`, COMPANY, PROJECT_B, MACHINE, USER_OWNER],
        );
      }),
    ).rejects.toThrow(/MACHINE_DOUBLE_BOOKED/);

    // Iznimka iz Modula 2 pušta preklapanje — ali samo kao ZAPIS sa razlogom i rokom.
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO usage_overrides
           (id, company_id, subject_kind, subject_id, action, reference_id, reason,
            valid_from, valid_to, requested_by, approved_by, approved_at)
         VALUES ($1,$2,'MACHINE',$3,'assign',$4,'Hitna potreba na drugom gradilištu','2026-03-01','2026-04-30',$5,$5,now())`,
        [`uov_f4_${RUN}`, COMPANY, MACHINE, PROJECT_B, USER_OWNER],
      );
      await client.query(
        `INSERT INTO project_assignments
           (id, company_id, project_id, machine_id, from_date, created_by, double_booking_override_id)
         VALUES ($1,$2,$3,$4,'2026-03-15',$5,$6)`,
        [`pas_f4c_${RUN}`, COMPANY, PROJECT_B, MACHINE, USER_OWNER, `uov_f4_${RUN}`],
      );
    });
    const slots = await admin.query(
      "SELECT count(*)::int AS n FROM project_assignments WHERE company_id = $1 AND machine_id = $2 AND voided_at IS NULL",
      [COMPANY, MACHINE],
    );
    expect(slots.rows[0].n).toBe(2);
  });

  /* ---------------------------------------------------------------- §5.5 gorivo */

  it("§5.5 predložena cijena po datumu; NULL iznos ostaje NULL", async () => {
    const price = await pricesPost(
      req(cookieOwner, "/api/fuel-prices", "POST", {
        fuelKind: "DIESEL", price: "2.45", validFrom: "2026-01-01",
      }),
    );
    expect(price.status).toBe(200);
    const list = await pricesGet(req(cookieOwner, "/api/fuel-prices"));
    const body = (await list.json()) as Envelope<{ prices: { price: string }[] }>;
    expect(body.data.prices[0]!.price).toBe("2.45");

    // Točenje bez iznosa: cijena iz šifarnika (40 l × 2.45 = 98.00).
    const suggested = await fuelPost(req(cookieField, "/api/fuel-entries", "POST", {
      machineId: MACHINE,
      filledAt: "2026-02-11T09:00:00+01:00",
      liters: 40,
      meterReading: 100,
    }));
    expect(suggested.status).toBe(200);

    // Točenje bez šifarnika za tu vrstu → iznos ostaje NULL, nikad nula (D1).
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1,$2,'F4-2','Kamion F4',$2 || '_cat_truck')`,
        [`mch_f4c_${RUN}`, COMPANY],
      );
    });
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("DELETE FROM fuel_prices WHERE company_id = $1", [COMPANY]);
    });
    const noPrice = await fuelPost(req(cookieField, "/api/fuel-entries", "POST", {
      machineId: `mch_f4c_${RUN}`,
      filledAt: "2026-02-12T09:00:00+01:00",
      liters: 30,
    }));
    expect(noPrice.status).toBe(200);
    const rows = await admin.query<{ amount_cents: string | null; price_source: string }>(
      `SELECT amount_cents::text, price_source FROM public.fuel_entries
        WHERE company_id = $1 ORDER BY filled_at`,
      [COMPANY],
    );
    expect(rows.rows[0]!.price_source).toBe("PRICE_LIST");
    expect(rows.rows[0]!.amount_cents).toBe("9800");
    expect(rows.rows[1]!.amount_cents).toBeNull();
  });

  it("§5.5 odstupanje iznad praga traži objašnjenje; točenje NIJE blokirano", async () => {
    // Prosjek: 40 l na 8 h = 5 l/h. Sljedeće točenje 100 l na 4 h = 25 l/h → +400%.
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO fuel_entries
           (id, company_id, machine_id, driver_worker_id, filled_at, liters, price_source,
            currency_code, created_by, updated_by)
         VALUES ($1,$2,$3,$4,'2026-02-01T08:00:00Z',40,'MANUAL',$5,$6,$6)`,
        [`fuel_base_${RUN}`, COMPANY, MACHINE, WORKER, "BAM", USER_OWNER],
      );
      await client.query(
        `UPDATE fuel_entries SET meter_reading = 96 WHERE company_id = $1 AND id = $2`,
        [COMPANY, `fuel_base_${RUN}`],
      );
    });
    const spike = await fuelPost(req(cookieField, "/api/fuel-entries", "POST", {
      machineId: MACHINE,
      filledAt: "2026-02-11T10:00:00+01:00",
      liters: 100,
      meterReading: 104,
    }));
    // Unos je PROŠAO — za gorivo je upozorenje, ne blokada (spec 05 §1.3.15).
    expect(spike.status).toBe(200);

    const deviations = await deviationsGet(req(cookieOwner, "/api/fuel-entries/deviations"));
    const list = (await deviations.json()) as Envelope<{
      deviations: { id: string; status: string; deviation_pct: number | null }[];
      open_count: number;
    }>;
    expect(list.data.open_count).toBeGreaterThan(0);
    const open = list.data.deviations.find((row) => row.status === "OPEN");
    expect(open).toBeDefined();

    // Zatvaranje bez razloga je odbijeno — upozorenje se ne skriva tiho.
    const silent = await explainPatch(
      req(cookieOwner, `/api/fuel-entries/${open!.id}/explain`, "PATCH", {
        status: "DISMISSED", reason: "OTHER", note: "ok",
      }),
      { params: Promise.resolve({ id: open!.id }) },
    );
    expect(silent.status).toBe(422);
    const silentBody = (await silent.json()) as { error?: { code?: string } };
    expect(silentBody.error?.code).toBe("FUEL_DEVIATION_EXPLANATION_REQUIRED");

    const explained = await explainPatch(
      req(cookieOwner, `/api/fuel-entries/${open!.id}/explain`, "PATCH", {
        status: "EXPLAINED", reason: "MISREAD", note: "Brojilo je očitano sa pogrešne mašine.",
      }),
      { params: Promise.resolve({ id: open!.id }) },
    );
    expect(explained.status).toBe(200);
  });

  it("§5.6 cisterna: uključena → stanje = ulaz − izlaz; popis zapisuje razliku", async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("UPDATE companies SET fuel_tank_enabled = true WHERE id = $1", [COMPANY]);
    });
    const tank = await tanksPost(req(cookieOwner, "/api/fuel-tanks", "POST", {
      name: "Cisterna 1", capacityL: 5000, currentL: 1000,
    }));
    expect(tank.status).toBe(200);
    const tankBody = (await tank.json()) as Envelope<{ id: string }>;

    const fromTank = await fuelPost(req(cookieField, "/api/fuel-entries", "POST", {
      machineId: MACHINE,
      filledAt: "2026-02-13T09:00:00+01:00",
      liters: 100,
      tankId: tankBody.data.id,
    }));
    expect(fromTank.status).toBe(200);

    const tanks = await tanksGet(req(cookieOwner, "/api/fuel-tanks"));
    const tanksBody = (await tanks.json()) as Envelope<{ tanks: { current_l: number }[] }>;
    // 1000 − 100 = 900
    expect(tanksBody.data.tanks[0]!.current_l).toBe(900);

    const count = await tankCountPatch(
      req(cookieOwner, `/api/fuel-tanks/${tankBody.data.id}/count`, "PATCH", { currentL: 880 }),
      { params: Promise.resolve({ id: tankBody.data.id }) },
    );
    expect(count.status).toBe(200);
    const audit = await admin.query(
      `SELECT metadata FROM audit_events
        WHERE company_id = $1 AND action = 'fuel.tank_counted'
        ORDER BY created_at DESC LIMIT 1`,
      [COMPANY],
    );
    // Razlika je SRŽ popisa — bez nje se gubitak ne vidi.
    expect(Number(audit.rows[0]!.metadata.differenceL)).toBe(-20);
  });

  it("§5.6 cisterna isključena → točenje sa cisternom je odbijeno", async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("UPDATE companies SET fuel_tank_enabled = false WHERE id = $1", [COMPANY]);
    });
    const tanks = await tanksGet(req(cookieOwner, "/api/fuel-tanks"));
    const tanksBody = (await tanks.json()) as Envelope<{ tanks: { id: string }[] }>;
    const res = await fuelPost(req(cookieField, "/api/fuel-entries", "POST", {
      machineId: MACHINE,
      filledAt: "2026-02-14T09:00:00+01:00",
      liters: 10,
      tankId: tanksBody.data.tanks[0]!.id,
    }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("Cisterna nije uključena");
  });

  /* ---------------------------------------------------------------- §5.7 stacionaža */

  it("§5.7 km+m validacija i zbir po dionici", async () => {
    const half = await segmentsPost(req(cookieOwner, "/api/route-segments", "POST", {
      code: "D-9", name: "Pola stacionaže", fromKm: 10,
    }));
    expect(half.status).toBe(400);

    const backwards = await segmentsPost(req(cookieOwner, "/api/route-segments", "POST", {
      code: "D-8", name: "Obrnuto", fromKm: 10, fromM: 500, toKm: 10, toM: 200,
    }));
    expect(backwards.status).toBe(400);

    const ok = await segmentsPost(req(cookieOwner, "/api/route-segments", "POST", {
      code: "D-1", name: "Dionica 1", fromKm: 10, fromM: 250, toKm: 12, toM: 750,
    }));
    expect(ok.status).toBe(200);
    const created = (await ok.json()) as Envelope<{ id: string; length_m: number }>;
    // 12*1000+750 − (10*1000+250) = 2500 m
    expect(created.data.length_m).toBe(2500);

    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO hauls
           (id, company_id, machine_id, driver_worker_id, project_id, segment_id, hauled_at,
            origin_text, destination_text, material_text, quantity, quantity_unit, trip_count,
            created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,'2026-02-15T08:00:00Z','D-1 od','D-1 do','Šljunak',
                 12.5,'M3',1,$7,$7),
                ($8,$2,$3,$4,$5,$6,'2026-02-15T09:00:00Z','D-1 od','D-1 do','Šljunak',
                 7.5,'M3',1,$7,$7)`,
        [
          `hau_f4_${RUN}`, COMPANY, MACHINE, WORKER, PROJECT, created.data.id, USER_OWNER,
          `hau_f4b_${RUN}`,
        ],
      );
    });
    const list = await segmentsGet(req(cookieOwner, "/api/route-segments"));
    const segments = (await list.json()) as Envelope<{
      segments: { code: string; haul_count: number; quantity_sum: number | null; quantity_unit: string | null }[];
    }>;
    const segment = segments.data.segments.find((row) => row.code === "D-1");
    expect(segment!.haul_count).toBe(2);
    expect(segment!.quantity_sum).toBe(20);
    expect(segment!.quantity_unit).toBe("M3");
  });

  /* ---------------------------------------------------------------- §5.8 dnevni pregled */

  it("§5.8 kritična FAIL stavka → fotografija obavezna + kvar vezan na pregled", async () => {
    const template = await templatesPost(req(cookieOwner, "/api/check-templates", "POST", {
      name: "Bager — dnevni",
      categoryId: `${COMPANY}_cat_excavator`,
      items: [
        { key: "ulje", label: "Nivo ulja", required: true, critical: true },
        { key: "gume", label: "Gume", required: true, critical: false },
      ],
    }));
    expect(template.status).toBe(200);

    const check = await dailyCheckPost(req(cookieField, "/api/machine-daily-checks", "POST", {
      machineId: MACHINE,
      checkedAt: "2026-02-16T07:00:00+01:00",
      result: "FAIL",
      checklistJson: { ulje: "FAIL", gume: "PASS" },
    }));
    expect(check.status).toBe(200);
    const checkBody = (await check.json()) as Envelope<{ id: string }>;

    const fault = await admin.query<{ id: string; status: string; daily_check_id: string }>(
      `SELECT id, status, daily_check_id FROM public.machine_faults
        WHERE company_id = $1 AND daily_check_id = $2`,
      [COMPANY, checkBody.data.id],
    );
    // Kvar se otvara AUTOMATSKI i vezan je na pregled — bez toga bi kritičan nalaz zavisio
    // od toga da se neko sjeti prijaviti ga ručno.
    expect(fault.rows[0]!.daily_check_id).toBe(checkBody.data.id);
    expect(fault.rows[0]!.status).toBe("OPEN");

    // Potvrda bez priloga je odbijena: dokaz mora STVARNO postojati.
    const noPhoto = await photoPost(
      req(cookieField, `/api/machine-daily-checks/${checkBody.data.id}/photo`, "POST"),
      { params: Promise.resolve({ id: checkBody.data.id }) },
    );
    expect(noPhoto.status).toBe(409);

    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO attachments
           (id, company_id, entity_type, entity_id, object_key, file_name, content_type,
            size_bytes, sha256, status, uploaded_at, created_by)
         VALUES ($1,$2,'MACHINE_DAILY_CHECK',$3,'k/f/1','slika.jpg','image/jpeg',1024,
                 repeat('a', 64), 'ready', clock_timestamp(), $4)`,
        [`att_f4_${RUN}`, COMPANY, checkBody.data.id, USER_FIELD],
      );
    });
    const withPhoto = await photoPost(
      req(cookieField, `/api/machine-daily-checks/${checkBody.data.id}/photo`, "POST"),
      { params: Promise.resolve({ id: checkBody.data.id }) },
    );
    expect(withPhoto.status).toBe(200);
  });

  /* ---------------------------------------------------------------- §5.9 prag kvara + servisni nalog */

  it("§5.9 prag po firmi i APPROVED otvara servisni nalog jednom", async () => {
    // Prag firme je 500 KM (default). Kvar od 700 KM mora u WAITING_APPROVAL, a od 100 KM u OPEN.
    // Kroz API, a ne INSERT-om: status na unosu RAČUNA servis, pa bi ručni INSERT zaobišao baš
    // ono što testiramo.
    const expensive = await faultCreate(req(cookieOwner, "/api/machine-faults", "POST", {
      machineId: MACHINE,
      reportedAt: "2026-02-17T08:00:00+01:00",
      title: "Skupa pumpa",
      priority: "HIGH",
      estimatedCostAmount: "700.00",
      estimatedCostCurrency: "BAM",
    }));
    expect(expensive.status).toBe(200);
    const expensiveId = ((await expensive.json()) as Envelope<{ id: string }>).data.id;

    const cheap = await faultCreate(req(cookieOwner, "/api/machine-faults", "POST", {
      machineId: MACHINE,
      reportedAt: "2026-02-17T09:00:00+01:00",
      title: "Filter",
      priority: "LOW",
      estimatedCostAmount: "100.00",
      estimatedCostCurrency: "BAM",
    }));
    expect(cheap.status).toBe(200);
    const cheapId = ((await cheap.json()) as Envelope<{ id: string }>).data.id;

    const statuses = await admin.query<{ id: string; status: string }>(
      "SELECT id, status FROM public.machine_faults WHERE company_id = $1 AND id = ANY($2::text[])",
      [COMPANY, [expensiveId, cheapId]],
    );
    const byId = new Map(statuses.rows.map((row) => [row.id, row.status]));
    expect(byId.get(expensiveId)).toBe("WAITING_APPROVAL");
    expect(byId.get(cheapId)).toBe("OPEN");

    // Ispod praga nema zahtjeva za odobrenje — inače bi vlasnik odobravao svaki filter.
    const requests = await admin.query<{ subject_id: string }>(
      `SELECT subject_id FROM public.approval_requests
        WHERE company_id = $1 AND subject_type = 'machine_fault'`,
      [COMPANY],
    );
    expect(requests.rows.map((row) => row.subject_id)).toEqual([expensiveId]);

    // Terenac (MACHINE_OPERATOR) ne odobrava trošak.
    const denied = await faultApprove(
      req(cookieField, `/api/machine-faults/${expensiveId}/approve`, "POST"),
      { params: Promise.resolve({ id: expensiveId }) },
    );
    expect(denied.status).toBe(403);

    const approved = await faultApprove(
      req(cookieOwner, `/api/machine-faults/${expensiveId}/approve`, "POST"),
      { params: Promise.resolve({ id: expensiveId }) },
    );
    expect(approved.status).toBe(200);

    // Ponovno odobrenje je konflikt, ne drugi nalog: jedan kvar = jedan servisni nalog.
    const twice = await faultApprove(
      req(cookieOwner, `/api/machine-faults/${expensiveId}/approve`, "POST"),
      { params: Promise.resolve({ id: expensiveId }) },
    );
    expect(twice.status).toBe(409);

    const orders = await admin.query<{ amount_cents: string; description: string }>(
      "SELECT amount_cents::text, description FROM public.service_orders WHERE company_id = $1 AND fault_id = $2",
      [COMPANY, expensiveId],
    );
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0]!.amount_cents).toBe("70000");
    expect(orders.rows[0]!.description).toContain("Skupa pumpa");
  });

  /* ---------------------------------------------------------------- §1.8 najam */

  it("§1.8 najam postavlja RENTED i otvara komponentu RENTAL u stopi", async () => {
    const res = await rentalPost(
      req(cookieOwner, `/api/machines/${MACHINE}/rental`, "POST", {
        partnerId: PARTNER, rate: "300.00", basis: "PER_DAY", from: "2026-04-01",
      }),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    expect(res.status).toBe(200);
    const machine = await admin.query<{ ownership: string; rental_basis: string }>(
      "SELECT ownership, rental_basis FROM public.machines WHERE company_id = $1 AND id = $2",
      [COMPANY, MACHINE],
    );
    expect(machine.rows[0]!.ownership).toBe("RENTED");
    expect(machine.rows[0]!.rental_basis).toBe("PER_DAY");

    const component = await admin.query<{ basis: string; amount_cents: string }>(
      `SELECT basis, amount_cents::text FROM public.machine_cost_components
        WHERE company_id = $1 AND machine_id = $2 AND component = 'RENTAL'`,
      [COMPANY, MACHINE],
    );
    // 300 / 8 h = 37.50 → 3750 centi po satu.
    expect(component.rows[0]!.basis).toBe("PER_HOUR");
    expect(component.rows[0]!.amount_cents).toBe("3750");
  });

  it("§5.12 izolacija: firma B ne vidi komponente ni dnevne preglede firme A", async () => {
    const components = await componentsGet(
      req(cookieOther, `/api/machines/${MACHINE}/cost-components`),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    const body = (await components.json()) as Envelope<{ components: unknown[] }>;
    expect(body.data.components).toHaveLength(0);

    const templates = await templatesGet(req(cookieOther, "/api/check-templates"));
    const templatesBody = (await templates.json()) as Envelope<{ templates: unknown[] }>;
    expect(templatesBody.data.templates).toHaveLength(0);

    const segments = await segmentsGet(req(cookieOther, "/api/route-segments"));
    const segmentsBody = (await segments.json()) as Envelope<{ segments: unknown[] }>;
    expect(segmentsBody.data.segments).toHaveLength(0);

    // Tuđa mašina ne postoji za firmu A → NOT_FOUND, ne prazna lista sa tuđim podacima.
    const foreign = await rateGet(
      req(cookieOwner, `/api/machines/${MACHINE_OTHER}/cost-rate`),
      { params: Promise.resolve({ id: MACHINE_OTHER }) },
    );
    expect(foreign.status).toBe(404);
  });
});
