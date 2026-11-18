/** R4b: potvrda blokirana uz OPEN conflict / OPEN segment. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmWorkday } from "./workday-approval";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_r4bg_${RUN}`;
const DATE = "2026-11-18";
const ss = { userId: `usr_r4bg_ss_${RUN}`, companyId: CO, roles: ["SITE_SUPERVISOR"] as const };

describeDb("R4b confirm gates (PostgreSQL)", () => {
  const dbAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const dbApp = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    await dbAdmin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'R4bg', $2)", [CO, `r4bg-${RUN}`]);
    await dbAdmin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'ss-${RUN}@test.example', 'x', 'S', 'T', false)`,
      [ss.userId],
    );
    await dbAdmin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id, hired_at)
       VALUES ('wrk_r4bg_ss_${RUN}', $1, 'Sef', 'T', $2, '2024-01-01'),
              ('wrk_r4bg_in_${RUN}', $1, 'Rad', 'In', NULL, '2024-01-01')`,
      [CO, ss.userId],
    );
    await dbAdmin.query(
      `INSERT INTO public.projects (id, company_id, code, name) VALUES ('prj_r4bg_${RUN}', $1, 'G-${RUN}', 'G')`,
      [CO],
    );
    await dbAdmin.query(
      `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date)
       VALUES ('pas_r4bg_1_${RUN}', $1, 'prj_r4bg_${RUN}', 'wrk_r4bg_ss_${RUN}', '2026-01-01'),
              ('pas_r4bg_2_${RUN}', $1, 'prj_r4bg_${RUN}', 'wrk_r4bg_in_${RUN}', '2026-01-01')`,
      [CO],
    );
    await dbAdmin.query(
      `INSERT INTO public.workdays
         (id, company_id, worker_id, work_date, status, approval_status, created_by, updated_by)
       VALUES ('wd_r4bg_open_${RUN}', $1, 'wrk_r4bg_in_${RUN}', $2::date, 'SUBMITTED', 'SUBMITTED', $3, $3),
              ('wd_r4bg_cnf_${RUN}', $1, 'wrk_r4bg_in_${RUN}', '2026-11-19'::date, 'SUBMITTED', 'SUBMITTED', $3, $3)`,
      [CO, DATE, ss.userId],
    );
    await dbAdmin.query(
      `INSERT INTO public.work_entries
         (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
       VALUES ('we_r4bg_open_${RUN}', $1, 'wd_r4bg_open_${RUN}', 'wrk_r4bg_in_${RUN}', 'WORK',
               '2026-11-18T08:00:00Z', NULL, 'OPEN', 'prj_r4bg_${RUN}', $2, $2),
              ('we_r4bg_cnf_${RUN}', $1, 'wd_r4bg_cnf_${RUN}', 'wrk_r4bg_in_${RUN}', 'WORK',
               '2026-11-19T08:00:00Z', '2026-11-19T16:00:00Z', 'KNOWN_END', 'prj_r4bg_${RUN}', $2, $2)`,
      [CO, ss.userId],
    );
    await dbAdmin.query(
      `INSERT INTO public.sync_conflicts
         (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version)
       VALUES ('cnf_r4bg_${RUN}', $1, $2, 'local-${RUN}', 'we_r4bg_cnf_${RUN}',
               '{}'::jsonb, $3, 1)`,
      [CO, ss.userId, "b".repeat(64)],
    );
  }, 60_000);

  afterAll(async () => { await dbAdmin.end(); await dbApp.end(); });

  it("OPEN segment → VALIDATION; OPEN conflict → VALIDATION", async () => {
    const openSeg = await confirmWorkday(dbApp, ss, `wd_r4bg_open_${RUN}`);
    expect(openSeg).toMatchObject({ outcome: "VALIDATION_FAILED", code: "OPEN_SEGMENT" });
    const openCnf = await confirmWorkday(dbApp, ss, `wd_r4bg_cnf_${RUN}`);
    expect(openCnf).toMatchObject({ outcome: "VALIDATION_FAILED", code: "OPEN_CONFLICT" });
  });
});
