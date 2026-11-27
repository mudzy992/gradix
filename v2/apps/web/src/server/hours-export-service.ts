/** R6.2: locked/confirmed worker hours for list + CSV. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany, hoursExportSegments, type HoursExportSegment } from "@gradix/db";
import { computeHoursFromInterval, visibleProjectIds } from "@gradix/domain";
import { can } from "./permissions";
import type { HoursExportActor, HoursExportFilters, HoursExportRow } from "./hours-export-types";

function mapStatus(raw: string): "LOCKED" | "CONFIRMED" {
  return raw === "LOCKED" ? "LOCKED" : "CONFIRMED";
}

function aggregate(segments: HoursExportSegment[]): HoursExportRow[] {
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
    const rows = await hoursExportSegments(client, {
      companyId: actor.companyId, from: filters.from, to: filters.to, projectIds,
      projectId: filters.projectId, team: filters.team, maxSegments: filters.maxSegments,
    });
    if (filters.maxSegments && rows.length >= filters.maxSegments) throw new Error("REPORT_TOO_LARGE");
    return aggregate(rows);
  });
}
