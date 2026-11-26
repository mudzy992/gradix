import type { Pool } from "pg";
import { companyId } from "@gradix/db";
import { visibleProjectIds } from "@gradix/domain";
import { can, type Role, type Scope } from "./permissions";
import { listObligations, type ObligationRow } from "./obligation-service";
import type { ReportDocument } from "./report-render";

type Actor = { userId: string; companyId: string; roles: readonly Role[]; scope: Scope; projectIds: readonly string[] | null };
type Filters = { from: string; to: string; projectId?: string };

/** Reuses list state, urgency, and review-date semantics. Attachments and notes are never exported. */
export async function loadDeadlinesReport(pool: Pool, actor: Actor, filters: Filters, generatedAt = new Date()): Promise<ReportDocument> {
  if (!can(actor.roles, "obligations.view")) throw new Error("REPORT_FORBIDDEN");
  const allowed = visibleProjectIds({ userId: actor.userId, scope: actor.scope, projectIds: actor.projectIds ?? [] });
  let rows: ObligationRow[] = [];
  if (actor.scope === "SELF") {
    if (!filters.projectId) rows = (await listObligations(pool, companyId(actor.companyId), {},
      { scope: "SELF", userId: actor.userId, includeAttachments: false })).obligations;
  } else if (allowed === null) {
    rows = (await listObligations(pool, companyId(actor.companyId), {projectId: filters.projectId}, {includeAttachments:false})).obligations;
  } else {
    const projects = filters.projectId ? allowed.filter(id=>id === filters.projectId) : allowed;
    for (const projectId of projects) {
      rows.push(...(await listObligations(pool, companyId(actor.companyId), {projectId}, {includeAttachments:false})).obligations);
    }
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
