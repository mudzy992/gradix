import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "./tenant";
import {
  A,
  B,
  NAMED_CONSTRAINTS,
  RUN,
  expectAdminFailure,
  seedDailyCheckCompanies,
  seedTenantDailyCheck,
  teardownDailyChecks,
} from "./r5-daily-check-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

describeDb("R5.4 machine_daily_checks tenant RLS (PostgreSQL)", () => {
  const app = new Pool({ connectionString: appUrl, max: 5 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    await seedDailyCheckCompanies(admin);
    await seedTenantDailyCheck(admin, A);
    await seedTenantDailyCheck(admin, B);
  }, 60_000);

  afterAll(async () => {
    await teardownDailyChecks(admin);
    await app.end();
    await admin.end();
  });

  it("imenuje očekivane constrainte na R5.4 tabelama", async () => {
    const found = await admin.query<{ conname: string; rel: string }>(
      `SELECT c.conname, cl.relname AS rel
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE c.conname = ANY($1::text[])`,
      [NAMED_CONSTRAINTS.map((item) => item.name)],
    );
    expect(found.rows).toHaveLength(NAMED_CONSTRAINTS.length);
  });

  it("RLS: firma B ne vidi machine_daily_checks firme A", async () => {
    const scopedB = await withCompany(app, companyId(B.company), async (client) => {
      const own = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.machine_daily_checks WHERE id = $1",
        [B.check],
      );
      const foreign = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.machine_daily_checks WHERE id = $1",
        [A.check],
      );
      return { own: Number(own.rows[0]?.n ?? 0), foreign: Number(foreign.rows[0]?.n ?? 0) };
    });
    expect(scopedB.own).toBe(1);
    expect(scopedB.foreign).toBe(0);
  });

  it("odbija nepoznat result (machine_daily_checks_result_check)", async () => {
    await expectAdminFailure(
      admin,
      A.company,
      `INSERT INTO public.machine_daily_checks
         (id, company_id, machine_id, worker_id, checked_at, result, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'2026-11-19T11:00:00Z','MAYBE',$5,$5)`,
      [`mdc_bad_${RUN}`, A.company, A.machine, A.worker, A.user],
      /machine_daily_checks_result_check/,
    );
  });

  it("append-only revizija čuva original i ne briše red", async () => {
    await withCompany(app, companyId(A.company), async (client) => {
      await client.query(
        `INSERT INTO public.machine_daily_check_revisions
           (id, company_id, check_id, base_version, reason, author_id, payload)
         VALUES ($1, $2, $3, 1, $4, $5, $6::jsonb)`,
        [
          `mdcr_${RUN}`, A.company, A.check, "Ispravka napomene zbog greške.", A.user,
          JSON.stringify({ original: { result: "PASS" }, result: "FAIL" }),
        ],
      );
      const versions = await client.query<{ version: number; result: string }>(
        "SELECT version, result FROM public.machine_daily_checks WHERE id = $1",
        [A.check],
      );
      expect(versions.rows[0]?.version).toBe(1);
      expect(versions.rows[0]?.result).toBe("PASS");
    });
  });

  it("odbija attachment size > MAX (attachments_size_bytes_check)", async () => {
    await expectAdminFailure(
      admin,
      A.company,
      `INSERT INTO public.attachments
         (id, company_id, entity_type, entity_id, object_key, file_name, content_type, size_bytes, sha256, status)
       VALUES ($1,$2,'MACHINE_DAILY_CHECK',$3,'gx2/x','foto.jpg','image/jpeg',$4,$5,'pending')`,
      [
        `mdca_big_${RUN}`, A.company, A.check, 10485761,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
      /attachments_size_bytes_check/,
    );
  });

  it("gradix_app ima SELECT/INSERT/UPDATE na checks bez DELETE", async () => {
    const rights = await withCompany(app, companyId(A.company), (client) =>
      client.query<{
        checks_select: boolean;
        checks_delete: boolean;
        attachments_delete: boolean;
        revisions_insert: boolean;
      }>(
        `SELECT
           has_table_privilege(current_user, 'public.machine_daily_checks', 'SELECT') AS checks_select,
           has_table_privilege(current_user, 'public.machine_daily_checks', 'DELETE') AS checks_delete,
           has_table_privilege(current_user, 'public.attachments', 'DELETE') AS attachments_delete,
           has_table_privilege(current_user, 'public.machine_daily_check_revisions', 'INSERT') AS revisions_insert`,
      ),
    );
    expect(rights.rows[0]?.checks_select).toBe(true);
    expect(rights.rows[0]?.checks_delete).toBe(false);
    expect(rights.rows[0]?.attachments_delete).toBe(false);
    expect(rights.rows[0]?.revisions_insert).toBe(true);
  });
});
