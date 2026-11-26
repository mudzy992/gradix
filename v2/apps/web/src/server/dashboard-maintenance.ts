import type { PoolClient } from "pg";
import type { DashboardActor } from "./dashboard-aggregates";
import { dueMaintenancePlans } from "./maintenance-service";

/** Shared by the dashboard count and the filtered list. */
export async function dashboardDuePlans(client: PoolClient, actor: DashboardActor) {
  const today = await client.query<{today:string}>(`SELECT (clock_timestamp() AT TIME ZONE timezone)::date::text AS today
    FROM public.companies WHERE id=$1`,[actor.companyId]);
  const plans = await dueMaintenancePlans(client, actor.companyId, today.rows[0]!.today);
  if (actor.scope === "COMPANY") return plans;
  const scopeIds = actor.scope === "PROJECTS" ? [...(actor.projectIds ?? [])] : [];
  const visible = await client.query<{id:string}>(`SELECT DISTINCT m.id
    FROM public.machines m WHERE m.company_id=$1 AND (
      ($4::boolean AND EXISTS (SELECT 1 FROM public.service_orders so JOIN public.workers w
        ON w.company_id=so.company_id AND w.id=so.assigned_mechanic_worker_id
        WHERE so.company_id=m.company_id AND so.machine_id=m.id AND w.user_id=$3 AND w.is_active))
      OR (NOT $4::boolean AND EXISTS (SELECT 1 FROM public.project_assignments a
        WHERE a.company_id=m.company_id AND a.machine_id=m.id AND a.project_id=ANY($2::text[]) AND a.voided_at IS NULL
          AND a.from_date<=(clock_timestamp() AT TIME ZONE (SELECT c.timezone FROM public.companies c WHERE c.id=m.company_id))::date
          AND (a.to_date IS NULL OR a.to_date>=(clock_timestamp() AT TIME ZONE (SELECT c.timezone FROM public.companies c WHERE c.id=m.company_id))::date))))`,
    [actor.companyId,scopeIds,actor.userId,actor.scope === "SELF"]);
  const allowed = new Set(visible.rows.map(row=>row.id));
  return plans.filter(plan=>allowed.has(plan.machine_id));
}
