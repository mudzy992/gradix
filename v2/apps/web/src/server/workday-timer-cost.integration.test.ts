/**
 * F5/Korak 0 (odluka vlasnika): **timer → `FOREMAN_CONFIRMED` → JEDNA knjiga troška rada.**
 *
 * Bug koji ovaj test čuva: grupna potvrda (`bulkConfirm` — tok mobilnog timera) je samo mijenjala
 * status dana, a trošak je knjižila isključivo pojedinačna potvrda. Posljedica: sati potvrđeni
 * „jednim klikom“ nisu ulazili u trošak projekta, a to se ne vidi na ekranu jer je dan zelen.
 *
 * Druga polovina tvrdnje je jednako bitna: ponovna potvrda (poslije odbijene sedmice) NE smije
 * napraviti drugu knjigu, i jedna knjiga po danu/projektu ostaje jedna — bez obzira na to koliko
 * puta je potvrda ponovljena.
 */
import { randomUUID } from "node:crypto";
import { companyId } from "@gradix/db";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bulkConfirm } from "./workday-timer-service";
import { confirmWorkday } from "./workday-approval";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_tmr_${RUN}`;
const DATE = "2026-11-17";
const PROJECT = `prj_tmr_${RUN}`;
const WORKER = `wrk_tmr_${RUN}`;
const WORKDAY = `wd_tmr_${RUN}`;
const SUPERVISOR = `usr_tmr_ss_${RUN}`;

const ss = { userId: SUPERVISOR, companyId: companyId(CO), roles: ["SITE_SUPERVISOR"] as const };

describeDb("timer → potvrda šefa → jedna knjiga troška rada (PostgreSQL)", () => {
  const dbAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const dbApp = new Pool({ connectionString: appUrl, max: 4 });

  /** Radni dan jednog radnika: jedan zatvoren segment od 8 h na projektu + satnica. */
  async function seedDay(approvalStatus: "SUBMITTED" | "FOREMAN_CONFIRMED") {
    // Ledger brani DELETE (`COST_ENTRY_DELETE_FORBIDDEN`) — test čisti replicas modom.
    await dbAdmin.query("SET session_replication_role = replica");
    await dbAdmin.query("DELETE FROM public.cost_entries WHERE company_id = $1", [CO]);
    await dbAdmin.query("DELETE FROM public.work_entries WHERE company_id = $1", [CO]);
    await dbAdmin.query("DELETE FROM public.workdays WHERE company_id = $1", [CO]);
    await dbAdmin.query("SET session_replication_role = DEFAULT");
    await dbAdmin.query(
      `INSERT INTO public.workdays
         (id, company_id, worker_id, work_date, status, approval_status, created_by, updated_by)
       VALUES ($1, $2, $3, $4::date, 'SUBMITTED', $5, $6, $6)`,
      [WORKDAY, CO, WORKER, DATE, approvalStatus, SUPERVISOR],
    );
    await dbAdmin.query(
      `INSERT INTO public.work_entries
         (id, company_id, workday_id, worker_id, project_id, kind, started_at, ended_at,
          end_state, resolution_state, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'WORK', $6::date + time '07:00', $6::date + time '15:00',
               'KNOWN_END', 'ACTIVE', $7, $7)`,
      [`we_${RUN}_${approvalStatus}`, CO, WORKDAY, WORKER, PROJECT, DATE, SUPERVISOR],
    );
  }

  const workdayCostRows = () =>
    dbAdmin.query<{ source_id: string; status: string; amount_cents: string | null; quantity: string }>(
      `SELECT source_id, status, amount_cents::text, quantity::text
         FROM public.cost_entries
        WHERE company_id = $1 AND source_type = 'WORKDAY'
        ORDER BY id`,
      [CO],
    );

  beforeAll(async () => {
    await dbAdmin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'Timer', $2)", [
      CO,
      `tmr-${RUN}`,
    ]);
    await dbAdmin.query(
      `INSERT INTO public.users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $2, 'S', 'Sef', 'x', false)`,
      [SUPERVISOR, `ss-tmr-${RUN}@test.example`],
    );
    await dbAdmin.query(
      `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
       VALUES ($1, $2, $3, ARRAY['SITE_SUPERVISOR']::"Role"[], 'COMPANY')`,
      [`mem_tmr_${RUN}`, SUPERVISOR, CO],
    );
    await dbAdmin.query(
      /*
       * Šef MORA imati svoj zapis radnika sa `user_id`: `confirmWorkday` provjerava da je
       * potvrđivač raspoređen na isti projekat kao radnik čiji dan potvrđuje (`inForemanScope`).
       * Bez toga pojedinačna potvrda vraća `FORBIDDEN/SCOPE` — što je ispravno ponašanje, ali
       * nije ono što ovaj test mjeri.
       */
      `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id, hired_at)
       VALUES ($1, $2, 'R', 'Adnik', NULL, '2024-01-01'),
              ($3, $2, 'S', 'Sef', $4, '2024-01-01')`,
      [WORKER, CO, `wrk_tmr_ss_${RUN}`, SUPERVISOR],
    );
    await dbAdmin.query(
      `INSERT INTO public.projects (id, company_id, code, name) VALUES ($1, $2, $3, 'Timer projekat')`,
      [PROJECT, CO, `TMR-${RUN}`.slice(0, 20)],
    );
    await dbAdmin.query(
      // Satnica važi na dan rada — trošak se knjiži po cijeni tog dana, ne „trenutnoj“.
      `INSERT INTO public.worker_rates
         (id, company_id, worker_id, rate_kind, amount_cents, currency_code, valid_from,
          created_by)
       VALUES ($1, $2, $3, 'HOURLY', 1200, 'BAM', '2026-01-01', $4)`,
      [`wrt_tmr_${RUN}`, CO, WORKER, SUPERVISOR],
    );
    await dbAdmin.query(
      `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date)
       VALUES ($1, $2, $3, $4, '2026-01-01'),
              ($5, $2, $3, $6, '2026-01-01')`,
      [`pas_tmr_${RUN}`, CO, PROJECT, WORKER, `pas_tmr_ss_${RUN}`, `wrk_tmr_ss_${RUN}`],
    );
    await dbAdmin.query("SELECT public.seed_cost_categories($1)", [CO]);
  }, 60_000);

  afterAll(async () => {
    /*
     * `project_assignments` brani DELETE trigerom (`PROJECT_ASSIGNMENT_DELETE_FORBIDDEN`) — dodjela
     * se poništava (`voided_at`), ne briše. Zato čistimo replicas modom, kao ostali integracioni
     * testovi: briše se samo ono što je ovaj test napravio i samo za svoju firmu.
     */
    await dbAdmin.query("SET session_replication_role = replica");
    for (const table of [
      "cost_entries",
      "work_entries",
      "workdays",
      "worker_rates",
      "project_assignments",
      "projects",
      "workers",
      "memberships",
      "cost_categories",
    ]) {
      await dbAdmin.query(`DELETE FROM public.${table} WHERE company_id = $1`, [CO]);
    }
    await dbAdmin.query("SET session_replication_role = DEFAULT");
    await dbAdmin.query("DELETE FROM public.users WHERE id = $1", [SUPERVISOR]);
    await dbAdmin.query("DELETE FROM public.companies WHERE id = $1", [CO]);
    await dbAdmin.end();
    await dbApp.end();
  });

  it("grupna potvrda šefa knjiži TAČNO JEDAN trošak rada, i ponovni klik ne dodaje drugi", async () => {
    await seedDay("SUBMITTED");

    const first = await bulkConfirm(dbApp, ss, { projectId: PROJECT, workDate: DATE });
    expect(first).toMatchObject({ ok: true, confirmed: 1 });

    const after = await workdayCostRows();
    expect(after.rows).toHaveLength(1);
    const entry = after.rows[0]!;
    // `source_id` je složen `<workday>:<project>` — dan sa dva projekta knjiži dva reda, ne jedan.
    expect(entry.source_id).toBe(`${WORKDAY}:${PROJECT}`);
    expect(entry.status).toBe("POSTED");
    // 8 h × 12,00 BAM = 96,00 BAM.
    expect(entry.amount_cents).toBe("9600");
    expect(Number(entry.quantity)).toBe(8);

    // Ponovni klik: dan više nije `SUBMITTED`, pa se preskače — i dalje jedna knjiga.
    const second = await bulkConfirm(dbApp, ss, { projectId: PROJECT, workDate: DATE });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.confirmed).toBe(0);
    expect((await workdayCostRows()).rows).toHaveLength(1);
  });

  it("pojedinačna potvrda istog dana ne pravi duplikat (idempotentno po danu i projektu)", async () => {
    await seedDay("SUBMITTED");

    const single = await confirmWorkday(dbApp, ss, WORKDAY);
    expect(single).toMatchObject({ outcome: "OK", status: "FOREMAN_CONFIRMED" });
    expect((await workdayCostRows()).rows).toHaveLength(1);

    /*
     * Ponovni poziv van toka ponovne potvrde (`isReconfirm` traži `WEEK_REJECTED`) je odbijen kao
     * `CONFLICT/BAD_STATE` — i, što je poenta, ne dira knjigu: i dalje jedan red.
     */
    const again = await confirmWorkday(dbApp, ss, WORKDAY);
    expect(again.outcome).toBe("CONFLICT");
    expect((await workdayCostRows()).rows).toHaveLength(1);
  });

  it("bez satnice trošak čeka cijenu (`PENDING`, bez iznosa) — ne izmišlja nulu", async () => {
    await seedDay("SUBMITTED");
    await dbAdmin.query("DELETE FROM public.worker_rates WHERE company_id = $1", [CO]);

    const result = await bulkConfirm(dbApp, ss, { projectId: PROJECT, workDate: DATE });
    expect(result).toMatchObject({ ok: true, confirmed: 1 });

    const rows = await workdayCostRows();
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.status).toBe("PENDING");
    // Nula bi bila laž: trošak postoji, ali cijena nedostaje. Zato iznos NIJE 0.
    expect(rows.rows[0]!.amount_cents).toBeNull();

    await dbAdmin.query(
      `INSERT INTO public.worker_rates
         (id, company_id, worker_id, rate_kind, amount_cents, currency_code, valid_from,
          created_by)
       VALUES ($1, $2, $3, 'HOURLY', 1200, 'BAM', '2026-01-01', $4)`,
      [`wrt_tmr2_${RUN}`, CO, WORKER, SUPERVISOR],
    );
  });
});
