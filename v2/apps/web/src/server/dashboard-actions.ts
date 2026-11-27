/** Role-targeted actions; queries execute under tenant RLS and never broaden actor scope. */
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import type { DashboardActor } from "./dashboard-aggregates";
import { sharedWorkdayAssignment } from "./workday-review-sql";
import { dashboardAssignedProjects } from "./dashboard-scope";
import { dashboardDuePlans } from "./dashboard-maintenance";
import { dashboardProjectDetails, dashboardTopMachines } from "./dashboard-details";

type DashboardRole = "OWNER" | "PROJECT_MANAGER" | "SITE_SUPERVISOR" | "ACCOUNTANT" | "MECHANIC";
type Definition = { key: string; role: DashboardRole; href: string; priority: number; sql: string; global?: boolean };
export const DASHBOARD_ACTIONS: readonly Definition[] = [
  {role:"OWNER",key:"risky_projects",href:"/ured/akcije?key=risky_projects",priority:1,sql:`SELECT count(*)::int AS n FROM public.projects p,ctx
    WHERE p.company_id=ctx.company_id AND p.is_active AND p.status<>'CANCELLED' AND (ctx.projects IS NULL OR p.id=ANY(ctx.projects))
      AND ((p.contract_value_cents IS NOT NULL AND p.contract_value_cents + coalesce((SELECT sum(a.amount_cents) FROM public.project_amendments a WHERE a.company_id=p.company_id AND a.project_id=p.id AND a.status='APPROVED'),0)
      < coalesce((SELECT sum(e.amount_cents) FROM public.cost_entries e WHERE e.company_id=p.company_id AND e.project_id=p.id AND e.status='POSTED'),0))
      OR ((SELECT sum(b.amount_cents) FROM public.project_budget_lines b WHERE b.company_id=p.company_id AND b.project_id=p.id AND b.revision=(SELECT max(b2.revision) FROM public.project_budget_lines b2 WHERE b2.company_id=p.company_id AND b2.project_id=p.id)) > 0
      AND (SELECT sum(e.amount_cents) FROM public.cost_entries e WHERE e.company_id=p.company_id AND e.project_id=p.id AND e.status='POSTED') >= (SELECT sum(b.amount_cents) FROM public.project_budget_lines b WHERE b.company_id=p.company_id AND b.project_id=p.id AND b.revision=(SELECT max(b2.revision) FROM public.project_budget_lines b2 WHERE b2.company_id=p.company_id AND b2.project_id=p.id))))`},
  {role:"OWNER",key:"prohibitions",href:"/ured/akcije?key=prohibitions",priority:0,sql:`SELECT count(*)::int AS n FROM public.hse_inspections i,ctx WHERE i.company_id=ctx.company_id AND i.result='PROHIBITION' AND i.prohibition_lifted_at IS NULL AND (ctx.projects IS NULL OR i.project_id=ANY(ctx.projects))`},
  {role:"OWNER",key:"expired_obligations",href:"/ured/akcije?key=expired_obligations",priority:1,sql:`SELECT count(*)::int AS n FROM public.obligations o,ctx WHERE o.company_id=ctx.company_id AND o.superseded_by IS NULL AND o.expires_at<ctx.today AND (ctx.projects IS NULL OR o.project_id=ANY(ctx.projects))`},
  {role:"OWNER",key:"purchases_for_approval",href:"/ured/akcije?key=purchases_for_approval",priority:2,sql:`SELECT count(*)::int AS n FROM public.purchase_requests r,ctx WHERE r.company_id=ctx.company_id AND r.status='SUBMITTED' AND (ctx.projects IS NULL OR r.project_id=ANY(ctx.projects))`},
  {role:"OWNER",key:"expiring_guarantees",href:"/ured/akcije?key=expiring_guarantees",priority:1,global:true,sql:`SELECT count(*)::int AS n FROM public.tender_checklist_items g,ctx WHERE g.company_id=ctx.company_id AND g.guarantee_type IS NOT NULL AND g.returned_at IS NULL AND g.valid_until BETWEEN ctx.today AND ctx.today+30`},
  {role:"OWNER",key:"subcontractor_statements",href:"/ured/akcije?key=subcontractor_statements",priority:2,sql:`SELECT count(*)::int AS n FROM public.subcontractor_statements s JOIN public.subcontractor_contracts c ON c.company_id=s.company_id AND c.id=s.contract_id,ctx WHERE s.company_id=ctx.company_id AND s.status='SUBMITTED' AND (ctx.projects IS NULL OR c.project_id=ANY(ctx.projects))`},
  {role:"PROJECT_MANAGER",key:"overdue_tasks",href:"/ured/zadaci?filter=kasni",priority:1,sql:`SELECT count(*)::int AS n FROM public.project_tasks t,ctx WHERE t.company_id=ctx.company_id AND t.status IN ('OPEN','IN_PROGRESS','BLOCKED') AND t.due_on<ctx.today AND t.project_id=ANY(ctx.projects)`},
  {role:"PROJECT_MANAGER",key:"unconfirmed_days",href:"/ured/radni-dani?filter=bez-potvrde&iz=dashboard",priority:2,sql:`SELECT count(*)::int AS n FROM public.workdays d,ctx WHERE d.company_id=ctx.company_id AND d.status='SUBMITTED' AND d.approval_status='SUBMITTED' AND EXISTS (SELECT 1 FROM public.work_entries e WHERE e.company_id=d.company_id AND e.workday_id=d.id AND e.project_id=ANY(ctx.projects))
    AND ${sharedWorkdayAssignment("(SELECT w.id FROM public.workers w WHERE w.company_id=d.company_id AND w.user_id=ctx.uid AND w.is_active ORDER BY w.id LIMIT 1)")}`},
  {role:"PROJECT_MANAGER",key:"tender_deadlines",href:"/ured/tenderi?filter=rokovi",priority:1,global:true,sql:`SELECT count(*)::int AS n FROM public.tenders t,ctx WHERE t.company_id=ctx.company_id AND t.status IN ('OPPORTUNITY','GO_NO_GO','PREPARATION') AND t.deadline_at >= clock_timestamp() AND t.deadline_at < clock_timestamp()+interval '14 days'`},
  {role:"SITE_SUPERVISOR",key:"open_tasks",href:"/ured/zadaci?filter=otvoreni",priority:2,sql:`SELECT count(*)::int AS n FROM public.project_tasks t,ctx WHERE t.company_id=ctx.company_id AND t.status IN ('OPEN','IN_PROGRESS','BLOCKED') AND t.project_id=ANY(ctx.projects)`},
  {role:"SITE_SUPERVISOR",key:"open_machine_faults",href:"/ured/kvarovi?filter=otvoreni",priority:2,sql:`SELECT count(*)::int AS n FROM public.machine_faults f,ctx WHERE f.company_id=ctx.company_id AND f.status NOT IN ('DONE','CANCELLED') AND f.project_id=ANY(ctx.projects)`},
  {role:"SITE_SUPERVISOR",key:"unsigned_diaries",href:"/ured/akcije?key=unsigned_diaries",priority:2,sql:`SELECT count(*)::int AS n FROM public.site_diaries d,ctx WHERE d.company_id=ctx.company_id AND d.status='DRAFT' AND d.project_id=ANY(ctx.projects)`},
  {role:"SITE_SUPERVISOR",key:"overdue_hse_actions",href:"/ured/akcije?key=overdue_hse_actions",priority:1,sql:`SELECT count(*)::int AS n FROM public.hse_actions a LEFT JOIN public.hse_incidents i ON i.company_id=a.company_id AND i.id=a.incident_id LEFT JOIN public.hse_inspections insp ON insp.company_id=a.company_id AND insp.id=a.inspection_id,ctx WHERE a.company_id=ctx.company_id AND a.status='OPEN' AND a.due_on<ctx.today AND coalesce(i.project_id,insp.project_id)=ANY(ctx.projects)`},
  {role:"ACCOUNTANT",key:"payroll_periods",href:"/ured/akcije?key=payroll_periods",priority:2,global:true,sql:`SELECT count(*)::int AS n FROM public.pay_periods p,ctx WHERE p.company_id=ctx.company_id AND p.status IN ('OPEN','CALCULATED')`},
  {role:"ACCOUNTANT",key:"costs_for_approval",href:"/ured/akcije?key=costs_for_approval",priority:1,sql:`SELECT count(*)::int AS n FROM public.manual_cost_requests r,ctx WHERE r.company_id=ctx.company_id AND r.status='PENDING' AND (ctx.projects IS NULL OR r.project_id=ANY(ctx.projects))`},
  {role:"ACCOUNTANT",key:"disputed_invoices",href:"/ured/akcije?key=disputed_invoices",priority:1,sql:`SELECT count(*)::int AS n FROM public.purchase_invoices i,ctx WHERE i.company_id=ctx.company_id AND i.status='DISPUTED' AND (ctx.projects IS NULL OR i.project_id=ANY(ctx.projects))`},
  {role:"ACCOUNTANT",key:"pending_costs",href:"/ured/akcije?key=pending_costs",priority:2,sql:`SELECT count(*)::int AS n FROM public.cost_entries e,ctx WHERE e.company_id=ctx.company_id AND e.status='PENDING' AND (ctx.projects IS NULL OR e.project_id=ANY(ctx.projects))`},
  {role:"ACCOUNTANT",key:"workers_without_rate",href:"/ured/akcije?key=workers_without_rate",priority:2,global:true,sql:`SELECT count(*)::int AS n FROM public.workers w,ctx WHERE w.company_id=ctx.company_id AND w.is_active AND NOT EXISTS (SELECT 1 FROM public.worker_rates r WHERE r.company_id=w.company_id AND r.worker_id=w.id AND r.rate_kind='HOURLY' AND r.valid_from<=ctx.today AND (r.valid_to IS NULL OR r.valid_to>=ctx.today))`},
  {role:"MECHANIC",key:"my_orders",href:"/ured/servis?filter=moji",priority:2,sql:`SELECT count(*)::int AS n FROM public.service_orders s,ctx WHERE s.company_id=ctx.company_id AND s.status IN ('PLANNED','APPROVED','IN_PROGRESS') AND s.assigned_mechanic_worker_id IN (SELECT w.id FROM public.workers w WHERE w.company_id=s.company_id AND w.user_id=ctx.uid AND w.is_active) AND (ctx.projects IS NULL OR s.project_id=ANY(ctx.projects) OR ctx.self_scope)`},
  {role:"MECHANIC",key:"waiting_parts",href:"/ured/servis?filter=dijelovi",priority:1,sql:`SELECT count(*)::int AS n FROM public.service_orders s,ctx WHERE s.company_id=ctx.company_id AND s.status='WAITING_PARTS' AND s.assigned_mechanic_worker_id IN (SELECT w.id FROM public.workers w WHERE w.company_id=s.company_id AND w.user_id=ctx.uid AND w.is_active) AND (ctx.projects IS NULL OR s.project_id=ANY(ctx.projects) OR ctx.self_scope)`},
];

