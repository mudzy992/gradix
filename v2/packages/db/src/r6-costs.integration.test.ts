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

  it("djelimični unikat po izvoru postoji kao INDEX (ne kao constraint)", async () => {
    /* Zaštita od dvostrukog troška je indeks `WHERE status <> 'REVERSED'`, pa bi provjera samo
       preko `pg_constraint` tvrdila da zaštita postoji i kad je nema. */
    const index = await admin.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'cost_entries_source_unique'`,
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]!.indexdef).toContain("UNIQUE");
    expect(index.rows[0]!.indexdef).toContain("REVERSED");
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
    /*
     * F5: `cost_entries` je jedini ledger. Djelimični unikat
     * `(company_id, source_type, source_id) WHERE status <> 'REVERSED'` je ono što brani dupli
     * trošak — i mora važiti i za aplikacijsku i za admin rolu, jer RLS ne dira unikate.
     */
    const insert = `INSERT INTO public.cost_entries
         (id, company_id, project_id, category_id, source_type, source_id,
          occurred_on, amount_cents, currency_code, status, booked_by)
       SELECT $1, $2, $3, cc.id, 'MACHINE_WORK_LOG', $4, '2026-11-19'::date, 20000, 'BAM',
              'POSTED', $5
         FROM public.cost_categories cc
        WHERE cc.company_id = $2 AND cc.code = 'MEHANIZACIJA'`;
    await withCompany(app, companyId(A.company), async (client) => {
      await client.query(insert, [`ce_${RUN}`, A.company, A.project, A.workLog, A.user]);
    });
    await expectAdminFailure(
      admin,
      A.company,
      insert,
      [`ce2_${RUN}`, A.company, A.project, A.workLog, A.user],
      /cost_entries_source_unique/,
    );
  });

  it("storno dozvoljava novi trošak istog izvora (djelimični unikat)", async () => {
    /*
     * Zašto ovo mora raditi: pogrešno knjiženje se ispravlja stornom, a zatim isti događaj dobija
     * NOVI trošak. Puni unikat bi trajno blokirao taj izvor upravo kad je ispravka najpotrebnija.
     */
    await withCompany(admin, companyId(A.company), async (client) => {
      await client.query(
        `UPDATE public.cost_entries
            SET status = 'REVERSED', note = 'Test: storno zbog pogrešne stope.'
          WHERE company_id = $1 AND source_type = 'MACHINE_WORK_LOG' AND source_id = $2`,
        [A.company, A.workLog],
      );
      await client.query(
        `INSERT INTO public.cost_entries
           (id, company_id, project_id, category_id, source_type, source_id,
            occurred_on, amount_cents, currency_code, status, booked_by)
         SELECT $1, $2, $3, cc.id, 'MACHINE_WORK_LOG', $4, '2026-11-19'::date, 22000, 'BAM',
                'POSTED', $5
           FROM public.cost_categories cc
          WHERE cc.company_id = $2 AND cc.code = 'MEHANIZACIJA'`,
        [`ce3_${RUN}`, A.company, A.project, A.workLog, A.user],
      );
      const rows = await client.query<{ status: string; n: string }>(
        `SELECT status, count(*)::text AS n FROM public.cost_entries
          WHERE company_id = $1 AND source_type = 'MACHINE_WORK_LOG' AND source_id = $2
          GROUP BY status ORDER BY status`,
        [A.company, A.workLog],
      );
      expect(rows.rows).toEqual([
        { status: "POSTED", n: "1" },
        { status: "REVERSED", n: "1" },
      ]);
    });
  });

  it("gradix_app: rates SELECT/INSERT/UPDATE bez DELETE; ledger SELECT/INSERT/UPDATE bez DELETE", async () => {
    /*
     * F5 mijenja prava na ledgeru: `UPDATE` SADA postoji (storno i PENDING→POSTED), ali `DELETE`
     * ne — i to je poenta. Storno je promjena stanja, brisanje bi bilo nestanak troška iz knjige.
     */
    const rights = await withCompany(app, companyId(A.company), (client) =>
      client.query<{
        rates_update: boolean;
        rates_delete: boolean;
        entries_insert: boolean;
        entries_update: boolean;
        entries_delete: boolean;
        entries_select: boolean;
      }>(
        `SELECT
           has_table_privilege(current_user, 'public.machine_cost_rates', 'UPDATE') AS rates_update,
           has_table_privilege(current_user, 'public.machine_cost_rates', 'DELETE') AS rates_delete,
           has_table_privilege(current_user, 'public.cost_entries', 'SELECT') AS entries_select,
           has_table_privilege(current_user, 'public.cost_entries', 'INSERT') AS entries_insert,
           has_table_privilege(current_user, 'public.cost_entries', 'UPDATE') AS entries_update,
           has_table_privilege(current_user, 'public.cost_entries', 'DELETE') AS entries_delete`,
      ),
    );
    expect(rights.rows[0]?.rates_update).toBe(true);
    expect(rights.rows[0]?.rates_delete).toBe(false);
    expect(rights.rows[0]?.entries_select).toBe(true);
    expect(rights.rows[0]?.entries_insert).toBe(true);
    expect(rights.rows[0]?.entries_update).toBe(true);
    expect(rights.rows[0]?.entries_delete).toBe(false);
  });

  it("ledger ne dopušta brisanje ni kroz admina (triger, ne samo grant)", async () => {
    await expectAdminFailure(
      admin,
      A.company,
      "DELETE FROM public.cost_entries WHERE company_id = $1 AND source_id = $2",
      [A.company, A.workLog],
      /COST_ENTRY_DELETE_FORBIDDEN/,
    );
  });
});
