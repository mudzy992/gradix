import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "./tenant";
import {
  A,
  B,
  NAMED_CONSTRAINTS,
  RUN,
  expectAdminFailure,
  seedCostCompanies,
  seedTenantCost,
  teardownCosts,
} from "./r6-cost-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

describeDb("R6.1 machine cost rates tenant RLS (PostgreSQL)", () => {
  const app = new Pool({ connectionString: appUrl, max: 5 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    await seedCostCompanies(admin);
    await seedTenantCost(admin, A);
    await seedTenantCost(admin, B);
  }, 60_000);

  afterAll(async () => {
    await teardownCosts(admin);
    await app.end();
    await admin.end();
  });

  it("imenuje očekivane constrainte na R6.1 tabelama", async () => {
    const found = await admin.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c WHERE c.conname = ANY($1::text[])`,
      [NAMED_CONSTRAINTS.map((item) => item.name)],
    );
    expect(found.rows).toHaveLength(NAMED_CONSTRAINTS.length);
  });

  it("RLS: firma B ne vidi machine_cost_rates firme A", async () => {
    const scopedB = await withCompany(app, companyId(B.company), async (client) => {
      const own = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.machine_cost_rates WHERE id = $1",
        [B.rate],
      );
      const foreign = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.machine_cost_rates WHERE id = $1",
        [A.rate],
      );
      return { own: Number(own.rows[0]?.n ?? 0), foreign: Number(foreign.rows[0]?.n ?? 0) };
    });
    expect(scopedB.own).toBe(1);
    expect(scopedB.foreign).toBe(0);
  });

  it("idempotentan unique source: drugi INSERT istog source_id pada", async () => {
    await withCompany(app, companyId(A.company), async (client) => {
      await client.query(
        `INSERT INTO public.project_cost_entries
           (id, company_id, project_id, source_type, source_id, machine_id,
            hours, rate_cents, amount_cents, currency_code, booked_by)
         VALUES ($1,$2,$3,'MACHINE_WORK_LOG',$4,$5,2,10000,20000,'BAM',$6)`,
        [`pce_${RUN}`, A.company, A.project, A.workLog, A.machine, A.user],
      );
    });
    await expectAdminFailure(
      admin,
      A.company,
      `INSERT INTO public.project_cost_entries
         (id, company_id, project_id, source_type, source_id, machine_id,
          hours, rate_cents, amount_cents, currency_code, booked_by)
       VALUES ($1,$2,$3,'MACHINE_WORK_LOG',$4,$5,2,10000,20000,'BAM',$6)`,
      [`pce2_${RUN}`, A.company, A.project, A.workLog, A.machine, A.user],
      /project_cost_entries_source_unique/,
    );
  });

  it("gradix_app: rates SELECT/INSERT/UPDATE bez DELETE; entries SELECT/INSERT bez UPDATE/DELETE", async () => {
    const rights = await withCompany(app, companyId(A.company), (client) =>
      client.query<{
        rates_update: boolean;
        rates_delete: boolean;
        entries_insert: boolean;
        entries_update: boolean;
        entries_delete: boolean;
      }>(
        `SELECT
           has_table_privilege(current_user, 'public.machine_cost_rates', 'UPDATE') AS rates_update,
           has_table_privilege(current_user, 'public.machine_cost_rates', 'DELETE') AS rates_delete,
           has_table_privilege(current_user, 'public.project_cost_entries', 'INSERT') AS entries_insert,
           has_table_privilege(current_user, 'public.project_cost_entries', 'UPDATE') AS entries_update,
           has_table_privilege(current_user, 'public.project_cost_entries', 'DELETE') AS entries_delete`,
      ),
    );
    expect(rights.rows[0]?.rates_update).toBe(true);
    expect(rights.rows[0]?.rates_delete).toBe(false);
    expect(rights.rows[0]?.entries_insert).toBe(true);
    expect(rights.rows[0]?.entries_update).toBe(false);
    expect(rights.rows[0]?.entries_delete).toBe(false);
  });
});
