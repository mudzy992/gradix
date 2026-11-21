import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "./tenant";
import {
  A,
  B,
  NAMED_CONSTRAINTS,
  RUN,
  expectAdminFailure,
  seedFuelCompanies,
  seedTenantFuel,
  teardownFuel,
} from "./r5-fuel-entry-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

describeDb("R5.2 fuel entries, tenant RLS (PostgreSQL)", () => {
  const app = new Pool({ connectionString: appUrl, max: 5 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    await seedFuelCompanies(admin);
    await seedTenantFuel(admin, A);
    await seedTenantFuel(admin, B);
  }, 60_000);

  afterAll(async () => {
    await teardownFuel(admin);
    await app.end();
    await admin.end();
  });

  it("imenuje očekivane constrainte na R5.2 tabelama", async () => {
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

  it("RLS: firma B ne vidi točenja firme A", async () => {
    const scopedB = await withCompany(app, companyId(B.company), async (client) => {
      const own = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.fuel_entries WHERE id = $1",
        [B.entry],
      );
      const foreign = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.fuel_entries WHERE id = $1",
        [A.entry],
      );
      return { own: Number(own.rows[0]?.n ?? 0), foreign: Number(foreign.rows[0]?.n ?? 0) };
    });
    expect(scopedB.own).toBe(1);
    expect(scopedB.foreign).toBe(0);
  });

  it("odbija litara <= 0 (fuel_entries_liters_check)", async () => {
    await expectAdminFailure(
      admin,
      A.company,
      `INSERT INTO public.fuel_entries
         (id, company_id, machine_id, driver_worker_id, filled_at, liters,
          amount_cents, currency_code, created_by, updated_by)
       VALUES ($1, $2, $3, $4, '2026-11-19T11:00:00Z', 0, 100, 'BAM', $5, $5)`,
      [`fuel_bad_${RUN}`, A.company, A.machine, A.worker, A.user],
      /fuel_entries_liters_check/,
    );
  });

  it("append-only revizija ne briše original", async () => {
    await withCompany(app, companyId(A.company), async (client) => {
      await client.query(
        `INSERT INTO public.fuel_entry_revisions
           (id, company_id, fuel_entry_id, base_version, reason, author_id, payload)
         VALUES ($1, $2, $3, 1, $4, $5, '{}'::jsonb)`,
        [`fer_${RUN}`, A.company, A.entry, "Ispravka napomene zbog greške.", A.user],
      );
      const versions = await client.query<{ version: number }>(
        "SELECT version FROM public.fuel_entries WHERE id = $1",
        [A.entry],
      );
      expect(versions.rows[0]?.version).toBe(1);
    });
  });

  it("odbija neispravnu valutu (fuel_entries_currency_check)", async () => {
    await expectAdminFailure(
      admin,
      A.company,
      `INSERT INTO public.fuel_entries
         (id, company_id, machine_id, driver_worker_id, filled_at, liters,
          amount_cents, currency_code, created_by, updated_by)
       VALUES ($1, $2, $3, $4, '2026-11-19T11:30:00Z', 10, 1000, 'INVALID', $5, $5)`,
      [`fuel_cur_${RUN}`, A.company, A.machine, A.worker, A.user],
      /fuel_entries_currency_check/,
    );
  });

  it("gradix_app ima SELECT/INSERT/UPDATE na fuel_entries bez DELETE", async () => {
    const rights = await withCompany(app, companyId(A.company), (client) =>
      client.query<{
        entries_select: boolean;
        entries_insert: boolean;
        entries_update: boolean;
        entries_delete: boolean;
        revisions_insert: boolean;
      }>(
        `SELECT
           has_table_privilege(current_user, 'public.fuel_entries', 'SELECT') AS entries_select,
           has_table_privilege(current_user, 'public.fuel_entries', 'INSERT') AS entries_insert,
           has_table_privilege(current_user, 'public.fuel_entries', 'UPDATE') AS entries_update,
           has_table_privilege(current_user, 'public.fuel_entries', 'DELETE') AS entries_delete,
           has_table_privilege(current_user, 'public.fuel_entry_revisions', 'INSERT') AS revisions_insert`,
      ),
    );
    const row = rights.rows[0];
    expect(row?.entries_select).toBe(true);
    expect(row?.entries_insert).toBe(true);
    expect(row?.entries_update).toBe(true);
    expect(row?.entries_delete).toBe(false);
    expect(row?.revisions_insert).toBe(true);
  });
});