import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import type { DashboardActor } from "./dashboard-aggregates";
import { DASHBOARD_ACTIONS } from "./dashboard-actions";
import { dashboardAssignedProjects } from "./dashboard-scope";
import { dashboardDuePlans } from "./dashboard-maintenance";
import { can } from "./permissions";

/** SQL fragments are static allowlisted code, never supplied by the browser. */
const views: Record<string, { title:string; select:string; order:string; destination:(id:string)=>string }> = {
  risky_projects:{title:"Rizični projekti",select:"p.id, p.code || ' · ' || p.name AS label, p.id AS target",order:"p.id",destination:id=>`/ured/projekti/${encodeURIComponent(id)}`},
  prohibitions:{title:"Aktivne HSE zabrane",select:"i.id, coalesce(i.summary,i.kind) AS label, i.id AS target",order:"i.id",destination:()=>"/ured/hse/inspekcije"},
  expired_obligations:{title:"Istekli rokovi",select:"o.id, coalesce(o.number,o.id) || ' · ' || o.expires_at::text AS label, o.id AS target",order:"o.id",destination:()=>"/ured/rokovi?stanje=isteklo"},
  purchases_for_approval:{title:"Nabavke za odobrenje",select:"r.id, r.justification AS label, r.id AS target",order:"r.id",destination:()=>"/ured/nabavka"},
  expiring_guarantees:{title:"Garancije koje ističu",select:"g.id, g.label || ' · ' || g.valid_until::text AS label, g.tender_id AS target",order:"g.id",destination:id=>`/ured/tenderi/${encodeURIComponent(id)}`},
  subcontractor_statements:{title:"Situacije podizvođača za odobrenje",select:"s.id, s.statement_no AS label, s.id AS target",order:"s.id",destination:()=>"/ured/podizvodjaci"},
  unsigned_diaries:{title:"Dnevnici bez potpisa",select:"d.id, d.diary_date::text AS label, d.id AS target",order:"d.id",destination:id=>`/ured/dnevnik/${encodeURIComponent(id)}`},
  overdue_hse_actions:{title:"HSE mjere koje kasne",select:"a.id, a.description || ' · ' || a.due_on::text AS label, coalesce(a.incident_id,'') AS target",order:"a.id",destination:id=>id ? `/ured/hse/${encodeURIComponent(id)}` : "/ured/hse/inspekcije"},
  payroll_periods:{title:"Periodi obračuna",select:"p.id, p.year::text || '-' || lpad(p.month::text,2,'0') || ' · ' || p.status AS label, p.id AS target",order:"p.id",destination:id=>`/ured/obracun-sati/${encodeURIComponent(id)}`},
  costs_for_approval:{title:"Troškovi za odobrenje",select:"r.id, coalesce(r.note,r.id) AS label, r.project_id AS target",order:"r.id",destination:id=>`/ured/projekti/${encodeURIComponent(id)}?tab=costs`},
  disputed_invoices:{title:"Računi u neslaganju",select:"i.id, i.invoice_number AS label, i.id AS target",order:"i.id",destination:()=>"/ured/nabavka"},
  pending_costs:{title:"Troškovi bez cijene",select:"e.id, e.source_type || ' · ' || e.occurred_on::text AS label, e.project_id AS target",order:"e.id",destination:id=>`/ured/projekti/${encodeURIComponent(id)}?tab=costs&status=PENDING`},
  workers_without_rate:{title:"Radnici bez satnice",select:"w.id, w.first_name || ' ' || w.last_name AS label, w.id AS target",order:"w.id",destination:()=>"/ured/obracun-sati"},
};
export type ActionList = {title:string; items:{id:string;label:string;href:string}[]; page:number; hasNext:boolean};
const pageSize=100;

/** The count and rows share the exact same FROM/WHERE, tenant, role and project scope. */
export async function loadDashboardActionList(pool:Pool, actor:DashboardActor, key:string, requestedPage:number):Promise<ActionList | null> {
  if (!can(actor.roles,"dashboard.actions.view")) return null;
  const page=Number.isSafeInteger(requestedPage) ? Math.min(10000,Math.max(1,requestedPage)) : 1;
  const roles=new Set(actor.roles.map(role=>role === "ADMIN" ? "OWNER" : role));
  if (key === "preventive_due") {
    if (!roles.has("MECHANIC")) return null;
    return withCompany(pool,companyId(actor.companyId),async client=>{
      const all=(await dashboardDuePlans(client,actor)).sort((a,b)=>a.plan_id.localeCompare(b.plan_id));
      const selected=all.slice((page-1)*pageSize,page*pageSize+1);
      return {title:"Preventivni servisi",page,hasNext:selected.length>pageSize,items:selected.slice(0,pageSize).map(plan=>({
        id:plan.plan_id,label:`${plan.machine_name} · ${plan.name} · ${plan.planned_for}`,
        href:plan.open_order_id ? `/ured/servis/${encodeURIComponent(plan.open_order_id)}` : `/ured/servis/planovi?machine=${encodeURIComponent(plan.machine_id)}`,
      }))};
    });
  }
  const view=views[key], def=DASHBOARD_ACTIONS.find(item=>item.key===key);
  if (!view || !def || !roles.has(def.role) || (def.global && actor.scope !== "COMPANY")) return null;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const scopeIds=actor.scope === "COMPANY" ? null : actor.scope === "PROJECTS" ? [...(actor.projectIds ?? [])] : [];
    const projects=def.role === "PROJECT_MANAGER" || def.role === "SITE_SUPERVISOR" ? await dashboardAssignedProjects(client,actor) : scopeIds;
    const query=def.sql.replace("SELECT count(*)::int AS n",`SELECT ${view.select}`);
    if (query === def.sql) throw new Error("DASHBOARD_ACTION_QUERY_MISMATCH");
    const result=await client.query<{id:string;label:string;target:string}>(`WITH ctx AS (SELECT c.id AS company_id,$2::text[] AS projects,$3::text AS uid,
      $4::boolean AS self_scope,(clock_timestamp() AT TIME ZONE c.timezone)::date AS today FROM public.companies c WHERE c.id=$1)
      ${query} ORDER BY ${view.order} LIMIT $5 OFFSET $6`,[actor.companyId,projects,actor.userId,actor.scope === "SELF",pageSize+1,(page-1)*pageSize]);
    return {title:view.title,page,hasNext:result.rows.length>pageSize,items:result.rows.slice(0,pageSize).map(row=>({id:row.id,label:row.label,href:view.destination(row.target)}))};
  });
}
