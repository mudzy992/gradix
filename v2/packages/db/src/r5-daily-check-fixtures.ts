import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import { companyId, withCompany } from "./tenant";

export const RUN = randomUUID().replace(/-/g, "").slice(0, 10);

export const A = {
  company: `cmp_dc_a_${RUN}`,
  user: `usr_dc_a_${RUN}`,
  worker: `wrk_dc_a_${RUN}`,
  project: `prj_dc_a_${RUN}`,
  machine: `mch_dc_a_${RUN}`,
  check: `mdc_dc_a_${RUN}`,
};

export const B = {
  company: `cmp_dc_b_${RUN}`,
  user: `usr_dc_b_${RUN}`,
  worker: `wrk_dc_b_${RUN}`,
  project: `prj_dc_b_${RUN}`,
  machine: `mch_dc_b_${RUN}`,
  check: `mdc_dc_b_${RUN}`,
};

export const NAMED_CONSTRAINTS = [
  { table: "machine_daily_checks", name: "machine_daily_checks_result_check" },
  { table: "machine_daily_checks", name: "machine_daily_checks_company_id_unique" },
  { table: "machine_daily_check_revisions", name: "machine_daily_check_revisions_check_fk" },
  { table: "machine_daily_check_attachments", name: "machine_daily_check_attachments_size_check" },
  { table: "machine_daily_check_attachments", name: "machine_daily_check_attachments_status_check" },
] as const;

export async function seedDailyCheckCompanies(admin: Pool): Promise<void> {
  await admin.query(
    `INSERT INTO public.companies (id, name, slug)
     VALUES ($1, 'Daily check A', $3), ($2, 'Daily check B', $4)`,
    [A.company, B.company, `dc-a-${RUN}`, `dc-b-${RUN}`],
  );
  await admin.query(
    `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
     VALUES ($1, $3, 'test-hash', 'Check', 'A', false), ($2, $4, 'test-hash', 'Check', 'B', false)`,
    [A.user, B.user, `dc-a-${RUN}@test.example`, `dc-b-${RUN}@test.example`],
  );
}

export async function seedTenantDailyCheck(admin: Pool, fixture: typeof A | typeof B): Promise<void> {
  await withCompany(admin, companyId(fixture.company), async (client) => {
    await client.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Op', $3, '2026-11-19'::date)`,
      [fixture.worker, fixture.company, fixture === A ? "A" : "B"],
    );
    await client.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ($1, $2, $3, $4)`,
      [fixture.project, fixture.company, `DC-${fixture === A ? "A" : "B"}`, `Project ${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.machines (id, company_id, code, name, category_id)
       VALUES ($1, $2, $3, 'Daily check machine', $2 || '_cat_excavator')`,
      [fixture.machine, fixture.company, `DC-M-${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.machine_daily_checks
         (id, company_id, machine_id, worker_id, project_id, checked_at,
          result, checklist_json, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'2026-11-19T07:00:00Z','PASS','{}'::jsonb,null,$6,$6)`,
      [
        fixture.check, fixture.company, fixture.machine, fixture.worker,
        fixture.project, fixture.user,
      ],
    );
  });
}

export async function expectAdminFailure(
  admin: Pool,
  company: string,
  query: string,
  values: unknown[],
  expected: RegExp,
): Promise<void> {
  await expect(
    withCompany(admin, companyId(company), (client) => client.query(query, values)),
  ).rejects.toThrow(expected);
}

export async function teardownDailyChecks(admin: Pool): Promise<void> {
  for (const fixture of [A, B]) {
    await withCompany(admin, companyId(fixture.company), async (client: PoolClient) => {
      await client.query("DELETE FROM public.machine_daily_check_attachments WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_daily_check_revisions WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_daily_checks WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machines WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.projects WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.workers WHERE company_id = $1", [fixture.company]);
    });
    await admin.query("DELETE FROM public.companies WHERE id = $1", [fixture.company]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [fixture.user]);
  }
}
