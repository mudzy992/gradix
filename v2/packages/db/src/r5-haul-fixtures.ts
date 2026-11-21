import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import { companyId, withCompany } from "./tenant";

export const RUN = randomUUID().replace(/-/g, "").slice(0, 10);

export const A = {
  company: `cmp_hl_a_${RUN}`,
  user: `usr_hl_a_${RUN}`,
  worker: `wrk_hl_a_${RUN}`,
  project: `prj_hl_a_${RUN}`,
  machine: `mch_hl_a_${RUN}`,
  segment: `seg_hl_a_${RUN}`,
  haul: `haul_hl_a_${RUN}`,
};

export const B = {
  company: `cmp_hl_b_${RUN}`,
  user: `usr_hl_b_${RUN}`,
  worker: `wrk_hl_b_${RUN}`,
  project: `prj_hl_b_${RUN}`,
  machine: `mch_hl_b_${RUN}`,
  segment: `seg_hl_b_${RUN}`,
  haul: `haul_hl_b_${RUN}`,
};

export const NAMED_CONSTRAINTS = [
  { table: "route_segments", name: "route_segments_company_id_unique" },
  { table: "hauls", name: "hauls_quantity_check" },
  { table: "hauls", name: "hauls_quantity_unit_check" },
  { table: "hauls", name: "hauls_trip_count_check" },
  { table: "hauls", name: "hauls_company_id_unique" },
  { table: "haul_revisions", name: "haul_revisions_haul_fk" },
] as const;

export async function seedHaulCompanies(admin: Pool): Promise<void> {
  await admin.query(
    `INSERT INTO public.companies (id, name, slug)
     VALUES ($1, 'Haul test A', $3), ($2, 'Haul test B', $4)`,
    [A.company, B.company, `hl-a-${RUN}`, `hl-b-${RUN}`],
  );
  await admin.query(
    `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
     VALUES ($1, $3, 'test-hash', 'Haul', 'A', false), ($2, $4, 'test-hash', 'Haul', 'B', false)`,
    [A.user, B.user, `hl-a-${RUN}@test.example`, `hl-b-${RUN}@test.example`],
  );
}

export async function seedTenantHaul(admin: Pool, fixture: typeof A | typeof B): Promise<void> {
  await withCompany(admin, companyId(fixture.company), async (client) => {
    await client.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Driver', $3, '2026-11-19'::date)`,
      [fixture.worker, fixture.company, fixture === A ? "A" : "B"],
    );
    await client.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ($1, $2, $3, $4)`,
      [fixture.project, fixture.company, `HL-${fixture === A ? "A" : "B"}`, `Project ${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.machines
         (id, company_id, code, name, category_id)
       VALUES ($1, $2, $3, 'Haul test truck', $2 || '_cat_truck')`,
      [fixture.machine, fixture.company, `HL-M-${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.route_segments
         (id, company_id, project_id, code, name, from_station, to_station)
       VALUES ($1, $2, $3, $4, $5, 'Stanica 0', 'Stanica 1')`,
      [
        fixture.segment, fixture.company, fixture.project,
        `SEG-${fixture === A ? "A" : "B"}`, `Dionica ${fixture === A ? "A" : "B"}`,
      ],
    );
    await client.query(
      `INSERT INTO public.hauls
         (id, company_id, machine_id, driver_worker_id, project_id, segment_id, hauled_at,
          origin_text, destination_text, material_text, quantity, quantity_unit,
          trip_count, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'2026-11-19T10:00:00Z','Depo','Gradilište','Šljunak',12.5,'M3',2,$7,$7)`,
      [
        fixture.haul, fixture.company, fixture.machine, fixture.worker,
        fixture.project, fixture.segment, fixture.user,
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

export async function teardownHauls(admin: Pool): Promise<void> {
  for (const fixture of [A, B]) {
    await withCompany(admin, companyId(fixture.company), async (client: PoolClient) => {
      await client.query("DELETE FROM public.haul_revisions WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.hauls WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.route_segments WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machines WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.projects WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.workers WHERE company_id = $1", [fixture.company]);
    });
    await admin.query("DELETE FROM public.companies WHERE id = $1", [fixture.company]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [fixture.user]);
  }
}
