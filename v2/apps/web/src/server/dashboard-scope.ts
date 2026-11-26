import type { PoolClient } from "pg";
import type { DashboardActor } from "./dashboard-aggregates";

/** Exactly the assigned-project scope used by the PM and site-supervisor cards. */
export async function dashboardAssignedProjects(client: PoolClient, actor: DashboardActor): Promise<string[]> {
  if (actor.scope === "SELF") return [];
  if (actor.scope === "PROJECTS") return [...(actor.projectIds ?? [])];
  if (actor.scope !== "COMPANY") return [];
  const rows = await client.query<{project_id:string}>(`SELECT DISTINCT a.project_id FROM public.project_assignments a
    JOIN public.workers w ON w.company_id=a.company_id AND w.id=a.worker_id
    JOIN public.companies c ON c.id=a.company_id
    WHERE a.company_id=$1 AND w.user_id=$2 AND w.is_active AND a.voided_at IS NULL
      AND a.from_date<=(clock_timestamp() AT TIME ZONE c.timezone)::date
      AND (a.to_date IS NULL OR a.to_date>=(clock_timestamp() AT TIME ZONE c.timezone)::date)`,[actor.companyId,actor.userId]);
  return rows.rows.map(row=>row.project_id);
}
