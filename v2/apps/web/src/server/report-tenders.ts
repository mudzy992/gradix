import type { Pool } from "pg";
import { visibleProjectIds } from "@gradix/domain";
import { can, type Role, type Scope } from "./permissions";
import { listTenders } from "./tender-service";
import { listTenderChecklist } from "./tender-checklist-service";
import { getTenderOutcome } from "./tender-outcome-service";
import type { ReportDocument } from "./report-render";

type Actor = { userId: string; companyId: string; roles: Role[]; scope: Scope; projectIds: readonly string[] | null };
type Filters = { from: string; to: string; projectId?: string; team?: string };

/** The list, checklist and outcome services remain the source of truth and enforce margin RBAC. */
export async function loadTendersReport(pool: Pool, actor: Actor, filters: Filters, generatedAt = new Date()): Promise<ReportDocument> {
  if (!can(actor.roles, "tenders.view")) throw new Error("REPORT_FORBIDDEN");
  const ids = visibleProjectIds({userId:actor.userId, scope:actor.scope, projectIds:actor.projectIds ?? []});
  const tenders = await listTenders(pool, actor, {...filters, projectIds:ids, limit:201});
  if (tenders.length > 200) throw new Error("REPORT_TOO_LARGE");
  const showMargin = can(actor.roles, "tenders.price.manage");
  const columns = ["Tender", "Narucilac", "Status", "Rok", "Ponuda", "Valuta", "Ishod", "Razlog", "Garancije"];
  if (showMargin) columns.push("Marza %");
  const rows: string[][] = [];
  for (const tender of tenders) {
    const [checklist, outcome] = await Promise.all([listTenderChecklist(pool,actor,tender.id),getTenderOutcome(pool,actor,tender.id)]);
    if ("outcome" in checklist || !outcome.ok) throw new Error("REPORT_SOURCE_UNAVAILABLE");
    const guarantees = checklist.items.filter(item=>item.guaranteeType).map(item=>
      `${item.guaranteeType}: ${item.amount ?? ""} ${item.validUntil ?? ""} ${item.returnedAt ? "vracena" : "nije vracena"}`).join("; ");
    const row = [tender.title,tender.partnerName,tender.status,tender.deadlineAt ?? "",tender.submittedValueAmount,tender.currencyCode,
      outcome.outcome?.result ?? "",outcome.outcome?.lostReason ?? "",guarantees];
    if (showMargin) row.push(tender.markupPct ?? "");
    rows.push(row);
  }
  return { key:"TENDERS", generatedBy:actor.userId, generatedAt:generatedAt.toISOString(),
    from:filters.from, to:filters.to, columns, rows };
}
