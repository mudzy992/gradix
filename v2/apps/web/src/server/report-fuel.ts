import type { Pool } from "pg";
import { visibleProjectIds } from "@gradix/domain";
import { can, type Role, type Scope } from "./permissions";
import { listFuelEntries } from "./fuel-entry-service";
import { canViewFuelPrice } from "./fuel-entry-price";
import type { ReportDocument } from "./report-render";

type Actor = { userId: string; companyId: string; roles: readonly Role[]; scope: Scope; projectIds: readonly string[] | null };
type Filters = { from: string; to: string; projectId?: string; team?: string; asyncExport?: boolean };

/** Fuel rows and deviation status come from the list service, not a second fuel calculation. */
export async function loadFuelReport(pool: Pool, actor: Actor, filters: Filters, generatedAt = new Date()): Promise<ReportDocument> {
  if (!can(actor.roles, "machines.fuel.view")) throw new Error("REPORT_FORBIDDEN");
  const ids = visibleProjectIds({userId:actor.userId, scope:actor.scope, projectIds:actor.projectIds ?? []});
  // Worker exports can exceed the synchronous cap, but remain bounded by renderer capacity.
  const maxRows=filters.asyncExport ? 10_000 : 1_000;
  const rows = await listFuelEntries(pool, actor, {
    from: `${filters.from}T00:00:00.000Z`,
    untilExclusive: new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86400000).toISOString(),
    projectIds:ids, projectId:filters.projectId, team:filters.team, limit:maxRows+1,
  });
  if (rows.length > maxRows) throw new Error("REPORT_TOO_LARGE");
  const price = canViewFuelPrice(actor.roles);
  const columns = ["Vrijeme", "Masina", "Vozac", "Projekat", "Litara", "Odstupanje %", "Stanje odstupanja"];
  if (price) columns.push("Iznos", "Valuta");
  return {
    key:"FUEL", generatedBy:actor.userId, generatedAt:generatedAt.toISOString(), from:filters.from, to:filters.to, columns,
    rows: rows.map(row => {
      const values = [row.filled_at, `${row.machine_code} ${row.machine_name}`, row.driver_name,
        row.project_name ?? "", String(row.liters), row.deviation_pct === null ? "" : String(row.deviation_pct), row.deviation_status ?? ""];
      if (price) values.push(row.amount ?? "", row.currency_code ?? "");
      return values;
    }),
  };
}
