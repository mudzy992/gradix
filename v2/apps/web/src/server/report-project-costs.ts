/** Period costs reuse the same posted-ledger calculation as the dashboard. */
import type { Pool } from "pg";
import { companyId, periodTotals, withCompany } from "@gradix/db";
import { visibleProjectIds } from "@gradix/domain";
import { can, type Role, type Scope } from "./permissions";
import type { ReportDocument } from "./report-render";

export type ProjectCostReportActor = {
  userId: string;
  companyId: string;
  roles: readonly Role[];
  scope: Scope;
  projectIds: readonly string[] | null;
};
export type ProjectCostReportFilters = { from: string; to: string; projectId?: string };

function amount(centsValue: string): string {
  const cents = BigInt(centsValue);
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export async function loadProjectCostReport(
  pool: Pool,
  actor: ProjectCostReportActor,
  filters: ProjectCostReportFilters,
  generatedAt: Date = new Date(),
): Promise<ReportDocument> {
  if (!can(actor.roles, "projects.costs.view")) throw new Error("REPORT_FORBIDDEN");
  const allowed = visibleProjectIds({ userId: actor.userId, scope: actor.scope, projectIds: [...(actor.projectIds ?? [])] });
  return withCompany(pool, companyId(actor.companyId), async client => {
    const projects = await client.query<{ id: string; code: string; name: string; currency: string }>(
      `SELECT p.id,p.code,p.name,coalesce(p.currency_code,c.currency) AS currency
         FROM public.projects p JOIN public.companies c ON c.id=p.company_id
        WHERE p.company_id=$1 AND ($2::text[] IS NULL OR p.id=ANY($2::text[]))
          AND ($3::text IS NULL OR p.id=$3) ORDER BY p.code,p.id`,
      [actor.companyId, allowed, filters.projectId ?? null],
    );
    const rows: string[][] = [];
    for (const project of projects.rows) {
      const total = await periodTotals(client, actor.companyId, filters.from, filters.to, [project.id]);
      rows.push([project.code, project.name, amount(total.cents), project.currency]);
    }
    return {
      key: "PROJECT_COSTS", generatedBy: actor.userId, generatedAt: generatedAt.toISOString(),
      from: filters.from, to: filters.to, columns: ["Kod", "Projekat", "Knjizeni trosak", "Valuta"], rows,
    };
  });
}
