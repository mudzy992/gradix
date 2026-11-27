/** Detail panels reuse the calculations of the existing project and machine screens. */
import type { PoolClient } from "pg";
import { projectFinancialSummariesWithClient } from "../app/ured/projekti/projects-summary";
import { getMachineCostRateWithClient } from "./machine-cost-component-service";
import type { DashboardActor } from "./dashboard-aggregates";
import type { Role } from "./permissions";

export async function dashboardProjectDetails(client: PoolClient, actor: DashboardActor, assigned: readonly string[]) {
  if (!actor.roles.includes("PROJECT_MANAGER") || assigned.length === 0) return [];
  const projects = await client.query<{id:string}>(`SELECT id FROM public.projects
    WHERE company_id=$1 AND is_active AND status<>'CANCELLED' AND id=ANY($2::text[]) ORDER BY code,id`,
  [actor.companyId,assigned]);
  const summaries = await projectFinancialSummariesWithClient(client, actor.companyId, projects.rows.map(p=>p.id));
  return [...summaries.values()].map(p=>({projectId:p.project_id,code:p.code,name:p.name,
    budget:p.budget_amount,actual:p.posted_amount,currency:p.currency_code,progressPercent:p.progress_pct,
    budgetUsedPercent:p.budget_used_pct,href:`/ured/projekti/${encodeURIComponent(p.project_id)}`}));
}

export async function dashboardTopMachines(client: PoolClient, actor: DashboardActor, scopeIds: readonly string[] | null) {
  if (!actor.roles.includes("OWNER") && !actor.roles.includes("ADMIN")) return [];
  const machines = await client.query<{id:string}>(`SELECT m.id FROM public.machines m
    WHERE m.company_id=$1 AND m.is_active AND ($2::text[] IS NULL OR EXISTS (
      SELECT 1 FROM public.project_assignments a JOIN public.companies c ON c.id=a.company_id
       WHERE a.company_id=m.company_id AND a.machine_id=m.id AND a.project_id=ANY($2::text[])
         AND a.voided_at IS NULL AND a.from_date<=(clock_timestamp() AT TIME ZONE c.timezone)::date
         AND (a.to_date IS NULL OR a.to_date>=(clock_timestamp() AT TIME ZONE c.timezone)::date)))
    ORDER BY m.id`,[actor.companyId,scopeIds]);
  const rates = [];
  for (const m of machines.rows) {
    const r=await getMachineCostRateWithClient(client,{userId:actor.userId,companyId:actor.companyId,roles:actor.roles as Role[]},m.id);
    if (!r || (r.manual_rate === null && r.breakdown.length === 0)) continue;
    const cents=BigInt(r.effective_rate.replace(".",""));
    if (cents <= 0n) continue;
    rates.push({machineId:r.machine_id,code:r.machine_code,name:r.machine_name,
      rate:r.effective_rate,currency:r.currency_code,href:`/ured/masine/${encodeURIComponent(r.machine_id)}`, cents});
  }
  rates.sort((a,b)=>a.cents === b.cents ? a.machineId.localeCompare(b.machineId) : a.cents > b.cents ? -1 : 1);
  return rates.slice(0,3).map(({cents: _cents, ...row})=>row);
}
