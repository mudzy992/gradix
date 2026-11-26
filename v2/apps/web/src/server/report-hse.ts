import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { visibleProjectIds } from "@gradix/domain";
import { can, type Role, type Scope } from "./permissions";
import { hseStats } from "./hse-service";
import type { ReportDocument } from "./report-render";

type Actor = { userId: string; companyId: string; roles: readonly Role[]; scope: Scope; projectIds: readonly string[] | null };
type Filters = { from: string; to: string; projectId?: string; asyncExport?: boolean };
const value = (n: number | null) => n === null ? "—" : String(n);

/** HSE report shares the screen's statistics, but never reads outside the actor's project scope. */
export async function loadHseReport(pool: Pool, actor: Actor, filters: Filters, generatedAt = new Date()): Promise<ReportDocument> {
  if (!can(actor.roles, "hse.view")) throw new Error("REPORT_FORBIDDEN");
  const maxProjects=filters.asyncExport ? 1000 : 200;
  const ids = visibleProjectIds({ userId: actor.userId, scope: actor.scope, projectIds: actor.projectIds ?? [] });
  const targets = await withCompany(pool, companyId(actor.companyId), async client => {
    if (ids === null && !filters.projectId) return [{ id: null, name: "Firma" }];
    const projects = await client.query<{id:string;name:string}>(`SELECT id,name FROM public.projects
      WHERE company_id=$1 AND ($2::text[] IS NULL OR id=ANY($2::text[]))
        AND ($3::text IS NULL OR id=$3) ORDER BY code,id LIMIT $4`,
    [actor.companyId, ids, filters.projectId ?? null,maxProjects+1]);
    return projects.rows;
  });
  if (targets.length > maxProjects) throw new Error("REPORT_TOO_LARGE");
  const rows: string[][] = [];
  for (const target of targets) {
    const stats = await hseStats(pool, actor, { from: filters.from, to: filters.to, projectId: target.id ?? undefined });
    const kinds = Object.entries(stats.byKind).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}: ${v}`).join(", ");
    const severities = Object.entries(stats.bySeverity).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}: ${v}`).join(", ");
    rows.push([target.name, value(stats.workedHours), value(stats.incidents), kinds, severities,
      value(stats.nearMisses), value(stats.lostDays), value(stats.ltifr), value(stats.actions.open),
      value(stats.actions.overdue), value(stats.actions.onTimeRate), value(stats.trainings.count),
      value(stats.trainings.toolbox), value(stats.trainings.attendees), stats.activeProhibition ? "DA" : "NE"]);
  }
  return { key: "HSE", generatedBy: actor.userId, generatedAt: generatedAt.toISOString(), from: filters.from, to: filters.to,
    columns: ["Projekat", "Sati", "Incidenti", "Vrste", "Tezina", "Near miss", "Izgubljeni dani", "LTIFR",
      "Otvorene mjere", "Mjere kasne", "Mjere na vrijeme %", "Obuke", "Toolbox", "Prisustva", "Zabrana"], rows };
}
