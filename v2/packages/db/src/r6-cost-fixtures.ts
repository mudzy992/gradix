import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import { companyId, withCompany } from "./tenant";

export const RUN = randomUUID().replace(/-/g, "").slice(0, 10);

export const A = {
  company: `cmp_r61_a_${RUN}`,
  user: `usr_r61_a_${RUN}`,
  worker: `wrk_r61_a_${RUN}`,
  project: `prj_r61_a_${RUN}`,
  machine: `mch_r61_a_${RUN}`,
  workLog: `mwl_r61_a_${RUN}`,
  rate: `mcr_r61_a_${RUN}`,
};

export const B = {
  company: `cmp_r61_b_${RUN}`,
  user: `usr_r61_b_${RUN}`,
  worker: `wrk_r61_b_${RUN}`,
  project: `prj_r61_b_${RUN}`,
  machine: `mch_r61_b_${RUN}`,
  workLog: `mwl_r61_b_${RUN}`,
  rate: `mcr_r61_b_${RUN}`,
};

export const NAMED_CONSTRAINTS = [
  { table: "machine_cost_rates", name: "machine_cost_rates_amount_check" },
  { table: "machine_cost_rates", name: "machine_cost_rates_currency_check" },
  { table: "machine_cost_rates", name: "machine_cost_rates_valid_range_check" },
  { table: "machine_cost_rates", name: "machine_cost_rates_company_id_unique" },
  /*
   * F5: `project_cost_entries` je zamenjen jednim ledgerom `cost_entries`. Imena provjera se
   * promijenila, pa test imenovanih constrainta prati NOVU šemu — inače bi prolazio na tabeli
   * koje više nema.
   */
  { table: "cost_entries", name: "cost_entries_source_check" },
  /* `cost_entries_source_unique` je DJELIMIČNI UNIKATNI INDEKS, ne constraint — pa ga
     `pg_constraint` ne vidi. Provjerava se posebno, indeksom, niže u testu. */
  { table: "cost_entries", name: "cost_entries_currency_check" },
  { table: "cost_entries", name: "cost_entries_pending_shape_check" },
] as const;

export async function seedCostCompanies(admin: Pool): Promise<void> {
  await admin.query(
    `INSERT INTO public.companies (id, name, slug)
     VALUES ($1, 'Cost A', $3), ($2, 'Cost B', $4)`,
    [A.company, B.company, `r61-a-${RUN}`, `r61-b-${RUN}`],
  );
  await admin.query(
    `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
     VALUES ($1, $3, 'test-hash', 'Cost', 'A', false), ($2, $4, 'test-hash', 'Cost', 'B', false)`,
    [A.user, B.user, `r61-a-${RUN}@test.example`, `r61-b-${RUN}@test.example`],
  );
  /*
   * F5: svako knjiženje traži kategoriju (`cost_entries.category_id` je NOT NULL), a zadani set
   * se pravi tek kad firma ima ČLANA — u trenutku kreiranja firme vlasnika još nema. Zato test
   * ovdje pravi članstvo i poziva set, umjesto da se pouzda u trigger koji legitimno preskače.
   */
  await withCompany(admin, companyId(A.company), async (client) => {
    await client.query(
      `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
       VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY')`,
      [`mem_r61_a_${RUN}`, A.user, A.company],
    );
  });
  await withCompany(admin, companyId(B.company), async (client) => {
    await client.query(
      `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
       VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY')`,
      [`mem_r61_b_${RUN}`, B.user, B.company],
    );
    await client.query("SELECT public.seed_cost_categories($1)", [B.company]);
  });
  await admin.query("SELECT public.seed_cost_categories($1)", [A.company]);
}

export async function seedTenantCost(admin: Pool, fixture: typeof A | typeof B): Promise<void> {
  await withCompany(admin, companyId(fixture.company), async (client) => {
    await client.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Op', $3, '2026-11-19'::date)`,
      [fixture.worker, fixture.company, fixture === A ? "A" : "B"],
    );
    await client.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ($1, $2, $3, $4)`,
      [fixture.project, fixture.company, `R61-${fixture === A ? "A" : "B"}`, `Cost ${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.machines (id, company_id, code, name, category_id)
       VALUES ($1, $2, $3, 'Cost machine', $2 || '_cat_excavator')`,
      [fixture.machine, fixture.company, `R61-M-${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.machine_work_logs
         (id, company_id, machine_id, worker_id, project_id, started_at, ended_at, mode, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'2026-11-19T08:00:00Z','2026-11-19T10:00:00Z','WORK',$6,$6)`,
      [fixture.workLog, fixture.company, fixture.machine, fixture.worker, fixture.project, fixture.user],
    );
    await client.query(
      `INSERT INTO public.machine_cost_rates
         (id, company_id, machine_id, amount_cents, currency_code, valid_from,
          is_manual, reason, created_by, updated_by)
       VALUES ($1,$2,$3,10000,'BAM','2026-01-01'::date,true,
               'R6.1 testna scena: ravna stopa bez komponenti.',$4,$4)`,
      [fixture.rate, fixture.company, fixture.machine, fixture.user],
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

export async function teardownCosts(admin: Pool): Promise<void> {
  for (const fixture of [A, B]) {
    await withCompany(admin, companyId(fixture.company), async (client: PoolClient) => {
      /*
       * Ledger je append-only (triger brani DELETE). Teardown zato isključuje KORISNIČKE trigere
       * za svoju transakciju — ne mijenja šemu, samo pušta čišćenje testnih redova.
       */
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM public.cost_entries WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_cost_rates WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_work_log_revisions WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_work_logs WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machines WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.projects WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.workers WHERE company_id = $1", [fixture.company]);
    });
    await admin.query("DELETE FROM public.users WHERE id = $1", [fixture.user]);
    await admin.query("DELETE FROM public.companies WHERE id = $1", [fixture.company]);
  }
}
