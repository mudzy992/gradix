import type { Pool } from "pg";
import type { ReportKey } from "@gradix/domain";
import type { Role, Scope } from "./permissions";
import { loadProjectCostReport } from "./report-project-costs";
import { loadWorkHoursReport } from "./report-work-hours";
import { loadMachinesReport } from "./report-machines";
import { loadFuelReport } from "./report-fuel";
import { loadDeadlinesReport } from "./report-deadlines";
import { loadTendersReport } from "./report-tenders";
import { loadHseReport } from "./report-hse";
import type { ReportDocument } from "./report-render";

type Actor = { userId: string; companyId: string; roles: Role[]; scope: Scope; projectIds: readonly string[] | null };
type Filters = { from: string; to: string; projectId?: string; team?: string };
type Loader = (pool: Pool, actor: Actor, filters: Filters, generatedAt: Date) => Promise<ReportDocument>;

/** Loader registry is data: one dispatch path, with each source retaining its own authorization. */
const LOADERS: Record<ReportKey, Loader> = {
  PROJECT_COSTS: loadProjectCostReport,
  MACHINE_UTILIZATION: loadMachinesReport,
  FUEL: loadFuelReport,
  WORK_HOURS: (pool, actor, filters, date) => loadWorkHoursReport(pool,
    {...actor, projectIds: actor.projectIds ?? []}, filters, date),
  DEADLINES: loadDeadlinesReport,
  TENDERS: loadTendersReport,
  HSE: loadHseReport,
};

/** Never silently ignore a filter that a source cannot enforce. */
export async function loadReport(pool: Pool, actor: Actor, key: ReportKey, filters: Filters, generatedAt = new Date()): Promise<ReportDocument> {
  if (filters.team && (key === "PROJECT_COSTS" || key === "DEADLINES" || key === "HSE")) {
    throw new Error("REPORT_UNSUPPORTED_FILTER");
  }
  return LOADERS[key](pool, actor, filters, generatedAt);
}