export async function loadDashboardActions(pool: Pool, actor: DashboardActor) {
  const roles = new Set(actor.roles.map(role => role === "ADMIN" ? "OWNER" : role));
  if (!DASHBOARD_ACTIONS.some(def => roles.has(def.role))) return null;
  return withCompany(pool, companyId(actor.companyId), async client => {
    const scopeIds = actor.scope === "COMPANY" ? null : actor.scope === "PROJECTS" ? [...(actor.projectIds ?? [])] : [];
    // PM and site cards are about assigned projects even when membership has company scope.
    const assigned = roles.has("PROJECT_MANAGER") || roles.has("SITE_SUPERVISOR")
      ? await dashboardAssignedProjects(client, actor) : scopeIds ?? [];
    const items: Array<{key:string;role:DashboardRole;count:number;href:string;priority:number}> = [];
    for (const def of DASHBOARD_ACTIONS) {
      if (!roles.has(def.role) || (def.global && actor.scope !== "COMPANY")) continue;
      const ids = def.role === "PROJECT_MANAGER" || def.role === "SITE_SUPERVISOR" ? assigned : scopeIds;
      const result = await client.query<{n:number}>(`WITH ctx AS (SELECT c.id AS company_id,$2::text[] AS projects,$3::text AS uid,
        $4::boolean AS self_scope,(clock_timestamp() AT TIME ZONE c.timezone)::date AS today FROM public.companies c WHERE c.id=$1) ${def.sql}`,
      [actor.companyId,ids,actor.userId,actor.scope === "SELF"]);
      const count=result.rows[0]?.n ?? 0;
      if(count>0) items.push({key:def.key,role:def.role,count,href:def.href,priority:def.priority});
    }
    if (roles.has("MECHANIC")) {
      const count = (await dashboardDuePlans(client, actor)).length;
      if (count) items.push({key:"preventive_due",role:"MECHANIC",count,href:"/ured/akcije?key=preventive_due",priority:1});
    }
    items.sort((a,b)=>a.priority-b.priority || a.key.localeCompare(b.key));
    const projectFinancials = await dashboardProjectDetails(client,actor,assigned);
    const topMachines = await dashboardTopMachines(client,actor,scopeIds);
    return {checkedAt:new Date().toISOString(),items,projectFinancials,topMachines};
  });
}
