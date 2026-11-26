import type { PoolClient } from "pg";

/** Raw segments used by the hours list/export. Caller must set tenant RLS and resolve scope. */
export type HoursExportSegment = {
  worker_id: string;
  worker_name: string;
  work_date: string;
  project_id: string;
  project_code: string;
  project_name: string;
  approval_status: string;
  started_at: string;
  ended_at: string;
};

/**
 * `projectIds` is an authorization boundary: null is reserved for an authorized COMPANY
 * actor; [] means no access. `projectId` and `team` only narrow that boundary.
 */
export async function hoursExportSegments(
  client: PoolClient,
  input: { companyId: string; from: string; to: string; projectIds: readonly string[] | null; projectId?: string; team?: string },
): Promise<HoursExportSegment[]> {
  const result = await client.query<HoursExportSegment>(
    `SELECT e.worker_id, (w.first_name || ' ' || w.last_name) AS worker_name,
            d.work_date::text AS work_date, e.project_id, p.code AS project_code,
            p.name AS project_name, d.approval_status, e.started_at::text, e.ended_at::text
       FROM public.work_entries e
       JOIN public.workdays d ON d.company_id = e.company_id AND d.id = e.workday_id
       JOIN public.workers w ON w.company_id = e.company_id AND w.id = e.worker_id
       JOIN public.projects p ON p.company_id = e.company_id AND p.id = e.project_id
      WHERE e.company_id = $1 AND e.kind = 'WORK' AND e.end_state = 'KNOWN_END'
        AND e.ended_at IS NOT NULL AND d.approval_status IN ('LOCKED', 'FOREMAN_CONFIRMED')
        AND d.work_date BETWEEN $2::date AND $3::date
        AND ($4::text[] IS NULL OR e.project_id = ANY($4::text[]))
        AND ($5::text IS NULL OR e.project_id = $5)
        AND ($6::text IS NULL OR w.team = $6)
      ORDER BY d.work_date, worker_name, p.code, e.started_at`,
    [input.companyId, input.from, input.to, input.projectIds, input.projectId ?? null, input.team ?? null],
  );
  return result.rows;
}
