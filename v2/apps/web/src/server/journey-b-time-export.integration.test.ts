/** Journey B: confirm, approve, and lock one week, then export those hours. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { listHoursForExport } from "./hours-export-service";
import type { HoursExportActor } from "./hours-export-types";
import { confirmWorkday } from "./workday-approval";
import { decideWeek, lockWeek } from "./workday-week-actions";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_jb_${RUN}`;
const OTHER = `cmp_jbx_${RUN}`;
const WEEK = "2026-11-16";
const DATE = "2026-11-18";
const OPEN_DATE = "2026-11-19";
const ss = { userId: `usr_jb_ss_${RUN}`, companyId: CO, roles: ["SITE_SUPERVISOR"] as const };
const owner = { userId: `usr_jb_own_${RUN}`, companyId: CO, roles: ["OWNER"] as const };
const adminActor = { userId: `usr_jb_adm_${RUN}`, companyId: CO, roles: ["ADMIN"] as const };
const acct: HoursExportActor = { userId: `usr_jb_acc_${RUN}`, companyId: CO, roles: ["ACCOUNTANT"] };
const workerUser: HoursExportActor = { userId: `usr_jb_wrk_${RUN}`, companyId: CO, roles: ["WORKER"] };

describeDb("journey B time to export", () => {
  const dbAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const dbApp = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    await dbAdmin.query(
      `INSERT INTO public.companies (id, name, slug) VALUES ($1, 'JB', $2), ($3, 'JBX', $4)`,
      [CO, `jb-${RUN}`, OTHER, `jbx-${RUN}`],
    );
    await dbAdmin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1,$2,'x','S','S',false), ($3,$4,'x','O','O',false),
              ($5,$6,'x','A','A',false), ($7,$8,'x','C','C',false), ($9,$10,'x','W','W',false)`,
      [
        ss.userId, `ss-${RUN}@test.example`,
        owner.userId, `own-${RUN}@test.example`,
        adminActor.userId, `adm-${RUN}@test.example`,
        acct.userId, `acc-${RUN}@test.example`,
        workerUser.userId, `wrk-${RUN}@test.example`,
      ],
    );
    await dbAdmin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id, hired_at)
       VALUES ($1, $2, 'Sef', 'Grada', $3, '2024-01-01'),
              ($4, $2, 'Amar', 'Hadzic', NULL, '2024-01-01')`,
      [`wrk_jb_ss_${RUN}`, CO, ss.userId, `wrk_jb_in_${RUN}`],
    );
    await dbAdmin.query(
      `INSERT INTO public.projects (id, company_id, code, name) VALUES ($1, $2, $3, 'Most')`,
      [`prj_jb_${RUN}`, CO, `JB-${RUN}`],
    );
    await dbAdmin.query(
      `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date)
       VALUES ($1, $2, $3, $4, '2026-01-01'), ($5, $2, $3, $6, '2026-01-01')`,
      [
        `pas_jb_ss_${RUN}`, CO, `prj_jb_${RUN}`, `wrk_jb_ss_${RUN}`,
        `pas_jb_in_${RUN}`, `wrk_jb_in_${RUN}`,
      ],
    );
    await dbAdmin.query(
      `INSERT INTO public.workdays
         (id, company_id, worker_id, work_date, status, approval_status, created_by, updated_by)
       VALUES ($1, $2, $3, $4::date, 'SUBMITTED', 'SUBMITTED', $5, $5),
              ($6, $2, $3, $7::date, 'SUBMITTED', 'SUBMITTED', $5, $5)`,
      [
        `wd_jb_ok_${RUN}`, CO, `wrk_jb_in_${RUN}`, DATE, owner.userId,
        `wd_jb_open_${RUN}`, OPEN_DATE,
      ],
    );
    await dbAdmin.query(
      `INSERT INTO public.work_entries
         (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'WORK', '2026-11-18T07:00:00Z', '2026-11-18T15:00:00Z', 'KNOWN_END', $5, $6, $6),
              ($7, $2, $8, $4, 'WORK', '2026-11-19T07:00:00Z', '2026-11-19T11:00:00Z', 'KNOWN_END', $5, $6, $6)`,
      [
        `we_jb_ok_${RUN}`, CO, `wd_jb_ok_${RUN}`, `wrk_jb_in_${RUN}`, `prj_jb_${RUN}`, owner.userId,
        `we_jb_open_${RUN}`, `wd_jb_open_${RUN}`,
      ],
    );
  }, 60_000);

  afterAll(async () => {
    await dbAdmin.end();
    await dbApp.end();
  });

  it("potvrda, odobrenje i zaključavanje upisuju LOCKED sate u izvoz", async () => {
    const confirmed = await confirmWorkday(dbApp, ss, `wd_jb_ok_${RUN}`);
    expect(confirmed).toEqual({ outcome: "OK", workdayId: `wd_jb_ok_${RUN}`, status: "FOREMAN_CONFIRMED" });
    const approved = await decideWeek(dbApp, owner, { weekStart: WEEK, decision: "APPROVE" });
    expect(approved).toMatchObject({ outcome: "OK", status: "WEEK_APPROVED" });
    const locked = await lockWeek(dbApp, adminActor, WEEK);
    expect(locked).toMatchObject({ outcome: "OK", status: "LOCKED" });
    const stored = await withCompany(dbApp, companyId(CO), (client) => client.query<{ approval_status: string; week_status: string }>(
      `SELECT d.approval_status, w.status AS week_status
         FROM public.workdays d
         JOIN public.work_week_approvals w ON w.company_id = d.company_id AND w.week_start = $2::date
        WHERE d.company_id = $1 AND d.id = $3`,
      [CO, WEEK, `wd_jb_ok_${RUN}`],
    ));
    expect(stored.rows[0]).toEqual({ approval_status: "LOCKED", week_status: "LOCKED" });
    const openDay = await withCompany(dbApp, companyId(CO), (client) => client.query<{ approval_status: string }>(
      `SELECT approval_status FROM public.workdays WHERE company_id = $1 AND id = $2`,
      [CO, `wd_jb_open_${RUN}`],
    ));
    expect(openDay.rows[0]?.approval_status).toBe("SUBMITTED");
    const rows = await listHoursForExport(dbApp, acct, { from: "2026-11-01", to: "2026-11-30" });
    expect(rows).toEqual([
      expect.objectContaining({
        workerId: `wrk_jb_in_${RUN}`,
        date: DATE,
        hours: "8.000",
        status: "LOCKED",
        projectId: `prj_jb_${RUN}`,
      }),
    ]);
    expect(rows.some((row) => row.date === OPEN_DATE)).toBe(false);
    const denied = await listHoursForExport(dbApp, workerUser, { from: "2026-11-01", to: "2026-11-30" });
    expect(denied).toEqual([]);
    const foreign = await listHoursForExport(
      dbApp,
      { ...acct, companyId: OTHER },
      { from: "2026-11-01", to: "2026-11-30" },
    );
    expect(foreign).toEqual([]);
  });
});
