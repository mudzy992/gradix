import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import { companyId, withCompany } from "./tenant";

export const RUN = randomUUID().replace(/-/g, "").slice(0, 10);

export const A = {
  company: `cmp_fe_a_${RUN}`,
  user: `usr_fe_a_${RUN}`,
  worker: `wrk_fe_a_${RUN}`,
  project: `prj_fe_a_${RUN}`,
  machine: `mch_fe_a_${RUN}`,
  entry: `fuel_fe_a_${RUN}`,
  driverUser: `usr_fe_drv_a_${RUN}`,
};

export const B = {
  company: `cmp_fe_b_${RUN}`,
  user: `usr_fe_b_${RUN}`,
  worker: `wrk_fe_b_${RUN}`,
  project: `prj_fe_b_${RUN}`,
  machine: `mch_fe_b_${RUN}`,
  entry: `fuel_fe_b_${RUN}`,
};

export const NAMED_CONSTRAINTS = [
  { table: "fuel_entries", name: "fuel_entries_liters_check" },
  { table: "fuel_entries", name: "fuel_entries_currency_check" },
  { table: "fuel_entries", name: "fuel_entries_company_id_unique" },
  { table: "fuel_entry_revisions", name: "fuel_entry_revisions_entry_fk" },
] as const;

export async function seedFuelCompanies(admin: Pool): Promise<void> {
  await admin.query(
    `INSERT INTO public.companies (id, name, slug)
     VALUES ($1, 'Fuel test A', $3), ($2, 'Fuel test B', $4)`,
    [A.company, B.company, `fe-a-${RUN}`, `fe-b-${RUN}`],
  );
  await admin.query(
    `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
     VALUES ($1, $3, 'test-hash', 'Fuel', 'A', false), ($2, $4, 'test-hash', 'Fuel', 'B', false)`,
    [A.user, B.user, `fe-a-${RUN}@test.example`, `fe-b-${RUN}@test.example`],
  );
}

export async function seedTenantFuel(admin: Pool, fixture: typeof A | typeof B): Promise<void> {
  await withCompany(admin, companyId(fixture.company), async (client) => {
    await client.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Driver', $3, '2026-11-19'::date)`,
      [fixture.worker, fixture.company, fixture === A ? "A" : "B"],
    );
    await client.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ($1, $2, $3, $4)`,
      [fixture.project, fixture.company, `FE-${fixture === A ? "A" : "B"}`, `Project ${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.machines
         (id, company_id, code, name, category_id, meter_value, meter_updated_at)
       VALUES ($1, $2, $3, 'Fuel test machine', $2 || '_cat_truck', 100.0, clock_timestamp())`,
      [fixture.machine, fixture.company, `FE-M-${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.fuel_entries
         (id, company_id, machine_id, driver_worker_id, project_id, filled_at,
          liters, amount_cents, currency_code, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, '2026-11-19T10:00:00Z', 50.0, 12500, 'BAM', $6, $6)`,
      [fixture.entry, fixture.company, fixture.machine, fixture.worker, fixture.project, fixture.user],
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

export async function teardownFuel(admin: Pool): Promise<void> {
  for (const fixture of [A, B]) {
    await withCompany(admin, companyId(fixture.company), async (client: PoolClient) => {
      await client.query("DELETE FROM public.fuel_entry_revisions WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_meter_readings WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.fuel_entries WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_work_log_revisions WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_work_logs WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machines WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.projects WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.workers WHERE company_id = $1", [fixture.company]);
    });
    await admin.query("DELETE FROM public.companies WHERE id = $1", [fixture.company]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [fixture.user]);
  }
}