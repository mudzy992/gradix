import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { can, type Role, type Scope } from "./permissions";
import { listObligations, type ObligationRow } from "./obligation-service";
import type { ReportDocument } from "./report-render";

type Actor = { userId: string; companyId: string; roles: readonly Role[]; scope: Scope; projectIds: readonly string[] | null };
type Filters = { from: string; to: string; projectId?: string };

/** Reuses list state, urgency, and review-date semantics. Attachments and notes are never exported. */
export async function loadDeadlinesReport(pool: Pool, actor: Actor, filters: Filters, generatedAt = new Date()): Promise<ReportDocument> {
  if (!can(actor.roles, "obligations.view")) throw new Error("REPORT_FORBIDDEN");
  const rowsPage = await listObligations(pool, companyId(actor.companyId), {}, {
    userId: actor.userId, scope: actor.scope, projectIds: actor.projectIds, includeAttachments: false,
  });
  let rows: ObligationRow[] = rowsPage.obligations;
  if (filters.projectId) {
    // A project filter also includes workers and machines assigned to that project.
    const wanted = filters.projectId;
    const targets = await withCompany(pool, companyId(actor.companyId), client => client.query<{worker_id:string|null;machine_id:string|null}>(
      `SELECT a.worker_id,a.machine_id FROM public.project_assignments a JOIN public.companies c ON c.id=a.company_id
       WHERE a.company_id=$1 AND a.project_id=$2 AND a.voided_at IS NULL
       AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
       AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)`, [actor.companyId,wanted]));
    const workers = new Set(targets.rows.map(r => r.worker_id).filter(Boolean));
    const machines = new Set(targets.rows.map(r => r.machine_id).filter(Boolean));
    rows = rows.filter(r => r.projectId === wanted || (r.workerId !== null && workers.has(r.workerId)) || (r.machineId !== null && machines.has(r.machineId)));
  }
  rows = rows.filter(row => {
    const date = row.expiresAt ?? row.reviewAt;
    return date !== null && date >= filters.from && date <= filters.to;
  });
  return {
    key: "DEADLINES", generatedBy: actor.userId, generatedAt: generatedAt.toISOString(), from: filters.from, to: filters.to,
    columns: ["Tip", "Vrsta", "Entitet", "Istice", "Provjera", "Stanje"],
    rows: rows.map(row => [row.typeLabel, row.entityKind,
      row.entityKind === "WORKER" && !can(actor.roles, "workers.view") ? "Radnik" :
        row.workerName ?? row.machineName ?? row.projectName ?? row.tenderTitle ?? "Firma",
      row.expiresAt ?? "", row.reviewAt ?? "", row.state]),
  };
}
