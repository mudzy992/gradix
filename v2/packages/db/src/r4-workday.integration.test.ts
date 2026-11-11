import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, setTenant, withCompany } from "./tenant";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const A = {
  company: `cmp_r4_a_${RUN}`,
  user: `usr_r4_a_${RUN}`,
  worker: `wrk_r4_a_${RUN}`,
  project: `prj_r4_a_${RUN}`,
  machine: `mch_r4_a_${RUN}`,
  day: `wd_r4_a_${RUN}`,
  entry: `we_r4_a_${RUN}`,
  receipt: `rc_r4_a_${RUN}`,
  conflict: `sc_r4_a_${RUN}`,
};
const B = {
  company: `cmp_r4_b_${RUN}`,
  user: `usr_r4_b_${RUN}`,
  worker: `wrk_r4_b_${RUN}`,
  project: `prj_r4_b_${RUN}`,
  machine: `mch_r4_b_${RUN}`,
  day: `wd_r4_b_${RUN}`,
  entry: `we_r4_b_${RUN}`,
  receipt: `rc_r4_b_${RUN}`,
  conflict: `sc_r4_b_${RUN}`,
};

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const WORK_DATE = "2026-11-07";

/** The literal names form a generated RLS matrix; never accept table names from test input. */
const R4_TENANT_TABLES = [
  "sync_change_log",
  "workdays",
  "work_entries",
  "sync_receipts",
  "sync_conflicts",
] as const;

