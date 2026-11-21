/**
 * C.1 — Pregled: opseg po rolama, tenant izolacija, prazna stanja, i ugovor API-ja.
 *
 * Dokazuje kroz pravu bazu (RLS, aplikacijska rola) i pravi servis:
 *  (1) WORKER ne dobija novi pregled (null), OWNER/ADMIN/PM ga dobijaju;
 *  (2) PM s PROJECTS opsegom vidi SAMO svoj projekat: rok, blokadu, dane i sažetak
 *      druge firme-drugog projekta ne cure u njegove brojeve;
 *  (3) sinhronizaciju vide SAMO OWNER i ADMIN (PM dobija `null`, ne praznu listu);
 *  (4) admin jedne firme ne vidi ni red druge firme (izolacija pod admin rolom);
 *  (5) firma bez ničega vraća prazno stanje bez laži (nule, ne greške);
 *  (6) GET /api/pregled čuva istu granicu: 200 / 403 / 401.
 *
 * Drugi describe (indeksi i p95) živi na DEMO podacima — vidi dolje.
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { GET as pregledRoute } from "@/app/api/pregled/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { buildPregled, type PregledActor } from "./pregled-service";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_c1_${RUN}`;
const CO_OTHER = `cmp_c1o_${RUN}`;
const CO_EMPTY = `cmp_c1e_${RUN}`; // firma bez i jednog reda — prazno stanje pregleda
const PA = `prj_c1_a_${RUN}`;
const PB = `prj_c1_b_${RUN}`;

const USERS = {
  owner: `usr_c1_owner_${RUN}`,
  admin: `usr_c1_admin_${RUN}`,
  pm: `usr_c1_pm_${RUN}`,
  worker: `usr_c1_worker_${RUN}`,
} as const;

const WRK_1 = `wrk_c1_one_${RUN}`; // dodijeljen na projekat A (u PM opsegu)
const WRK_2 = `wrk_c1_two_${RUN}`; // dodijeljen na projekat B (van PM opsega)
const WRK_PM = `wrk_c1_pm_${RUN}`; // radnik-veza PM-a, na projekat A
const MCH_1 = `mch_c1_one_${RUN}`; // na projekat A
const MCH_2 = `mch_c1_two_${RUN}`; // na projekat B
const TYPE_BLOCK = `obt_c1_blk_${RUN}`; // tip koji blokira dodjelu
const TYPE_PLAIN = `obt_c1_plain_${RUN}`; // tip koji ne blokira
const TYPE_SOON = `obt_c1_soon_${RUN}`; // drugi ne-blokirajući tip (jedna aktivna obaveza po entitetu i tipu)
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function cookieFor(userId: string, co: string): string {
  return `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: `ses_${userId}`, companyId: co })}`;
}

/** Trik iz scope-roles testa: sesija postoji u bazi, token je potpisan za nju. */
async function insertSessions(app: Pool, co: string) {
  await withCompany(app, companyId(co), async (client) => {
    for (const id of Object.values(USERS)) {
      await client.query(
        `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, clock_timestamp() + interval '1 day')
         ON CONFLICT (id) DO NOTHING`,
        [`ses_${id}`, co, id, `hash_${id}_${RUN}`],
      );
    }
  });
}

