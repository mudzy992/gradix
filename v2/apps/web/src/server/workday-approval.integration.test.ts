/**
 * R4b: prelazi stanja, RLS, constraint imena, sync gate, izolacija firmi.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { confirmWorkday, syncGateForWorkDate } from "./workday-approval";
import { decideWeek, lockWeek, reviseWorkday } from "./workday-week-actions";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_r4b_${RUN}`;
const OTHER = `cmp_r4bx_${RUN}`;
const WEEK = "2026-11-16";
const DATE = "2026-11-18";

const owner = { userId: `usr_r4b_own_${RUN}`, companyId: CO, roles: ["OWNER"] as const, scope: "COMPANY" as const, projectIds: null };
const admin = { userId: `usr_r4b_adm_${RUN}`, companyId: CO, roles: ["ADMIN"] as const, scope: "COMPANY" as const, projectIds: null };
const pm = { userId: `usr_r4b_pm_${RUN}`, companyId: CO, roles: ["PROJECT_MANAGER"] as const, scope: "COMPANY" as const, projectIds: null };
const pmOut = { userId: `usr_r4b_pmx_${RUN}`, companyId: CO, roles: ["PROJECT_MANAGER"] as const, scope: "COMPANY" as const, projectIds: null };
const ss = { userId: `usr_r4b_ss_${RUN}`, companyId: CO, roles: ["SITE_SUPERVISOR"] as const, scope: "COMPANY" as const, projectIds: null };
const acct = { userId: `usr_r4b_acc_${RUN}`, companyId: CO, roles: ["ACCOUNTANT"] as const, scope: "COMPANY" as const, projectIds: null };

describeDb("R4b approval (PostgreSQL)", () => {
  const dbAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const dbApp = new Pool({ connectionString: appUrl, max: 4 });

  beforeAll(async () => {
    for (const [id, slug] of [[CO, `r4b-${RUN}`], [OTHER, `r4bx-${RUN}`]] as const) {
      await dbAdmin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'R4b', $2)", [id, slug]);
    }
    await dbAdmin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1,'own-${RUN}@test.example','x','O','T',false),
              ($2,'adm-${RUN}@test.example','x','A','T',false),
              ($3,'pm-${RUN}@test.example','x','P','T',false),
              ($4,'pmx-${RUN}@test.example','x','X','T',false),
              ($5,'ss-${RUN}@test.example','x','S','T',false),
              ($6,'acc-${RUN}@test.example','x','C','T',false)`,
      [owner.userId, admin.userId, pm.userId, pmOut.userId, ss.userId, acct.userId],
    );
    await dbAdmin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id, hired_at)
       VALUES ('wrk_r4b_ss_${RUN}', $1, 'Sef', 'T', $2, '2024-01-01'),
              ('wrk_r4b_pm_${RUN}', $1, 'PM', 'T', $3, '2024-01-01'),
              ('wrk_r4b_pmx_${RUN}', $1, 'PMx', 'T', $4, '2024-01-01'),
              ('wrk_r4b_in_${RUN}', $1, 'Rad', 'In', NULL, '2024-01-01'),
              ('wrk_r4b_x_${RUN}', $5, 'Rad', 'X', NULL, '2024-01-01')`,
      [CO, ss.userId, pm.userId, pmOut.userId, OTHER],
    );
    await dbAdmin.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ('prj_r4b_a_${RUN}', $1, 'A-${RUN}', 'A'), ('prj_r4b_b_${RUN}', $1, 'B-${RUN}', 'B')`,
      [CO],
    );
    await dbAdmin.query(
      `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date)
       VALUES ('pas_r4b_1_${RUN}', $1, 'prj_r4b_a_${RUN}', 'wrk_r4b_ss_${RUN}', '2026-01-01'),
              ('pas_r4b_2_${RUN}', $1, 'prj_r4b_a_${RUN}', 'wrk_r4b_pm_${RUN}', '2026-01-01'),
              ('pas_r4b_3_${RUN}', $1, 'prj_r4b_a_${RUN}', 'wrk_r4b_in_${RUN}', '2026-01-01'),
              ('pas_r4b_4_${RUN}', $1, 'prj_r4b_b_${RUN}', 'wrk_r4b_pmx_${RUN}', '2026-01-01')`,
      [CO],
    );
    await dbAdmin.query(
      `INSERT INTO public.workdays
         (id, company_id, worker_id, work_date, status, approval_status, created_by, updated_by)
       VALUES ('wd_r4b_in_${RUN}', $1, 'wrk_r4b_in_${RUN}', $2::date, 'SUBMITTED', 'SUBMITTED', $3, $3),
              ('wd_r4b_x_${RUN}', $4, 'wrk_r4b_x_${RUN}', $2::date, 'SUBMITTED', 'SUBMITTED', $3, $3)`,
      [CO, DATE, owner.userId, OTHER],
    );
  }, 60_000);

  afterAll(async () => { await dbAdmin.end(); await dbApp.end(); });

  it("constraint imena R4b postoje tačno jednom", async () => {
    const rows = await dbAdmin.query<{ conname: string; n: string }>(
      `SELECT conname, count(*)::text AS n FROM pg_constraint
        WHERE conname IN (
          'workdays_approval_status_check', 'work_week_approvals_company_week_unique',
          'work_week_approvals_status_check', 'work_week_approvals_reason_check',
          'work_week_approvals_decision_check', 'workday_revisions_workday_fk'
        ) GROUP BY conname`,
    );
    expect(rows.rows).toHaveLength(6);
    for (const row of rows.rows) expect(row.n).toBe("1");
  });

  it("matrica prelaza: confirm → decide → lock; zabranjeni skokovi i uloge", async () => {
    expect((await confirmWorkday(dbApp, acct, `wd_r4b_in_${RUN}`)).outcome).toBe("FORBIDDEN");
    expect((await confirmWorkday(dbApp, owner, `wd_r4b_in_${RUN}`)).outcome).toBe("FORBIDDEN");
    expect((await decideWeek(dbApp, owner, { weekStart: WEEK, decision: "APPROVE" })).outcome)
      .toBe("VALIDATION_FAILED");
    const confirmed = await confirmWorkday(dbApp, ss, `wd_r4b_in_${RUN}`);
    expect(confirmed).toEqual({ outcome: "OK", workdayId: `wd_r4b_in_${RUN}`, status: "FOREMAN_CONFIRMED" });

    expect((await decideWeek(dbApp, acct, { weekStart: WEEK, decision: "APPROVE" })).outcome).toBe("FORBIDDEN");
    expect((await decideWeek(dbApp, ss, { weekStart: WEEK, decision: "APPROVE" })).outcome).toBe("FORBIDDEN");
    expect((await decideWeek(dbApp, pmOut, {
      weekStart: WEEK, decision: "REJECT", reason: "Nema radnika u opsegu ovog PM",
    })).outcome).toBe("FORBIDDEN");
    expect((await decideWeek(dbApp, owner, { weekStart: WEEK, decision: "REJECT", reason: "kratko" })).outcome)
      .toBe("VALIDATION_FAILED");
    const rejected = await decideWeek(dbApp, pm, {
      weekStart: WEEK, decision: "REJECT", reason: "Nedostaju sati na terenu",
    });
    expect(rejected.outcome).toBe("OK");
    if (rejected.outcome === "OK") expect(rejected.status).toBe("WEEK_REJECTED");

    const reconfirm = await confirmWorkday(dbApp, ss, `wd_r4b_in_${RUN}`);
    expect(reconfirm.outcome).toBe("OK");
    const approved = await decideWeek(dbApp, owner, { weekStart: WEEK, decision: "APPROVE" });
    expect(approved).toMatchObject({ outcome: "OK", status: "WEEK_APPROVED" });

    expect((await lockWeek(dbApp, ss, WEEK)).outcome).toBe("FORBIDDEN");
    expect((await lockWeek(dbApp, acct, WEEK)).outcome).toBe("FORBIDDEN");
    const locked = await lockWeek(dbApp, admin, WEEK);
    expect(locked).toMatchObject({ outcome: "OK", status: "LOCKED" });
    expect((await decideWeek(dbApp, owner, { weekStart: WEEK, decision: "APPROVE" })).outcome).toBe("CONFLICT");
    expect((await confirmWorkday(dbApp, ss, `wd_r4b_in_${RUN}`)).outcome).toBe("CONFLICT");
  });

  it("syncGate: WEEK_APPROVED→CONFLICT; LOCKED→REJECT; tenant RLS 0 redova", async () => {
    await withCompany(dbApp, companyId(CO), async (client) => {
      expect(await syncGateForWorkDate(client, CO, DATE)).toBe("LOCKED");
      await client.query(
        `UPDATE public.work_week_approvals SET status = 'WEEK_APPROVED'
          WHERE company_id = $1 AND week_start = $2::date`,
        [CO, WEEK],
      );
      expect(await syncGateForWorkDate(client, CO, DATE)).toBe("WEEK_APPROVED");
      await client.query(
        `UPDATE public.work_week_approvals SET status = 'LOCKED'
          WHERE company_id = $1 AND week_start = $2::date`,
        [CO, WEEK],
      );
      const other = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.workdays WHERE company_id = $1", [OTHER],
      );
      expect(other.rows[0]!.n).toBe(0);
    });
    await withCompany(dbApp, companyId(OTHER), async (client) => {
      const foreignWeek = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.work_week_approvals WHERE company_id = $1", [CO],
      );
      expect(foreignWeek.rows[0]!.n).toBe(0);
      const foreignRev = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.workday_revisions WHERE company_id = $1", [CO],
      );
      expect(foreignRev.rows[0]!.n).toBe(0);
    });
  });

  it("revizija: razlog ≥10; LOCKED original ne UPDATE; ACCOUNTANT/PM zabranjeni", async () => {
    const before = await dbAdmin.query<{ approval_status: string; header_version: number }>(
      "SELECT approval_status, header_version FROM public.workdays WHERE id = $1",
      [`wd_r4b_in_${RUN}`],
    );
    expect(before.rows[0]!.approval_status).toBe("LOCKED");
    expect((await reviseWorkday(dbApp, acct, {
      workdayId: `wd_r4b_in_${RUN}`, reason: "Ispravka sati nakon kontrole", payload: { note: "x" },
    })).outcome).toBe("FORBIDDEN");
    expect((await reviseWorkday(dbApp, pm, {
      workdayId: `wd_r4b_in_${RUN}`, reason: "Ispravka sati nakon kontrole", payload: {},
    })).outcome).toBe("FORBIDDEN");
    expect((await reviseWorkday(dbApp, owner, {
      workdayId: `wd_r4b_in_${RUN}`, reason: "kratko", payload: {},
    })).outcome).toBe("VALIDATION_FAILED");
    const ok = await reviseWorkday(dbApp, owner, {
      workdayId: `wd_r4b_in_${RUN}`, reason: "Ispravka sati nakon kontrole", payload: { hours: 8 },
    });
    expect(ok.outcome).toBe("OK");
    const after = await dbAdmin.query<{ approval_status: string; header_version: number }>(
      "SELECT approval_status, header_version FROM public.workdays WHERE id = $1",
      [`wd_r4b_in_${RUN}`],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const revs = await dbAdmin.query(
      "SELECT 1 FROM public.workday_revisions WHERE company_id = $1 AND workday_id = $2",
      [CO, `wd_r4b_in_${RUN}`],
    );
    expect(revs.rowCount).toBe(1);
    expect((await confirmWorkday(dbApp, ss, `wd_r4b_x_${RUN}`)).outcome).toBe("NOT_FOUND");
  });
});
