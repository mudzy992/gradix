/**
 * A2: opseg pregleda radnih dana na pravoj bazi.
 * OWNER/ACCOUNTANT = cijela firma; PM/šef = samo radnici s kojima dijele R3 dodjelu
 * važeću na datum dana; bez povezanog radnika = prazno; druga firma = nikad vidljiva.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { canResolveConflict, listWorkdaysForReview, resolveViewerWorkerId, workdayResolveScopeFor, workdayResolveScopeFor } from "./workday-review";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_wdr_${RUN}`;
const OTHER = `cmp_wdrx_${RUN}`;
const DATE = "2026-11-10";

describeDb("workday review scope (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    for (const [id, slug] of [[CO, `wdr-${RUN}`], [OTHER, `wdrx-${RUN}`]] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'WDR test', $2)", [id, slug]);
    }
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ('usr_wdr_pm_${RUN}', 'pm-${RUN}@test.example', 'x', 'PM', 'Test', false),
              ('usr_wdr_ss_${RUN}', 'ss-${RUN}@test.example', 'x', 'SS', 'Test', false)`,
    );
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id, hired_at)
       VALUES ('wrk_wdr_pm_${RUN}', $1, 'Pera', 'Vodja', 'usr_wdr_pm_${RUN}', '2024-01-01'),
              ('wrk_wdr_ss_${RUN}', $1, 'Sef', 'Ekipe', 'usr_wdr_ss_${RUN}', '2024-01-01'),
              ('wrk_wdr_in_${RUN}', $1, 'Radnik', 'UOpsegu', NULL, '2024-01-01'),
              ('wrk_wdr_out_${RUN}', $1, 'Radnik', 'IzvanOpsega', NULL, '2024-01-01'),
              ('wrk_wdr_other_${RUN}', $2, 'Radnik', 'DrugaFirma', NULL, '2024-01-01')`,
      [CO, OTHER],
    );
    await admin.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ('prj_wdr_a_${RUN}', $1, 'A-${RUN}', 'Projekat A'),
              ('prj_wdr_b_${RUN}', $1, 'B-${RUN}', 'Projekat B'),
              ('prj_wdr_x_${RUN}', $2, 'X-${RUN}', 'Projekat X')`,
      [CO, OTHER],
    );
    await admin.query(
      `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date)
       VALUES ('pas_wdr_1_${RUN}', $1, 'prj_wdr_a_${RUN}', 'wrk_wdr_pm_${RUN}', '2026-01-01'),
              ('pas_wdr_2_${RUN}', $1, 'prj_wdr_a_${RUN}', 'wrk_wdr_ss_${RUN}', '2026-01-01'),
              ('pas_wdr_3_${RUN}', $1, 'prj_wdr_a_${RUN}', 'wrk_wdr_in_${RUN}', '2026-01-01'),
              ('pas_wdr_4_${RUN}', $1, 'prj_wdr_b_${RUN}', 'wrk_wdr_out_${RUN}', '2026-01-01')`,
      [CO],
    );
    await admin.query(
      `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
       VALUES ('wd_wdr_in_${RUN}', $1, 'wrk_wdr_in_${RUN}', $3::date, 'SUBMITTED', 'usr_wdr_pm_${RUN}', 'usr_wdr_pm_${RUN}'),
              ('wd_wdr_out_${RUN}', $1, 'wrk_wdr_out_${RUN}', $3::date, 'SUBMITTED', 'usr_wdr_pm_${RUN}', 'usr_wdr_pm_${RUN}'),
              ('wd_wdr_x_${RUN}', $2, 'wrk_wdr_other_${RUN}', $3::date, 'SUBMITTED', 'usr_wdr_pm_${RUN}', 'usr_wdr_pm_${RUN}')`,
      [CO, OTHER, DATE],
    );
  }, 60_000);

  // Čišćenje kao u ostalim suiteovima: dodjele se ne brišu (historijski dokaz,
  // PROJECT_ASSIGNMENT_DELETE_FORBIDDEN), a RUN-jedinstveni ID-evi izoluju fixture.
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it("OWNER i ACCOUNTANT vide cijelu firmu, nikad drugu firmu", async () => {
    for (const roles of [["OWNER"], ["ACCOUNTANT"]] as const) {
      const rows = await withCompany(app, companyId(CO), (client) =>
        listWorkdaysForReview(client, CO, workdayReviewScopeFor(roles, null)));
      expect(rows.map((row) => row.id).sort()).toEqual([`wd_wdr_in_${RUN}`, `wd_wdr_out_${RUN}`].sort());
    }
  });

  it("PM i šef vide samo radnike iz svog R3 opsega", async () => {
    for (const userId of [`usr_wdr_pm_${RUN}`, `usr_wdr_ss_${RUN}`]) {
      const rows = await withCompany(app, companyId(CO), async (client) => {
        const viewer = await resolveViewerWorkerId(client, CO, userId);
        return listWorkdaysForReview(client, CO, workdayReviewScopeFor(["PROJECT_MANAGER"], viewer));
      });
      expect(rows.map((row) => row.id)).toEqual([`wd_wdr_in_${RUN}`]);
    }
  });

  it("R4a-2: opseg razrješenja — PM vidi sukob samo na danu iz svog opsega; ACCOUNTANT nema resolve opseg; tenant izolacija", async () => {
    // Opseg razrješenja nad istim fixture danima: PM (povezan radnik) -> assignments
    // opseg pokriva samo dan radnika u opsegu, nikad drugu firmu.
    const scoped = await withCompany(app, companyId(CO), async (client) => {
      const viewer = await resolveViewerWorkerId(client, CO, `usr_wdr_pm_${RUN}`);
      const scope = workdayResolveScopeFor(["PROJECT_MANAGER"], viewer);
      expect(scope.kind).toBe("assignments");
      return listWorkdaysForReview(client, CO, workdayReviewScopeFor(["PROJECT_MANAGER"], viewer));
    });
    expect(scoped.map((row) => row.id)).toEqual([`wd_wdr_in_${RUN}`]);

    // ACCOUNTANT: view = cijela firma, resolve = none.
    expect(workdayResolveScopeFor(["ACCOUNTANT"], null)).toEqual({ kind: "none" });
    expect(workdayResolveScopeFor(["OWNER"], null)).toEqual({ kind: "company" });

    // Strana u sukobu na stvarnim fixture ID-evima: PM je autor dana (created_by
    // usr_wdr_pm), pa kao radnik-strana ne razrješava; OWNER smije.
    const pmWorker = await withCompany(app, companyId(CO), (client) =>
      resolveViewerWorkerId(client, CO, `usr_wdr_pm_${RUN}`));
    expect(canResolveConflict({
      roles: ["PROJECT_MANAGER"],
      resolverWorkerId: pmWorker,
      partyWorkerIds: [pmWorker],
    })).toBe(false);
    expect(canResolveConflict({
      roles: ["OWNER"],
      resolverWorkerId: pmWorker,
      partyWorkerIds: [pmWorker],
    })).toBe(true);
  });

  it("PM/šef bez povezanog radnika vide prazno", async () => {
    const rows = await withCompany(app, companyId(CO), (client) =>
      listWorkdaysForReview(client, CO, workdayReviewScopeFor(["SITE_SUPERVISOR"], null)));
    expect(rows).toEqual([]);
  });
});