describeDb("C.1 Pregled: opseg po rolama, izolacija i prazna stanja", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 4 });

  beforeAll(async () => {
    for (const [co, name] of [
      [CO, "C1 Pregled test"],
      [CO_OTHER, "C1 Druga firma"],
      [CO_EMPTY, "C1 Prazna firma"],
    ] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, $2, $3)", [
        co,
        name,
        `c1-${co}`,
      ]);
    }
    for (const [key, id] of Object.entries(USERS)) {
      await admin.query(
        "INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password) VALUES ($1, $2, 'x', $3, 'Test', false)",
        [id, `c1-${key}-${RUN}@test.example`, key],
      );
    }

    await withCompany(app, companyId(CO), async (client) => {
      await client.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope) VALUES
           ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
           ($4, $5, $3, ARRAY['ADMIN']::"Role"[], 'COMPANY'),
           ($6, $7, $3, ARRAY['PROJECT_MANAGER']::"Role"[], 'PROJECTS'),
           ($8, $9, $3, ARRAY['WORKER']::"Role"[], 'SELF')`,
        [
          `m1_${RUN}`, USERS.owner, CO,
          `m2_${RUN}`, USERS.admin,
          `m3_${RUN}`, USERS.pm,
          `m4_${RUN}`, USERS.worker,
        ],
      );
      // Projekti A (u PM opsegu) i B (van); radnici i mašine na njima.
      await client.query(
        `INSERT INTO public.projects (id, company_id, code, name, is_active) VALUES
           ($1, $2, 'C1-A', 'Dionica A', true), ($3, $2, 'C1-B', 'Dionica B', true)`,
        [PA, CO, PB],
      );
      await client.query(
        `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at, user_id) VALUES
           ($1, $2, 'Prvi', 'Radnik', '2024-01-01', $3),
           ($4, $2, 'Drugi', 'Radnik', '2024-01-01', NULL),
           ($5, $2, 'Voditelj', 'Projekta', '2024-01-01', $6)`,
        [WRK_1, CO, USERS.worker, WRK_2, WRK_PM, USERS.pm],
      );
      await client.query(
        `INSERT INTO public.equipment_categories (id, company_id, code, name, meter) VALUES ($1, $2, 'C1', 'C1 kategorija', 'HOURS')`,
        [`${CO}_cat_c1`, CO],
      );
      await client.query(
        `INSERT INTO public.machines (id, company_id, code, name, category_id) VALUES ($1, $2, 'C1-M1', 'Bager A', $4), ($3, $2, 'C1-M2', 'Bager B', $4)`,
        [MCH_1, CO, MCH_2, `${CO}_cat_c1`],
      );
      await client.query(
        `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date) VALUES
           ('asg1_${RUN}', $1, $2, $3, '2026-01-01'),
           ('asg2_${RUN}', $1, $4, $5, '2026-01-01'),
           ('asg3_${RUN}', $1, $2, $6, '2026-01-01')`,
        [CO, PA, WRK_1, PB, WRK_2, WRK_PM],
      );
      await client.query(
        `INSERT INTO public.project_assignments (id, company_id, project_id, machine_id, from_date) VALUES
           ('asg4_${RUN}', $1, $2, $3, '2026-01-01'),
           ('asg5_${RUN}', $1, $4, $5, '2026-01-01')`,
        [CO, PA, MCH_1, PB, MCH_2],
      );

      // Tipovi: jedan blokira dodjelu, drugi ne (B5.4 je podatak firme, ne pretpostavka).
      for (const [id, code, blocks] of [
        [TYPE_BLOCK, "C1_BLK", true],
        [TYPE_PLAIN, "C1_PLAIN", false],
        [TYPE_SOON, "C1_SOON", false],
      ] as const) {
        await client.query(
          `INSERT INTO public.obligation_types
             (id, company_id, code, label, entity_kind, default_reminder_days, requires_attachment, blocks_assignment, sort_order)
           VALUES ($1, $2, $3, $4, 'MACHINE', '{}', false, $5, 900)`,
          [id, CO, code, `C1 tip ${code}`, blocks],
        );
      }

      const todayRow = await client.query<{ today: string; tz: string }>(
        "SELECT (clock_timestamp() AT TIME ZONE timezone)::date::text AS today, timezone FROM public.companies WHERE id = $1",
        [CO],
      );
      const today = todayRow.rows[0]!.today;

      /** Obaveza = prazan red + verzija s rokom (trigger prenosi rok na obavezu). */
      const insertObligation = async (
        id: string,
        typeId: string,
        target: { workerId?: string; machineId?: string },
        expiresOffsetDays: number,
      ) => {
        await client.query(
          `INSERT INTO public.obligations (id, company_id, type_id, worker_id, machine_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, CO, typeId, target.workerId ?? null, target.machineId ?? null, USERS.owner],
        );
        await client.query(
          `INSERT INTO public.obligation_versions (id, company_id, obligation_id, version, expires_at, created_by)
           VALUES ($1, $2, $3, 1, ($4::date + $5::int), $6)`,
          [`v_${id}`, CO, id, today, expiresOffsetDays, USERS.owner],
        );
      };

      // Istekli: M1 (A, blokira) i W1 (A) vide i vlasnik i PM; M2 (B, blokira) i W2 (B) samo firma.
      await insertObligation(`obl_m1_${RUN}`, TYPE_BLOCK, { machineId: MCH_1 }, -5);
      await insertObligation(`obl_m2_${RUN}`, TYPE_BLOCK, { machineId: MCH_2 }, -5);
      await insertObligation(`obl_w1_${RUN}`, TYPE_PLAIN, { workerId: WRK_1 }, -1);
      await insertObligation(`obl_w2_${RUN}`, TYPE_PLAIN, { workerId: WRK_2 }, -1);
      // Uskoro (10 dana, A) i plan (45 dana, B).
      await insertObligation(`obl_w1_soon_${RUN}`, TYPE_SOON, { workerId: WRK_1 }, 10);
      await insertObligation(`obl_w2_plan_${RUN}`, TYPE_SOON, { workerId: WRK_2 }, 45);

      // Radni dan W1 s nepoznatim krajem (A) i W2 s otvorenim segmentom (B) — danas,
      // da „unosi ovaj tjedan“ bude izvjestan bez obzura na dan pokretanja testa.
      const entry = async (
        id: string,
        dayId: string,
        workerId: string,
        projectId: string,
        endState: "OPEN" | "UNKNOWN_END",
      ) => {
        await client.query(
          `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4::date, 'SUBMITTED', $5, $5)`,
          [dayId, CO, workerId, today, USERS.worker],
        );
        await client.query(
          `INSERT INTO public.work_entries
             (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 'WORK', clock_timestamp() - interval '2 hours', NULL, $5, $6, $7, $7)`,
          [id, CO, dayId, workerId, endState, projectId, USERS.worker],
        );
      };
      await entry(`we_w1_${RUN}`, `wd_w1_${RUN}`, WRK_1, PA, "UNKNOWN_END");
      await entry(`we_w2_${RUN}`, `wd_w2_${RUN}`, WRK_2, PB, "OPEN");

      // Sinhronizacija: radnik ima jedan prolaz i jedan REJECTED račun + jedan OPEN sukob;
      // PM je sinhronizovao čisto. Vlasnik/admin to moraju vidjeti po osobi.
      const receipt = async (actorId: string, localId: string, status: string) => {
        await client.query(
          `INSERT INTO public.sync_receipts (id, company_id, actor_id, local_id, request_hash, result, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::jsonb, clock_timestamp() - interval '1 hour')`,
          [CO, actorId, localId, sha256(localId), JSON.stringify({ localId, status, version: 1, cursor: null })],
        );
      };
      await receipt(USERS.worker, `c1-sync-ok-${RUN}`, "APPLIED");
      await receipt(USERS.worker, `c1-sync-bad-${RUN}`, "REJECTED");
      await receipt(USERS.pm, `c1-sync-pm-${RUN}`, "APPLIED");
      await client.query(
        `INSERT INTO public.sync_conflicts
           (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 1, 'OPEN', clock_timestamp() - interval '2 hours')`,
        [
          `cnf_c1_${RUN}`,
          CO,
          USERS.worker,
          `c1-cnf-${RUN}`,
          `we_w1_${RUN}`,
          JSON.stringify({ kind: "WORK", startedAt: `${today}T08:00:00+01:00`, endState: "KNOWN_END" }),
          sha256(`cnf_${RUN}`),
        ],
      );
    });

    // Druga firma: JEDNA istekla obaveza — dokaz da ne curi u prvu.
    await admin.query(
      "INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password) VALUES ($1, $2, 'x', 'Admin', 'Drugi', false)",
      [`usr_c1_admin_other_${RUN}`, `c1-admin-other-${RUN}@test.example`],
    );
    await withCompany(app, companyId(CO_OTHER), async (client) => {
      await client.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['ADMIN']::"Role"[], 'COMPANY')`,
        [`m5_${RUN}`, `usr_c1_admin_other_${RUN}`, CO_OTHER],
      );
      await client.query(
        `INSERT INTO public.obligation_types
           (id, company_id, code, label, entity_kind, default_reminder_days, requires_attachment, blocks_assignment, sort_order)
         VALUES ($1, $2, 'C1O', 'Tip druge firme', 'MACHINE', '{}', false, false, 900)`,
        [`obt_c1o_${RUN}`, CO_OTHER],
      );
      await client.query(
        `INSERT INTO public.obligations (id, company_id, type_id, scope_company, created_by) VALUES ($1, $2, $3, true, $4)`,
        [`obl_c1o_${RUN}`, CO_OTHER, `obt_c1o_${RUN}`, `usr_c1_admin_other_${RUN}`],
      );
      await client.query(
        `INSERT INTO public.obligation_versions (id, company_id, obligation_id, version, expires_at, created_by)
         VALUES ($1, $2, $3, 1, '2020-01-01', $4)`,
        [`v_obl_c1o_${RUN}`, CO_OTHER, `obl_c1o_${RUN}`, `usr_c1_admin_other_${RUN}`],
      );
    });

    await insertSessions(app, CO);
  }, 90_000);

  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  const owner: PregledActor = { userId: USERS.owner, roles: ["OWNER"], scope: "COMPANY", projectIds: [] };
  const adminActor: PregledActor = { userId: USERS.admin, roles: ["ADMIN"], scope: "COMPANY", projectIds: [] };
  const pm: PregledActor = { userId: USERS.pm, roles: ["PROJECT_MANAGER"], scope: "PROJECTS", projectIds: [PA] };
  const worker: PregledActor = { userId: USERS.worker, roles: ["WORKER"], scope: "SELF", projectIds: [] };

  it("WORKER ne dobija novi pregled (null) — granica je dozvola, ne slučajnost ekrana", async () => {
    expect(await buildPregled(app, companyId(CO), worker)).toBeNull();
  });

  it("OWNER vidi cijelu firmu: sva četiri istekla, obje blokade, oba dana za provjeru", async () => {
    const result = await buildPregled(app, companyId(CO), owner);
    expect(result).not.toBeNull();
    expect(result!.attention.expired.count).toBe(4);
    expect(result!.attention.blockedAssignments.count).toBe(2); // M1 (A) + M2 (B)
    expect(result!.attention.reviewDays.count).toBe(2); // W1 kraj nepoznat + W2 otvoren segment
    expect(result!.attention.expiring30.count).toBe(1);
    expect(result!.attention.expiring3190.count).toBe(1);
    expect(result!.scope).toBe("company");
    expect(result!.summary.activeProjects).toBe(2);
    expect(result!.summary.activeWorkers).toBe(3); // W1 + W2 + PM-ova veza
    expect(result!.summary.activeMachines).toBe(2);
    expect(result!.summary.entriesThisWeek).toBe(2);
  });

  it("OWNER vidi sinhronizaciju: radnik 2 neuspješne stavke (REJECTED + OPEN sukob), PM čist", async () => {
    const result = await buildPregled(app, companyId(CO), owner);
    expect(result!.sync).not.toBeNull();
    const byUser = new Map(result!.sync!.map((row) => [row.userId, row]));
    expect(byUser.get(USERS.worker)!.failedItems).toBe(2);
    expect(byUser.get(USERS.pm)!.failedItems).toBe(0);
    expect(byUser.size).toBe(2);
  });

  it("PM s PROJECTS opsegom vidi SAMO projekat A: dva istekla, jedna blokada, jedan dan", async () => {
    const result = await buildPregled(app, companyId(CO), pm);
    expect(result).not.toBeNull();
    expect(result!.scope).toBe("projects");
    expect(result!.attention.expired.count).toBe(2); // M1 + W1; M2/W2 su na B
    expect(result!.attention.blockedAssignments.count).toBe(1); // samo M1 (A)
    expect(result!.attention.reviewDays.count).toBe(1); // samo W1 (dijeli projekat A s PM-om)
    expect(result!.attention.expiring3190.count).toBe(0); // rok od 45 dana je na W2 (B)
    expect(result!.summary.activeProjects).toBe(1);
    expect(result!.summary.entriesThisWeek).toBe(1); // samo unos na projektu A
  });

  it("PM NE vidi sinhronizaciju: null, ne prazna lista (nema laži da „nema“)", async () => {
    const result = await buildPregled(app, companyId(CO), pm);
    expect(result!.sync).toBeNull();
  });

  it("ADMIN vidi isto kao OWNER, uključujući sinhronizaciju", async () => {
    const result = await buildPregled(app, companyId(CO), adminActor);
    expect(result!.attention.expired.count).toBe(4);
    expect(result!.sync!.length).toBe(2);
  });

  it("tenant izolacija pod admin rolom: obaveza druge firme ne ulazi u broj prve", async () => {
    const result = await buildPregled(app, companyId(CO), adminActor);
    expect(result!.attention.expired.count).toBe(4); // ostalo 4, peta je u drugoj firmi
    const ids = result!.attention.expired.oldest.map((item) => `${item.typeLabel} ${item.target}`);
    expect(ids.some((label) => label.includes("C1 tip C1_BLK"))).toBe(true);
    // Ne postoji nijedan primjer iz druge firme (tip "C1O" je jedini tamo).
    expect(ids.every((label) => !label.includes("C1O"))).toBe(true);
  });

  it("prazna firma: sve nule i prazan niz sinhronizacije — ekran kaže „Ništa ne traži pažnju“", async () => {
    const result = await buildPregled(app, companyId(CO_EMPTY), owner);
    expect(result).not.toBeNull();
    expect(result!.attention.expired.count).toBe(0);
    expect(result!.attention.conflicts.count).toBe(0);
    expect(result!.attention.reviewDays.count).toBe(0);
    expect(result!.attention.blockedAssignments.count).toBe(0);
    expect(result!.attention.expiring30.count).toBe(0);
    expect(result!.attention.expiring3190.count).toBe(0);
    expect(result!.summary.activeProjects).toBe(0);
    expect(result!.sync).toEqual([]); // ADMIN ju vidi, ali nema ni jedne stavke
  });

  it("API: OWNER 200 sa šemom, WORKER 403, bez sesije 401", async () => {
    const ok = await pregledRoute(
      new NextRequest("http://interni/api/pregled", { headers: { cookie: cookieFor(USERS.owner, CO) } }),
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: { attention: { expired: { count: number } } } };
    expect(body.data.attention.expired.count).toBe(4);

    const forbidden = await pregledRoute(
      new NextRequest("http://interni/api/pregled", { headers: { cookie: cookieFor(USERS.worker, CO) } }),
    );
    expect(forbidden.status).toBe(403);

    const anonymous = await pregledRoute(new NextRequest("http://interni/api/pregled"));
    expect(anonymous.status).toBe(401);
  });
});
