import type { Pool } from "pg";
import { listActiveCompanyIds } from "./company-ids";
import type { JobLogger } from "./jobs";

/** Refresh from source ledger/work logs, never increment: safe on retries and late corrections. */
export async function refreshDailyRollups(pool: Pool, options: { logger: JobLogger; onlyCompanyId?: string }) {
  let companies = 0, rows = 0;
  for (const companyId of await listActiveCompanyIds(pool, options.onlyCompanyId)) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended('rollup.nightly:' || $1, 0)) AS locked", [companyId],
      );
      if (!lock.rows[0]?.locked) throw new Error("ROLLUP_ALREADY_RUNNING");
      const result = await client.query(`
        WITH costs AS (
          SELECT e.project_id, e.occurred_on AS day, sum(e.amount_cents)::bigint AS cost
          FROM public.cost_entries e WHERE e.company_id=$1 AND e.project_id IS NOT NULL AND e.status='POSTED'
          GROUP BY e.project_id,e.occurred_on
        ), hours AS (
          SELECT e.project_id,d.work_date AS day,count(DISTINCT d.id)::int AS days,
                 sum(extract(epoch FROM (e.ended_at-e.started_at))/3600) AS hours
          FROM public.work_entries e JOIN public.workdays d ON d.company_id=e.company_id AND d.id=e.workday_id
          WHERE e.company_id=$1 AND e.project_id IS NOT NULL AND e.kind='WORK' AND e.end_state='KNOWN_END'
            AND e.ended_at IS NOT NULL AND d.approval_status IN ('LOCKED','FOREMAN_CONFIRMED')
          GROUP BY e.project_id,d.work_date
        ), machines AS (
          SELECT m.project_id,(m.started_at AT TIME ZONE c.timezone)::date AS day,
                 sum(extract(epoch FROM (m.ended_at-m.started_at))/3600) AS hours
          FROM public.machine_work_logs m JOIN public.companies c ON c.id=m.company_id
          WHERE m.company_id=$1 AND m.project_id IS NOT NULL AND m.mode='WORK'
          GROUP BY m.project_id,(m.started_at AT TIME ZONE c.timezone)::date
        ), fuel AS (
          SELECT f.project_id,(f.filled_at AT TIME ZONE c.timezone)::date AS day,sum(f.liters) AS liters
          FROM public.fuel_entries f JOIN public.companies c ON c.id=f.company_id
          WHERE f.company_id=$1 AND f.project_id IS NOT NULL
          GROUP BY f.project_id,(f.filled_at AT TIME ZONE c.timezone)::date
        ), keys AS (
          SELECT project_id,day FROM costs UNION SELECT project_id,day FROM hours
          UNION SELECT project_id,day FROM machines UNION SELECT project_id,day FROM fuel
          UNION SELECT project_id,rollup_date FROM public.daily_rollups WHERE company_id=$1 AND project_id IS NOT NULL
        )
        INSERT INTO public.daily_rollups (id,company_id,project_id,rollup_date,workday_count,hours_total,machine_hours,fuel_liters,cost_cents,computed_at)
        SELECT gen_random_uuid()::text,$1,k.project_id,k.day,coalesce(h.days,0),coalesce(h.hours,0),
               coalesce(m.hours,0),coalesce(f.liters,0),coalesce(c.cost,0),clock_timestamp()
        FROM keys k LEFT JOIN costs c USING(project_id,day) LEFT JOIN hours h USING(project_id,day)
          LEFT JOIN machines m USING(project_id,day) LEFT JOIN fuel f USING(project_id,day)
        ON CONFLICT (company_id,project_id,rollup_date) WHERE project_id IS NOT NULL
        DO UPDATE SET workday_count=excluded.workday_count,hours_total=excluded.hours_total,
          machine_hours=excluded.machine_hours,fuel_liters=excluded.fuel_liters,
          cost_cents=excluded.cost_cents,computed_at=excluded.computed_at`, [companyId]);
      await client.query("COMMIT");
      companies++; rows += result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  options.logger.info("rollup.nightly", { companies, rows });
  return { companies, rows };
}