describeDb("R4 radni dani, segmenti, receipt i tenant RLS (PostgreSQL)", () => {
  const app = new Pool({ connectionString: appUrl, max: 5 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO public.companies (id, name, slug)
       VALUES ($1, 'R4 test A', $3), ($2, 'R4 test B', $4)`,
      [A.company, B.company, `r4-a-${RUN}`, `r4-b-${RUN}`],
    );
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, $3, 'test-hash', 'R4', 'A', false),
              ($2, $4, 'test-hash', 'R4', 'B', false)`,
      [A.user, B.user, `r4-a-${RUN}@test.example`, `r4-b-${RUN}@test.example`],
    );

    for (const fixture of [A, B]) {
      await withCompany(admin, companyId(fixture.company), async (client) => {
        await client.query(
          `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
           VALUES ($1, $2, 'Worker', $3, $4::date)`,
          [fixture.worker, fixture.company, fixture === A ? 'A' : 'B', WORK_DATE],
        );
        await client.query(
          `INSERT INTO public.projects (id, company_id, code, name)
           VALUES ($1, $2, $3, $4)`,
          [fixture.project, fixture.company, `R4-${fixture === A ? 'A' : 'B'}-${RUN}`, `Project ${fixture === A ? 'A' : 'B'}`],
        );
        if (fixture === A) {
          await client.query(
            `INSERT INTO public.machines (id, company_id, code, name, category_id)
             VALUES ($1, $2, $3, 'R4 test machine', $2 || '_cat_excavator')`,
            [fixture.machine, fixture.company, `R4-M-${RUN}`],
          );
        }
        await client.query(
          `INSERT INTO public.workdays
             (id, company_id, worker_id, work_date, created_by, updated_by)
           VALUES ($1, $2, $3, $4::date, $5, $5)`,
          [fixture.day, fixture.company, fixture.worker, WORK_DATE, fixture.user],
        );
        await client.query(
          `INSERT INTO public.work_entries
             (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state,
              project_id, version, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T08:00:00Z', '2026-11-07T09:00:00Z',
                   'KNOWN_END', $5, 1, $6, $6)`,
          [fixture.entry, fixture.company, fixture.day, fixture.worker, fixture.project, fixture.user],
        );
        await client.query(
          `INSERT INTO public.sync_receipts (id, company_id, actor_id, local_id, request_hash, result)
           VALUES ($1, $2, $3, $4, $5, '{"accepted":true}'::jsonb)`,
          [fixture.receipt, fixture.company, fixture.user, `local-${fixture === A ? 'A' : 'B'}-${RUN}`,
            fixture === A ? HASH_A : HASH_B],
        );
        await client.query(
          `INSERT INTO public.sync_conflicts
             (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 1)`,
          [fixture.conflict, fixture.company, fixture.user, `conflict-${fixture === A ? 'A' : 'B'}-${RUN}`,
            fixture.entry, JSON.stringify({ incoming: fixture === A ? 'A' : 'B' }), fixture === A ? HASH_A : HASH_B],
        );
      });

      await withCompany(app, companyId(fixture.company), async (client) => {
        const token = `tenant-seed-${fixture.company}`;
        const reservation = await client.query<{ seq: string }>(
          "SELECT public.sync_cursor_reserve($1, $2, 300)::text AS seq",
          [fixture.company, token],
        );
        await client.query(
          `SELECT public.sync_cursor_publish(
             $1, $2, $3, $4, 'workday', $5, 1, $6::jsonb, false
           )`,
          [fixture.company, Number(reservation.rows[0]!.seq), token,
            fixture === A ? HASH_A : HASH_B, fixture.day,
            JSON.stringify({ workDate: WORK_DATE })],
        );
      });
    }
  }, 60_000);

  afterAll(async () => {
    for (const fixture of [A, B]) {
      await withCompany(admin, companyId(fixture.company), async (client) => {
        await client.query("DELETE FROM public.sync_conflicts WHERE company_id = $1", [fixture.company]);
        await client.query("DELETE FROM public.sync_receipts WHERE company_id = $1", [fixture.company]);
        await client.query("DELETE FROM public.work_entries WHERE company_id = $1", [fixture.company]);
        await client.query("DELETE FROM public.workdays WHERE company_id = $1", [fixture.company]);
        if (fixture === A) {
          await client.query("DELETE FROM public.machines WHERE company_id = $1", [fixture.company]);
        }
        await client.query("DELETE FROM public.sync_change_log WHERE company_id = $1", [fixture.company]);
        await client.query("DELETE FROM public.sync_cursor_slots WHERE company_id = $1", [fixture.company]);
        await client.query("DELETE FROM public.sync_cursor_allocators WHERE company_id = $1", [fixture.company]);
        await client.query("DELETE FROM public.projects WHERE company_id = $1", [fixture.company]);
        await client.query("DELETE FROM public.workers WHERE company_id = $1", [fixture.company]);
      });
    }
    await admin.query("DELETE FROM public.users WHERE id = ANY($1)", [[A.user, B.user]]);
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[A.company, B.company]]);
    await app.end();
    await admin.end();
  });

  it("RLS matrix: svaki R4 tenant red čita se samo uz pripadajući SET LOCAL company_id", async () => {
    const companyA = await withCompany(app, companyId(A.company), async (client) => {
      const counts: Record<string, number> = {};
      for (const table of R4_TENANT_TABLES) {
        const result = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM public.${table}`,
        );
        counts[table] = Number(result.rows[0]?.n ?? 0);
      }
      return counts;
    });
    const companyB = await withCompany(app, companyId(B.company), async (client) => {
      const counts: Record<string, number> = {};
      for (const table of R4_TENANT_TABLES) {
        const result = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM public.${table}`,
        );
        counts[table] = Number(result.rows[0]?.n ?? 0);
      }
      return counts;
    });
    for (const table of R4_TENANT_TABLES) {
      expect(companyA[table]).toBe(1);
      expect(companyB[table]).toBe(1);
    }

    for (const table of R4_TENANT_TABLES) {
      const unscoped = await app.query(`SELECT count(*)::text AS n FROM public.${table}`);
      expect(Number(unscoped.rows[0]?.n ?? 0), `${table} must hide tenant rows without SET LOCAL`).toBe(0);
    }
  });

  it("tenant RLS rejects cross-company INSERT on every directly writable R4 table", async () => {
    const invalidInserts: { table: string; sql: string; values: unknown[] }[] = [
      {
        table: "workdays",
        sql: `INSERT INTO public.workdays (id, company_id, worker_id, work_date, created_by, updated_by)
              VALUES ($1, $2, $3, $4::date, $5, $5)`,
        values: [`cross-wd-${RUN}`, B.company, B.worker, WORK_DATE, B.user],
      },
      {
        table: "work_entries",
        sql: `INSERT INTO public.work_entries
                (id, company_id, workday_id, worker_id, kind, started_at, end_state, project_id, created_by, updated_by)
              VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T10:00:00Z', 'OPEN', $5, $6, $6)`,
        values: [`cross-entry-${RUN}`, B.company, B.day, B.worker, B.project, B.user],
      },
      {
        table: "sync_receipts",
        sql: `INSERT INTO public.sync_receipts (id, company_id, actor_id, local_id, request_hash, result)
              VALUES ($1, $2, $3, $4, $5, '{"accepted":true}'::jsonb)`,
        values: [`cross-receipt-${RUN}`, B.company, B.user, `cross-local-${RUN}`, HASH_B],
      },
      {
        table: "sync_conflicts",
        sql: `INSERT INTO public.sync_conflicts
                (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version)
              VALUES ($1, $2, $3, $4, $5, '{"incoming":"cross"}'::jsonb, $6, 1)`,
        values: [`cross-conflict-${RUN}`, B.company, B.user, `cross-conflict-local-${RUN}`, B.entry, HASH_B],
      },
    ];

    for (const item of invalidInserts) {
      await expect(
        withCompany(app, companyId(A.company), (client) => client.query(item.sql, item.values)),
        `${item.table} must enforce tenant WITH CHECK`,
      ).rejects.toThrow(/row-level security/i);
    }

    await expect(
      withCompany(app, companyId(A.company), (client) =>
        client.query(
          `INSERT INTO public.sync_change_log
             (id, company_id, cursor_seq, entity_type, entity_id, entity_version, request_hash, payload)
           VALUES ($1, $2, 1, 'workday', $3, 1, $4, '{}'::jsonb)`,
          [`cross-change-${RUN}`, B.company, B.day, HASH_B],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("app privilege matrix gives only the R4 rights needed by each table", async () => {
    const rights = await withCompany(app, companyId(A.company), (client) =>
      client.query<{
        workdays_select: boolean; workdays_insert: boolean; workdays_update: boolean; workdays_delete: boolean;
        entries_select: boolean; entries_insert: boolean; entries_update: boolean; entries_delete: boolean;
        receipts_select: boolean; receipts_insert: boolean; receipts_update: boolean;
        conflicts_select: boolean; conflicts_insert: boolean; conflicts_update: boolean; conflicts_delete: boolean;
        change_select: boolean; change_insert: boolean; change_update: boolean; change_delete: boolean;
      }>(
        `SELECT
           has_table_privilege(current_user, 'public.workdays', 'SELECT') AS workdays_select,
           has_table_privilege(current_user, 'public.workdays', 'INSERT') AS workdays_insert,
           has_table_privilege(current_user, 'public.workdays', 'UPDATE') AS workdays_update,
           has_table_privilege(current_user, 'public.workdays', 'DELETE') AS workdays_delete,
           has_table_privilege(current_user, 'public.work_entries', 'SELECT') AS entries_select,
           has_table_privilege(current_user, 'public.work_entries', 'INSERT') AS entries_insert,
           has_table_privilege(current_user, 'public.work_entries', 'UPDATE') AS entries_update,
           has_table_privilege(current_user, 'public.work_entries', 'DELETE') AS entries_delete,
           has_table_privilege(current_user, 'public.sync_receipts', 'SELECT') AS receipts_select,
           has_table_privilege(current_user, 'public.sync_receipts', 'INSERT') AS receipts_insert,
           has_table_privilege(current_user, 'public.sync_receipts', 'UPDATE') AS receipts_update,
           has_table_privilege(current_user, 'public.sync_conflicts', 'SELECT') AS conflicts_select,
           has_table_privilege(current_user, 'public.sync_conflicts', 'INSERT') AS conflicts_insert,
           has_table_privilege(current_user, 'public.sync_conflicts', 'UPDATE') AS conflicts_update,
           has_table_privilege(current_user, 'public.sync_conflicts', 'DELETE') AS conflicts_delete,
           has_table_privilege(current_user, 'public.sync_change_log', 'SELECT') AS change_select,
           has_table_privilege(current_user, 'public.sync_change_log', 'INSERT') AS change_insert,
           has_table_privilege(current_user, 'public.sync_change_log', 'UPDATE') AS change_update,
           has_table_privilege(current_user, 'public.sync_change_log', 'DELETE') AS change_delete`,
      ),
    );
    expect(rights.rows[0]).toMatchObject({
      workdays_select: true, workdays_insert: true, workdays_update: true, workdays_delete: false,
      entries_select: true, entries_insert: true, entries_update: true, entries_delete: false,
      receipts_select: true, receipts_insert: true, receipts_update: false,
      conflicts_select: true, conflicts_insert: true, conflicts_update: true, conflicts_delete: false,
      change_select: true, change_insert: false, change_update: false, change_delete: false,
    });
  });

  it("R3 worker assignment cannot be VOIDed after any workday exists in its period", async () => {
    const client = await app.connect();
    const assignmentId = `void-worker-${RUN}`;
    try {
      await client.query("BEGIN");
      await setTenant(client, companyId(A.company));
      await client.query(
        `INSERT INTO public.project_assignments
           (id, company_id, project_id, worker_id, from_date, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6)`,
        [assignmentId, A.company, A.project, A.worker, WORK_DATE, A.user],
      );
      await client.query("SAVEPOINT before_worker_void");
      await expect(
        client.query(
          `UPDATE public.project_assignments
              SET voided_at = clock_timestamp(), voided_by = $2,
                  void_reason = 'Pogrešan unos dodjele.'
            WHERE id = $1`,
          [assignmentId, A.user],
        ),
      ).rejects.toThrow(/PROJECT_ASSIGNMENT_HAS_WORKDAYS/);
      await client.query("ROLLBACK TO SAVEPOINT before_worker_void");
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  it("R3 machine assignment cannot be VOIDed after UNKNOWN_END records machine use", async () => {
    const client = await app.connect();
    const assignmentId = `void-machine-${RUN}`;
    try {
      await client.query("BEGIN");
      await setTenant(client, companyId(A.company));
      await client.query(
        `INSERT INTO public.project_assignments
           (id, company_id, project_id, machine_id, from_date, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6)`,
        [assignmentId, A.company, A.project, A.machine, WORK_DATE, A.user],
      );
      await client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, end_state,
            project_id, machine_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T10:00:00Z', 'UNKNOWN_END',
                 $5, $6, $7, $7)`,
        [`unknown-machine-${RUN}`, A.company, A.day, A.worker, A.project, A.machine, A.user],
      );
      await client.query("SAVEPOINT before_machine_void");
      await expect(
        client.query(
          `UPDATE public.project_assignments
              SET voided_at = clock_timestamp(), voided_by = $2,
                  void_reason = 'Pogrešan unos mašine.'
            WHERE id = $1`,
          [assignmentId, A.user],
        ),
      ).rejects.toThrow(/PROJECT_ASSIGNMENT_HAS_WORKDAYS/);
      await client.query("ROLLBACK TO SAVEPOINT before_machine_void");
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  it("kanonski dan je jedinstven po firmi/radniku/datumu i segment FK mora pratiti zaglavlje", async () => {
    await expect(
      withCompany(admin, companyId(A.company), (client) =>
        client.query(
          `INSERT INTO public.workdays (id, company_id, worker_id, work_date, created_by, updated_by)
           VALUES ($1, $2, $3, $4::date, $5, $5)`,
          [`duplicate-day-${RUN}`, A.company, A.worker, WORK_DATE, A.user],
        ),
      ),
    ).rejects.toThrow(/workdays_one_canonical_day|duplicate key/i);

    await expect(
      withCompany(admin, companyId(A.company), (client) =>
        client.query(
          `INSERT INTO public.work_entries
             (id, company_id, workday_id, worker_id, kind, started_at, end_state, project_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T10:00:00Z', 'OPEN', $5, $6, $6)`,
          [`wrong-worker-${RUN}`, A.company, A.day, B.worker, A.project, A.user],
        ),
      ),
    ).rejects.toThrow(/work_entries_workday_worker_fk|foreign key/i);
  });

  it("UNKNOWN_END ne zauzima interval; poznati i OPEN segmenti se ne smiju preklapati", async () => {
    await withCompany(admin, companyId(A.company), (client) =>
      client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, end_state, project_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T08:30:00Z', 'UNKNOWN_END', $5, $6, $6)`,
        [`unknown-overlap-${RUN}`, A.company, A.day, A.worker, A.project, A.user],
      ),
    );

    await expect(
      withCompany(admin, companyId(A.company), (client) =>
        client.query(
          `INSERT INTO public.work_entries
             (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T08:30:00Z', '2026-11-07T09:30:00Z',
                   'KNOWN_END', $5, $6, $6)`,
          [`known-overlap-${RUN}`, A.company, A.day, A.worker, A.project, A.user],
        ),
      ),
    ).rejects.toThrow(/WORK_ENTRY_OVERLAP/);

    await withCompany(admin, companyId(A.company), (client) =>
      client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T09:00:00Z', '2026-11-07T10:00:00Z',
                 'KNOWN_END', $5, $6, $6)`,
        [`adjacent-known-${RUN}`, A.company, A.day, A.worker, A.project, A.user],
      ),
    );

    await withCompany(admin, companyId(A.company), (client) =>
      client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, end_state, project_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T10:00:00Z', 'OPEN', $5, $6, $6)`,
        [`open-one-${RUN}`, A.company, A.day, A.worker, A.project, A.user],
      ),
    );
    await expect(
      withCompany(admin, companyId(A.company), (client) =>
        client.query(
          `INSERT INTO public.work_entries
             (id, company_id, workday_id, worker_id, kind, started_at, end_state, project_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 'WORK', '2026-11-07T11:00:00Z', 'OPEN', $5, $6, $6)`,
          [`open-two-${RUN}`, A.company, A.day, A.worker, A.project, A.user],
        ),
      ),
    ).rejects.toThrow(/WORK_ENTRY_OVERLAP|work_entries_one_open_per_worker|duplicate key/i);
  });

  it("receipt key/hash su nepromjenjivi, a detalji se brišu tek nakon roka", async () => {
    const defaultReceipt = await withCompany(app, companyId(A.company), (client) =>
      client.query<{ retention_seconds: string }>(
        `SELECT extract(epoch FROM (result_expires_at - created_at))::text AS retention_seconds
           FROM public.sync_receipts WHERE id = $1`,
        [A.receipt],
      ),
    );
    expect(Number(defaultReceipt.rows[0]?.retention_seconds)).toBeCloseTo(90 * 24 * 60 * 60, 0);

    await expect(
      withCompany(admin, companyId(A.company), (client) =>
        client.query(
          `INSERT INTO public.sync_receipts
             (id, company_id, actor_id, local_id, request_hash, result, result_expires_at, result_purged_at)
           VALUES ($1, $2, $3, $4, $5, NULL, clock_timestamp() - interval '1 second', clock_timestamp())`,
          [`prepurged-receipt-${RUN}`, A.company, A.user, `prepurged-local-${RUN}`, HASH_A],
        ),
      ),
    ).rejects.toThrow(/SYNC_RECEIPT_MUST_START_WITH_DETAILS/);

    const expiredId = `expired-receipt-${RUN}`;
    await withCompany(admin, companyId(A.company), (client) =>
      client.query(
        `INSERT INTO public.sync_receipts
           (id, company_id, actor_id, local_id, request_hash, result, result_expires_at)
         VALUES ($1, $2, $3, $4, $5, '{"accepted":true}'::jsonb, clock_timestamp() - interval '1 second')`,
        [expiredId, A.company, A.user, `expired-local-${RUN}`, HASH_A],
      ),
    );

    await expect(
      withCompany(admin, companyId(A.company), (client) =>
        client.query(
          "UPDATE public.sync_receipts SET request_hash = $1 WHERE id = $2",
          [HASH_B, expiredId],
        ),
      ),
    ).rejects.toThrow(/SYNC_RECEIPT_IDENTITY_IMMUTABLE/);

    const purged = await withCompany(admin, companyId(A.company), (client) =>
      client.query<{ result: unknown; result_purged_at: Date }>(
        "UPDATE public.sync_receipts SET result = NULL WHERE id = $1 RETURNING result, result_purged_at",
        [expiredId],
      ),
    );
    expect(purged.rows[0]).toMatchObject({ result: null });
    expect(purged.rows[0]?.result_purged_at).toBeInstanceOf(Date);
  });

  it("konflikt se razrješava jednom uz server vrijeme i per-company payload rok", async () => {
    const defaultRetention = await withCompany(app, companyId(A.company), (client) =>
      client.query<{ sync_conflict_retention_days: number }>(
        "SELECT sync_conflict_retention_days FROM public.companies WHERE id = $1",
        [A.company],
      ),
    );
    expect(defaultRetention.rows[0]?.sync_conflict_retention_days).toBe(90);

    const otherTenantDefault = await withCompany(app, companyId(B.company), (client) =>
      client.query<{ sync_conflict_retention_days: number }>(
        "SELECT sync_conflict_retention_days FROM public.companies WHERE id = $1",
        [B.company],
      ),
    );
    expect(otherTenantDefault.rows[0]?.sync_conflict_retention_days).toBe(90);

    await withCompany(admin, companyId(A.company), (client) =>
      client.query(
        "UPDATE public.companies SET sync_conflict_retention_days = 30 WHERE id = $1",
        [A.company],
      ),
    );
    const resolved = await withCompany(app, companyId(A.company), async (client) =>
      client.query<{ resolved_at: Date; payload_purge_after: Date; received_payload: unknown }>(
        `UPDATE public.sync_conflicts
            SET status = 'RESOLVED', resolved_by = $2, resolution_reason = 'Potvrđena je zadnja verzija rada.', resolution_kind = 'ACCEPT_SERVER'
          WHERE id = $1
          RETURNING resolved_at, payload_purge_after, received_payload`,
        [A.conflict, A.user],
      ),
    );
    const intervalDays =
      (resolved.rows[0]!.payload_purge_after.getTime() - resolved.rows[0]!.resolved_at.getTime()) / 86_400_000;
    expect(resolved.rows[0]?.resolved_at).toBeInstanceOf(Date);
    expect(intervalDays).toBeCloseTo(30, 3);
    expect(resolved.rows[0]?.received_payload).toEqual({ incoming: "A" });

    await expect(
      withCompany(app, companyId(A.company), (client) =>
        client.query("UPDATE public.sync_conflicts SET received_payload = NULL WHERE id = $1", [A.conflict]),
      ),
    ).rejects.toThrow(/SYNC_CONFLICT_RESOLUTION_IMMUTABLE/);

    await expect(
      withCompany(app, companyId(A.company), (client) =>
        client.query("UPDATE public.sync_conflicts SET resolution_reason = 'Promjena razloga' WHERE id = $1", [A.conflict]),
      ),
    ).rejects.toThrow(/SYNC_CONFLICT_RESOLUTION_IMMUTABLE/);
  });
});
