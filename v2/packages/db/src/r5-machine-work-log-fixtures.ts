import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import { companyId, withCompany } from "./tenant";

export const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
export const WORK_DATE = "2026-11-19";

export const A = {
  company: `cmp_r5_a_${RUN}`,
  user: `usr_r5_a_${RUN}`,
  worker: `wrk_r5_a_${RUN}`,
  project: `prj_r5_a_${RUN}`,
  machine: `mch_r5_a_${RUN}`,
  log: `mwl_r5_a_${RUN}`,
  logOverlap: `mwl_r5_a_ov_${RUN}`,
  meterReading: `mmr_r5_a_${RUN}`,
};

export const B = {
  company: `cmp_r5_b_${RUN}`,
  user: `usr_r5_b_${RUN}`,
  worker: `wrk_r5_b_${RUN}`,
  project: `prj_r5_b_${RUN}`,
  machine: `mch_r5_b_${RUN}`,
  log: `mwl_r5_b_${RUN}`,
};

export const NAMED_CONSTRAINTS = [
  { table: "machine_work_logs", name: "machine_work_logs_mode_check" },
  { table: "machine_work_logs", name: "machine_work_logs_interval_check" },
  { table: "machine_work_logs", name: "machine_work_logs_company_id_unique" },
  { table: "machine_meter_readings", name: "machine_meter_readings_source_check" },
] as const;

export async function seedR5Companies(admin: Pool): Promise<void> {
  await admin.query(
    `INSERT INTO public.companies (id, name, slug)
     VALUES ($1, 'R5 test A', $3), ($2, 'R5 test B', $4)`,
    [A.company, B.company, `r5-a-${RUN}`, `r5-b-${RUN}`],
  );
  await admin.query(
    `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
     VALUES ($1, $3, 'test-hash', 'R5', 'A', false),
            ($2, $4, 'test-hash', 'R5', 'B', false)`,
    [A.user, B.user, `r5-a-${RUN}@test.example`, `r5-b-${RUN}@test.example`],
  );
}

export async function seedTenantR5(admin: Pool, fixture: typeof A | typeof B): Promise<void> {
  await withCompany(admin, companyId(fixture.company), async (client) => {
    await client.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Worker', $3, $4::date)`,
      [fixture.worker, fixture.company, fixture === A ? "A" : "B", WORK_DATE],
    );
    await client.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ($1, $2, $3, $4)`,
      [
        fixture.project,
        fixture.company,
        `R5-${fixture === A ? "A" : "B"}-${RUN}`,
        `Project ${fixture === A ? "A" : "B"}`,
      ],
    );
    await client.query(
      `INSERT INTO public.machines
         (id, company_id, code, name, category_id, meter_value, meter_updated_at)
       VALUES ($1, $2, $3, 'R5 test machine', $2 || '_cat_excavator', 100.0, clock_timestamp())`,
      [fixture.machine, fixture.company, `R5-M-${fixture === A ? "A" : "B"}-${RUN}`],
    );
    await client.query(
      `INSERT INTO public.machine_work_logs
         (id, company_id, machine_id, worker_id, project_id, started_at, ended_at,
          mode, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, '2026-11-19T08:00:00Z', '2026-11-19T10:00:00Z',
               'WORK', $6, $6)`,
      [fixture.log, fixture.company, fixture.machine, fixture.worker, fixture.project, fixture.user],
    );
  });
}

export async function insertWorkLog(
  client: PoolClient,
  params: {
    id: string;
    companyId: string;
    machineId: string;
    workerId: string;
    projectId: string;
    userId: string;
    startedAt: string;
    endedAt: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO public.machine_work_logs
       (id, company_id, machine_id, worker_id, project_id, started_at, ended_at,
        mode, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, 'WORK', $8, $8)`,
    [
      params.id,
      params.companyId,
      params.machineId,
      params.workerId,
      params.projectId,
      params.startedAt,
      params.endedAt,
      params.userId,
    ],
  );
}

export async function expectAdminFailure(
  admin: Pool,
  company: string,
  query: string,
  values: unknown[],
  expected: RegExp,
): Promise<void> {
  const client = await admin.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SELECT set_config('app.company_id', $1, true)", [company]);
    await client.query("SAVEPOINT expected_guard_failure");
    await expect(client.query(query, values)).rejects.toThrow(expected);
    await client.query("ROLLBACK TO SAVEPOINT expected_guard_failure");
    await client.query("COMMIT");
    open = false;
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

export async function teardownR5(admin: Pool): Promise<void> {
  for (const fixture of [A, B]) {
    await withCompany(admin, companyId(fixture.company), async (client) => {
      await client.query("DELETE FROM public.machine_meter_readings WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_work_log_revisions WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machine_work_logs WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.machines WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.projects WHERE company_id = $1", [fixture.company]);
      await client.query("DELETE FROM public.workers WHERE company_id = $1", [fixture.company]);
    });
  }
  await admin.query("DELETE FROM public.users WHERE id = ANY($1)", [[A.user, B.user]]);
  await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[A.company, B.company]]);
}