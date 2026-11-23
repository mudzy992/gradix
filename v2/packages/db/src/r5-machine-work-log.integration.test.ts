import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "./tenant";
import {
  A,
  B,
  NAMED_CONSTRAINTS,
  RUN,
  expectAdminFailure,
  insertWorkLog,
  seedR5Companies,
  seedTenantR5,
  teardownR5,
} from "./r5-machine-work-log-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

describeDb("R5.1 machine work logs, meter readings, tenant RLS (PostgreSQL)", () => {
  const app = new Pool({ connectionString: appUrl, max: 5 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    await seedR5Companies(admin);
    await seedTenantR5(admin, A);
    await seedTenantR5(admin, B);
  }, 60_000);

  afterAll(async () => {
    await teardownR5(admin);
    await app.end();
    await admin.end();
  });

  it("imenuje očekivane CHECK i UNIQUE constrainte na R5.1 tabelama", async () => {
    const found = await admin.query<{ conname: string; rel: string }>(
      `SELECT c.conname, cl.relname AS rel
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE c.conname = ANY($1::text[])`,
      [NAMED_CONSTRAINTS.map((item) => item.name)],
    );
    expect(found.rows).toHaveLength(NAMED_CONSTRAINTS.length);
    for (const expected of NAMED_CONSTRAINTS) {
      expect(
        found.rows.some((row) => row.conname === expected.name && row.rel === expected.table),
        expected.name,
      ).toBe(true);
    }
  });

  it("RLS: firma B ne vidi zapise radnih sati firme A", async () => {
    const scopedB = await withCompany(app, companyId(B.company), async (client) => {
      const own = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.machine_work_logs WHERE id = $1",
        [B.log],
      );
      const foreign = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.machine_work_logs WHERE id = $1",
        [A.log],
      );
      return { own: Number(own.rows[0]?.n ?? 0), foreign: Number(foreign.rows[0]?.n ?? 0) };
    });
    expect(scopedB.own).toBe(1);
    expect(scopedB.foreign).toBe(0);

    const unscoped = await app.query(
      "SELECT count(*)::text AS n FROM public.machine_work_logs WHERE id = $1",
      [A.log],
    );
    expect(Number(unscoped.rows[0]?.n ?? 0)).toBe(0);
  });

  it("odbija preklapanje intervala na istoj mašini (MACHINE_WORK_LOG_OVERLAP)", async () => {
    await expectAdminFailure(
      admin,
      A.company,
      `INSERT INTO public.machine_work_logs
         (id, company_id, machine_id, worker_id, project_id, started_at, ended_at,
          mode, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, '2026-11-19T09:00:00Z', '2026-11-19T11:00:00Z',
               'WORK', $6, $6)`,
      [A.logOverlap, A.company, A.machine, A.worker, A.project, A.user],
      /MACHINE_WORK_LOG_OVERLAP/,
    );
  });

  it("dozvoljava susjedne intervale [) na istoj mašini", async () => {
    await withCompany(admin, companyId(A.company), async (client) => {
      await insertWorkLog(client, {
        id: `mwl_r5_adj_${RUN}`,
        companyId: A.company,
        machineId: A.machine,
        workerId: A.worker,
        projectId: A.project,
        userId: A.user,
        startedAt: "2026-11-19T10:00:00Z",
        endedAt: "2026-11-19T12:00:00Z",
      });
    });
  });

  it("odbija regresiju brojila bez app.meter_amendment=1", async () => {
    await expectAdminFailure(
      admin,
      A.company,
      `INSERT INTO public.machine_meter_readings
         (id, company_id, machine_id, reading_value, recorded_at, source, actor_id)
       VALUES ($1, $2, $3, 50.0, '2026-11-19T12:00:00Z', 'MANUAL', $4)`,
      [A.meterReading, A.company, A.machine, A.user],
      /METER_READING_REGRESSION/,
    );
  });

  it("dozvoljava regresiju brojila uz app.meter_amendment=1 i ažurira machines.meter_value", async () => {
    const amendedId = `${A.meterReading}_ok`;
    await withCompany(app, companyId(A.company), async (client) => {
      await client.query("SELECT set_config('app.meter_amendment', '1', true)");
      await client.query(
        `INSERT INTO public.machine_meter_readings
           (id, company_id, machine_id, reading_value, recorded_at, source, actor_id)
         VALUES ($1, $2, $3, 50.0, '2026-11-19T12:30:00Z', 'MANUAL', $4)`,
        [amendedId, A.company, A.machine, A.user],
      );
      const meter = await client.query<{ meter_value: string }>(
        "SELECT meter_value::text FROM public.machines WHERE id = $1",
        [A.machine],
      );
      expect(meter.rows[0]?.meter_value).toBe("50.0");
    });
  });

  it("gradix_app ima SELECT/INSERT/UPDATE na machine_work_logs bez DELETE", async () => {
    const rights = await withCompany(app, companyId(A.company), (client) =>
      client.query<{
        logs_select: boolean;
        logs_insert: boolean;
        logs_update: boolean;
        logs_delete: boolean;
        readings_select: boolean;
        readings_insert: boolean;
        revisions_select: boolean;
        revisions_insert: boolean;
      }>(
        `SELECT
           has_table_privilege(current_user, 'public.machine_work_logs', 'SELECT') AS logs_select,
           has_table_privilege(current_user, 'public.machine_work_logs', 'INSERT') AS logs_insert,
           has_table_privilege(current_user, 'public.machine_work_logs', 'UPDATE') AS logs_update,
           has_table_privilege(current_user, 'public.machine_work_logs', 'DELETE') AS logs_delete,
           has_table_privilege(current_user, 'public.machine_meter_readings', 'SELECT') AS readings_select,
           has_table_privilege(current_user, 'public.machine_meter_readings', 'INSERT') AS readings_insert,
           has_table_privilege(current_user, 'public.machine_work_log_revisions', 'SELECT') AS revisions_select,
           has_table_privilege(current_user, 'public.machine_work_log_revisions', 'INSERT') AS revisions_insert`,
      ),
    );
    expect(rights.rows[0]).toMatchObject({
      logs_select: true,
      logs_insert: true,
      logs_update: true,
      logs_delete: false,
      readings_select: true,
      readings_insert: true,
      revisions_select: true,
      revisions_insert: true,
    });
  });
});