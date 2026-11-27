import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import { companyId, withCompany } from "./tenant";

export const RUN = randomUUID().replace(/-/g, "").slice(0, 10);

export const A = {
  company: `cmp_ft_a_${RUN}`,
  user: `usr_ft_a_${RUN}`,
  worker: `wrk_ft_a_${RUN}`,
  project: `prj_ft_a_${RUN}`,
  machine: `mch_ft_a_${RUN}`,
  partner: `ptr_ft_a_${RUN}`,
  fault: `mf_ft_a_${RUN}`,
};

export const B = {
  company: `cmp_ft_b_${RUN}`,
  user: `usr_ft_b_${RUN}`,
  worker: `wrk_ft_b_${RUN}`,
  project: `prj_ft_b_${RUN}`,
  machine: `mch_ft_b_${RUN}`,
  partner: `ptr_ft_b_${RUN}`,
  fault: `mf_ft_b_${RUN}`,
};

export const NAMED_CONSTRAINTS = [
  { table: "partners", name: "partners_kind_check" },
  { table: "partners", name: "partners_company_code_unique" },
  { table: "machine_faults", name: "machine_faults_status_check" },
  { table: "machine_faults", name: "machine_faults_money_pair_check" },
  { table: "machine_faults", name: "machine_faults_company_id_unique" },
  { table: "machine_fault_revisions", name: "machine_fault_revisions_fault_fk" },
  { table: "approval_requests", name: "approval_requests_status_check" },
] as const;

export async function seedFaultCompanies(admin: Pool): Promise<void> {
  await admin.query(
    `INSERT INTO public.companies (id, name, slug)
     VALUES ($1, 'Fault A', $3), ($2, 'Fault B', $4)`,
    [A.company, B.company, `ft-a-${RUN}`, `ft-b-${RUN}`],
  );
  await admin.query(
    `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
     VALUES ($1, $3, 'test-hash', 'Fault', 'A', false), ($2, $4, 'test-hash', 'Fault', 'B', false)`,
    [A.user, B.user, `ft-a-${RUN}@test.example`, `ft-b-${RUN}@test.example`],
  );
}

export async function seedTenantFault(admin: Pool, fixture: typeof A | typeof B): Promise<void> {
  await withCompany(admin, companyId(fixture.company), async (client) => {
    await client.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Op', $3, '2026-11-19'::date)`,
      [fixture.worker, fixture.company, fixture === A ? "A" : "B"],
    );
    await client.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ($1, $2, $3, $4)`,
      [fixture.project, fixture.company, `FT-${fixture === A ? "A" : "B"}`, `Project ${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.machines (id, company_id, code, name, category_id)
       VALUES ($1, $2, $3, 'Fault machine', $2 || '_cat_excavator')`,
      [fixture.machine, fixture.company, `FT-M-${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.partners (id, company_id, code, name, kind)
       VALUES ($1, $2, $3, 'Servis', 'SERVICE')`,
      [fixture.partner, fixture.company, `SRV-${fixture === A ? "A" : "B"}`],
    );
    await client.query(
      `INSERT INTO public.machine_faults
         (id, company_id, machine_id, reporter_worker_id, project_id, partner_id, reported_at,
          title, priority, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'2026-11-19T08:00:00Z','Curenje ulja','MEDIUM','OPEN',$7,$7)`,
      [
        fixture.fault, fixture.company, fixture.machine, fixture.worker,
        fixture.project, fixture.partner, fixture.user,
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

export async function teardownFaults(admin: Pool): Promise<void> {
  for (const fixture of [A, B]) {
    await withCompany(admin, companyId(fixture.company), async (client: PoolClient) => {
      await client.query("DELETE FROM public.approval_requests WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_fault_revisions WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_faults WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.partner_roles WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.partners WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machines WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.projects WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.workers WHERE company_id = $1", [fixture.company]);
    });
    await admin.query("DELETE FROM public.companies WHERE id = $1", [fixture.company]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [fixture.user]);
  }
}
