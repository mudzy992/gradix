import type { PoolClient } from "pg";

/** Shared ledger/work-hours definition for dashboard and automated monthly PDF. Caller sets tenant RLS. */
export async function periodTotals(client: PoolClient, companyId: string, from: string, to: string, projectIds: readonly string[] | null) {
  const result = await client.query<{cents:string;hours:string}>(`SELECT
    (SELECT coalesce(sum(e.amount_cents),0)::text FROM public.cost_entries e
      WHERE e.company_id=$1 AND e.status='POSTED' AND e.occurred_on BETWEEN $2::date AND $3::date
        AND ($4::text[] IS NULL OR e.project_id=ANY($4::text[]))) AS cents,
    (SELECT coalesce(sum(extract(epoch FROM (e.ended_at-e.started_at))/3600),0)::numeric(20,3)::text
      FROM public.work_entries e JOIN public.workdays d ON d.company_id=e.company_id AND d.id=e.workday_id
      WHERE e.company_id=$1 AND e.kind='WORK' AND e.end_state='KNOWN_END' AND e.ended_at IS NOT NULL
        AND d.approval_status IN ('LOCKED','FOREMAN_CONFIRMED') AND d.work_date BETWEEN $2::date AND $3::date
        AND ($4::text[] IS NULL OR e.project_id=ANY($4::text[]))) AS hours`,[companyId,from,to,projectIds]);
  return result.rows[0]!;
}
