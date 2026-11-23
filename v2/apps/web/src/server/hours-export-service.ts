/** R6.2: locked/confirmed worker hours for list + CSV. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { computeHoursFromInterval, visibleProjectIds } from "@gradix/domain";
import { can } from "./permissions";
import type { HoursExportActor, HoursExportFilters, HoursExportRow } from "./hours-export-types";

type DbSeg = {
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

function mapStatus(raw: string): "LOCKED" | "CONFIRMED" {
  return raw === "LOCKED" ? "LOCKED" : "CONFIRMED";
}

function aggregate(segments: DbSeg[]): HoursExportRow[] {
  const map = new Map<string, HoursExportRow & { hoursNum: number }>();
  for (const seg of segments) {
    const hours = computeHoursFromInterval(new Date(seg.started_at), new Date(seg.ended_at));
    const status = mapStatus(seg.approval_status);
    const key = `${seg.worker_id}|${seg.work_date}|${seg.project_id}|${status}`;
    const existing = map.get(key);
    if (existing) {
      existing.hoursNum += hours;
      existing.hours = existing.hoursNum.toFixed(3);
      continue;
    }
    map.set(key, {
      workerId: seg.worker_id,
      worker: seg.worker_name,
      date: seg.work_date,
      hours: hours.toFixed(3),
      hoursNum: hours,
      projectId: seg.project_id,
      projectCode: seg.project_code,
      project: `${seg.project_code} — ${seg.project_name}`,
      status,
    });
  }
  return [...map.values()]
    .map(({ hoursNum: _, ...row }) => row)
    .sort((a, b) => a.date.localeCompare(b.date) || a.worker.localeCompare(b.worker));
}

export async function listHoursForExport(
  pool: Pool,
  actor: HoursExportActor,
  filters: HoursExportFilters,
): Promise<HoursExportRow[]> {
  if (!can(actor.roles, "payroll.hours.export")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const projectIds = visibleProjectIds({
      userId: actor.userId,
      scope: (actor.scope as "COMPANY" | "PROJECTS" | "SELF") ?? "COMPANY",
      projectIds: actor.projectIds ?? [],
    });
    const params: unknown[] = [actor.companyId, filters.from, filters.to];
    let scopeSql = "";
    if (projectIds !== null) {
      params.push(projectIds);
      scopeSql = `AND e.project_id = ANY($${params.length}::text[])`;
    }
    const result = await client.query<DbSeg>(
      `SELECT e.worker_id,
              (w.first_name || ' ' || w.last_name) AS worker_name,
              d.work_date::text AS work_date,
              e.project_id,
              p.code AS project_code,
              p.name AS project_name,
              d.approval_status,
              e.started_at::text,
              e.ended_at::text
         FROM public.work_entries e
         JOIN public.workdays d
           ON d.company_id = e.company_id AND d.id = e.workday_id
         JOIN public.workers w
           ON w.company_id = e.company_id AND w.id = e.worker_id
         JOIN public.projects p
           ON p.company_id = e.company_id AND p.id = e.project_id
        WHERE e.company_id = $1
          AND e.kind = 'WORK'
          AND e.end_state = 'KNOWN_END'
          AND e.ended_at IS NOT NULL
          AND d.approval_status IN ('LOCKED', 'FOREMAN_CONFIRMED')
          AND d.work_date >= $2::date
          AND d.work_date <= $3::date
          ${scopeSql}
        ORDER BY d.work_date, worker_name, p.code, e.started_at`,
      params,
    );
    return aggregate(result.rows);
  });
}
