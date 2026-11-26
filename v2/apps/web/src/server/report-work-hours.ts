/** WORK_HOURS report uses exactly the same confirmed/locked rows as the hours list export. */
import type { Pool } from "pg";
import { can } from "./permissions";
import { listHoursForExport } from "./hours-export-service";
import type { HoursExportActor, HoursExportFilters } from "./hours-export-types";
import type { ReportDocument } from "./report-render";

export async function loadWorkHoursReport(
  pool: Pool,
  actor: HoursExportActor,
  filters: HoursExportFilters,
  generatedAt: Date = new Date(),
): Promise<ReportDocument> {
  if (!can(actor.roles, "payroll.hours.export")) throw new Error("REPORT_FORBIDDEN");
  const rows = await listHoursForExport(pool, actor, filters);
  // No rates, sensitive worker fields or attachments are fetched by the shared source.
  return {
    key: "WORK_HOURS",
    generatedBy: actor.userId,
    generatedAt: generatedAt.toISOString(),
    from: filters.from,
    to: filters.to,
    columns: ["Radnik", "Datum", "Projekat", "Sati", "Status"],
    rows: rows.map(row => [row.worker, row.date, row.project, row.hours, row.status]),
  };
}
