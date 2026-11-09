import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "./tenant";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const COMPANY = `cmp_history_${RUN}`;
const PROJECT = `prj_history_${RUN}`;
const WORKER_A = `wrk_history_a_${RUN}`;
const WORKER_B = `wrk_history_b_${RUN}`;

/**
 * R3 history guard on a real PostgreSQL database. Fixtures use unique IDs and are intentionally
 * retained: the database itself forbids deleting assignment history, and reruns must not mutate
 * an earlier run's evidence.
 */
describeDb("R3 assignment-history guard (PostgreSQL)", () => {
  const app = new Pool({ connectionString: appUrl, max: 3 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let today = "";
  let yesterday = "";
  let tomorrow = "";
  let afterTomorrow = "";

  beforeAll(async () => {
    await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'History guard test', $2)", [
      COMPANY,
      `history-${RUN}`,
    ]);
    const dates = await admin.query<{ today: string; yesterday: string; tomorrow: string; after_tomorrow: string }>(
      `SELECT (clock_timestamp() AT TIME ZONE timezone)::date::text AS today,
              ((clock_timestamp() AT TIME ZONE timezone)::date - 1)::text AS yesterday,
              ((clock_timestamp() AT TIME ZONE timezone)::date + 1)::text AS tomorrow,
              ((clock_timestamp() AT TIME ZONE timezone)::date + 2)::text AS after_tomorrow
         FROM public.companies WHERE id = $1`,
      [COMPANY],
    );
    today = dates.rows[0]!.today;
    yesterday = dates.rows[0]!.yesterday;
    tomorrow = dates.rows[0]!.tomorrow;
    afterTomorrow = dates.rows[0]!.after_tomorrow;

    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query(
        "INSERT INTO projects (id, company_id, code, name) VALUES ($1, $2, 'HISTORY-1', 'History test')",
        [PROJECT, COMPANY],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at)
         VALUES ($1, $3, 'Test', 'A', '2025-01-01'), ($2, $3, 'Test', 'B', '2025-01-01')`,
        [WORKER_A, WORKER_B, COMPANY],
      );
      await client.query(
        `INSERT INTO project_assignments
           (id, company_id, project_id, worker_id, from_date, to_date, created_by)
         VALUES ($1, $2, $3, $4, $5::date - 10, NULL, 'history-test')`,
        [`pas_history_a_${RUN}`, COMPANY, PROJECT, WORKER_A, today],
      );
      await client.query(
        `INSERT INTO project_assignments
           (id, company_id, project_id, worker_id, from_date, to_date, created_by)
         VALUES ($1, $2, $3, $4, $5::date - 2, NULL, 'history-test')`,
        [`pas_history_b_${RUN}`, COMPANY, PROJECT, WORKER_B, today],
      );
    });
  }, 60_000);

  afterAll(async () => {
    await app.end();
    await admin.end();
  });

  it("runtime rola nema DELETE; čak ni administratorski DELETE/TRUNCATE ne briše historiju", async () => {
    const rights = await withCompany(app, companyId(COMPANY), async (client) =>
      client.query<{ can_delete: boolean; can_truncate: boolean }>(
        `SELECT has_table_privilege(current_user, 'public.project_assignments', 'DELETE') AS can_delete,
                has_table_privilege(current_user, 'public.project_assignments', 'TRUNCATE') AS can_truncate`,
      ),
    );
    expect(rights.rows[0]).toMatchObject({ can_delete: false, can_truncate: false });

    await expect(
      admin.query("DELETE FROM public.project_assignments WHERE id = $1", [`pas_history_a_${RUN}`]),
    ).rejects.toThrow(/PROJECT_ASSIGNMENT_DELETE_FORBIDDEN/);

    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      await client.query("SAVEPOINT before_forbidden_truncate");
      await expect(client.query("TRUNCATE TABLE public.project_assignments")).rejects.toThrow(
        /PROJECT_ASSIGNMENT_TRUNCATE_FORBIDDEN/,
      );
      await client.query("ROLLBACK TO SAVEPOINT before_forbidden_truncate");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("to_date se postavlja samo danas/ubuduće, može se produžiti, nikad skratiti", async () => {
    const assignmentId = `pas_history_a_${RUN}`;
    await expect(
      withCompany(app, companyId(COMPANY), async (client) =>
        client.query("UPDATE project_assignments SET from_date = $1 WHERE id = $2", [yesterday, assignmentId]),
      ),
    ).rejects.toThrow(/PROJECT_ASSIGNMENT_IDENTITY_IMMUTABLE/);

    await expect(
      withCompany(app, companyId(COMPANY), async (client) =>
        client.query("UPDATE project_assignments SET to_date = $1 WHERE id = $2", [yesterday, assignmentId]),
      ),
    ).rejects.toThrow(/PROJECT_ASSIGNMENT_END_MUST_BE_TODAY_OR_FUTURE/);

    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query("UPDATE project_assignments SET to_date = $1 WHERE id = $2", [today, assignmentId]);
    });

    const historical = await withCompany(app, companyId(COMPANY), async (client) =>
      client.query<{ authorized_yesterday: boolean; authorized_tomorrow: boolean; to_date: string }>(
        `SELECT EXISTS (
                  SELECT 1 FROM project_assignments a
                   WHERE a.id = $1 AND a.company_id = $2 AND a.project_id = $3
                     AND a.worker_id = $4 AND a.voided_at IS NULL
                     AND a.from_date <= $5::date
                     AND (a.to_date IS NULL OR $5::date <= a.to_date)
                ) AS authorized_yesterday,
                EXISTS (
                  SELECT 1 FROM project_assignments a
                   WHERE a.id = $1 AND a.company_id = $2 AND a.project_id = $3
                     AND a.worker_id = $4 AND a.voided_at IS NULL
                     AND a.from_date <= $6::date
                     AND (a.to_date IS NULL OR $6::date <= a.to_date)
                ) AS authorized_tomorrow,
                (SELECT to_date::text FROM project_assignments WHERE id = $1) AS to_date`,
        [assignmentId, COMPANY, PROJECT, WORKER_A, yesterday, tomorrow],
      ),
    );
    // Predicate regression only: foreman work_date push/pull is not implemented yet (it is an
    // R4a-2 gate). The route-level authorization test must exercise this same inclusive condition.
    expect(historical.rows[0]).toMatchObject({
      authorized_yesterday: true,
      authorized_tomorrow: false,
      to_date: today,
    });

    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query("UPDATE project_assignments SET to_date = $1 WHERE id = $2", [afterTomorrow, assignmentId]);
    });
    await expect(
      withCompany(app, companyId(COMPANY), async (client) =>
        client.query("UPDATE project_assignments SET to_date = $1 WHERE id = $2", [tomorrow, assignmentId]),
      ),
    ).rejects.toThrow(/PROJECT_ASSIGNMENT_END_CANNOT_MOVE_BACKWARDS/);

    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query("UPDATE project_assignments SET to_date = NULL WHERE id = $1", [assignmentId]);
    });
  });

  it("baza ne dopušta umetanje dodjele koja je već poništena", async () => {
    await expect(
      withCompany(app, companyId(COMPANY), async (client) =>
        client.query(
          `INSERT INTO project_assignments
             (id, company_id, project_id, worker_id, from_date, to_date, created_by,
              voided_at, voided_by, void_reason)
           VALUES ($1, $2, $3, $4, $5::date, $6::date, 'history-test',
                   clock_timestamp(), 'history-test', 'Unos je pogrešan.')`,
          [`pas_history_prevoid_${RUN}`, COMPANY, PROJECT, WORKER_A, today, tomorrow],
        ),
      ),
    ).rejects.toThrow(/PROJECT_ASSIGNMENT_VOID_ONLY_AFTER_CREATE/);
  });

  it("pogrešna dodjela traži razlog, postaje append-only void i oslobađa overlap", async () => {
    const assignmentId = `pas_history_b_${RUN}`;
    await expect(
      withCompany(app, companyId(COMPANY), async (client) =>
        client.query(
          `UPDATE project_assignments
              SET voided_at = clock_timestamp(), voided_by = 'history-test', void_reason = 'kratko'
            WHERE id = $1`,
          [assignmentId],
        ),
      ),
    ).rejects.toThrow(/PROJECT_ASSIGNMENT_VOID_REASON_REQUIRED|project_assignments_void_fields_check/);

    await expect(
      withCompany(app, companyId(COMPANY), async (client) =>
        client.query(
          `UPDATE project_assignments
              SET voided_at = clock_timestamp(), voided_by = ' ',
                  void_reason = 'Pogrešan odabir radnika.'
            WHERE id = $1`,
          [assignmentId],
        ),
      ),
    ).rejects.toThrow(/PROJECT_ASSIGNMENT_VOID_REASON_REQUIRED|project_assignments_void_fields_check/);

    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query(
        `UPDATE project_assignments
            SET voided_at = clock_timestamp(), voided_by = 'history-test',
                void_reason = 'Pogrešan odabir radnika.'
          WHERE id = $1`,
        [assignmentId],
      );
    });

    const voided = await withCompany(app, companyId(COMPANY), async (client) =>
      client.query<{ voided_at: Date; voided_by: string; void_reason: string; from_date: string }>(
        "SELECT voided_at, voided_by, void_reason, from_date::text FROM project_assignments WHERE id = $1",
        [assignmentId],
      ),
    );
    expect(voided.rows[0]).toMatchObject({
      voided_by: "history-test",
      void_reason: "Pogrešan odabir radnika.",
    });
    expect(voided.rows[0]?.voided_at).toBeInstanceOf(Date);

    await expect(
      withCompany(app, companyId(COMPANY), async (client) =>
        client.query("UPDATE project_assignments SET void_reason = 'izmijenjeno' WHERE id = $1", [assignmentId]),
      ),
    ).rejects.toThrow(/PROJECT_ASSIGNMENT_VOID_IS_IMMUTABLE/);

    // Partial EXCLUDE ili fallback trigger preskače void red, pa korekcija može imati isti period.
    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO project_assignments
           (id, company_id, project_id, worker_id, from_date, created_by)
         VALUES ($1, $2, $3, $4, $5::date - 2, 'history-test')`,
        [`pas_history_b_replacement_${RUN}`, COMPANY, PROJECT, WORKER_B, today],
      );
    });
  });

  it("historical assignment FK-ovi sprječavaju brisanje projekta i radnika", async () => {
    await expect(admin.query("DELETE FROM public.projects WHERE id = $1", [PROJECT])).rejects.toThrow(/foreign key/i);
    await expect(admin.query("DELETE FROM public.workers WHERE id = $1", [WORKER_A])).rejects.toThrow(/foreign key/i);
  });
});
