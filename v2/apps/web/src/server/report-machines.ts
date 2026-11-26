import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { visibleProjectIds } from "@gradix/domain";
import { can, type Role, type Scope } from "./permissions";
import { machineUtilization } from "./machine-utilization-service";
import { getMachineCostRate } from "./machine-cost-component-service";
import { machinePeriodCosts, formatMachineCost } from "./machine-period-costs";
import type { ReportDocument } from "./report-render";

type Actor = { userId: string; companyId: string; roles: Role[]; scope: Scope; projectIds: readonly string[] | null };
type Filters = { from: string; to: string; projectId?: string; team?: string; asyncExport?: boolean };
const number = (value: number | null) => value === null ? "" : String(value);

/** Uses screen utilization, the posted ledger, and the effective rate at period end. */
export async function loadMachinesReport(pool: Pool, actor: Actor, filters: Filters, generatedAt = new Date()): Promise<ReportDocument> {
  if (!can(actor.roles,"equipment.view")) throw new Error("REPORT_FORBIDDEN");
  const maxMachines=filters.asyncExport ? 1000 : 200;
  const ids=visibleProjectIds({userId:actor.userId,scope:actor.scope,projectIds:actor.projectIds ?? []});
  const machines = await withCompany(pool, companyId(actor.companyId), async client => {
    const result = await client.query<{id:string;code:string;name:string}>(`SELECT m.id,m.code,m.name FROM public.machines m
      WHERE m.company_id=$1 AND m.is_active AND (($2::text[] IS NULL AND $3::text IS NULL AND $4::text IS NULL) OR EXISTS (
        SELECT 1 FROM public.machine_work_logs l JOIN public.workers w ON w.company_id=l.company_id AND w.id=l.worker_id
         WHERE l.company_id=m.company_id AND l.machine_id=m.id AND ($2::text[] IS NULL OR l.project_id=ANY($2::text[]))
           AND ($3::text IS NULL OR l.project_id=$3) AND ($4::text IS NULL OR w.team=$4)
           AND l.started_at >= $5::timestamptz AND l.ended_at <= $6::timestamptz + interval '1 day')
        OR ($4::text IS NULL AND EXISTS (SELECT 1 FROM public.cost_entries e
          WHERE e.company_id=m.company_id AND e.machine_id=m.id AND e.status IN ('POSTED','PENDING')
            AND e.occurred_on BETWEEN $5::date AND $6::date AND ($2::text[] IS NULL OR e.project_id=ANY($2::text[]))
            AND ($3::text IS NULL OR e.project_id=$3))))
      ORDER BY m.code,m.id LIMIT $7`,[actor.companyId,ids,filters.projectId ?? null,filters.team ?? null,
      `${filters.from}T00:00:00Z`,`${filters.to}T00:00:00Z`,maxMachines+1]);
    return result.rows;
  });
  if (machines.length > maxMachines) throw new Error("REPORT_TOO_LARGE");
  const showRate = can(actor.roles,"machines.cost_rate.view");
  const columns = ["Kod", "Masina", "Rad h", "Prazni hod h", "Kvar h", "Iskoristenost %", "Kvarova", "Zastoj min"];
  if (showRate) columns.push("Stopa/h na kraju perioda", "Valuta");
  const showCost = can(actor.roles,"projects.costs.view");
  if (showCost) columns.push(filters.team ? "Knjizeni trosak masine (svi timovi)" : "Knjizeni trosak masine", "Troskova bez cijene");
  const costs = showCost ? await withCompany(pool,companyId(actor.companyId),client=>machinePeriodCosts(client,{
    companyId:actor.companyId,machineIds:machines.map(machine=>machine.id),from:filters.from,to:filters.to,
    projectIds:ids,projectId:filters.projectId,
  })) : new Map();
  const rows: string[][] = [];
  for (const machine of machines) {
    const view = await machineUtilization(pool, actor, machine.id, filters.from, filters.to, {...filters,projectIds:ids});
    if (!view) throw new Error("REPORT_SOURCE_UNAVAILABLE");
    const row=[machine.code,machine.name,number(view.work_hours),number(view.idle_hours),number(view.breakdown_hours),
      number(view.utilization_pct),number(view.fault_count),number(view.downtime_minutes)];
    if (showRate) {
      const rate=await getMachineCostRate(pool,actor,machine.id,filters.to);
      const hasRate = rate && (rate.manual_rate !== null || rate.breakdown.length > 0);
      row.push(hasRate ? rate.effective_rate : "", hasRate ? rate.currency_code : "");
    }
    if (showCost) {
      const cost=costs.get(machine.id);
      row.push(formatMachineCost(cost), String(cost?.pendingCount ?? 0));
    }
    rows.push(row);
  }
  return {key:"MACHINE_UTILIZATION",generatedBy:actor.userId,generatedAt:generatedAt.toISOString(),
    from:filters.from,to:filters.to,columns,rows};
}
