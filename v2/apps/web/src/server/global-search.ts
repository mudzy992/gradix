/** Read-only search. The tenant and project scope come exclusively from the authenticated session. */
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import type { DashboardActor } from "./dashboard-aggregates";
import { can } from "./permissions";
import { equipmentScope } from "./equipment-scope";

export type SearchHit = { type: "PROJECT" | "WORKER" | "MACHINE" | "PARTNER" | "TENDER" | "DOCUMENT" | "INVOICE" | "TASK" | "OBLIGATION" | "SERVICE_ORDER" | "INCIDENT"; title: string; href: string };
export async function globalSearch(pool: Pool, actor: DashboardActor, q: string): Promise<SearchHit[]> {
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    let ids = actor.scope === "COMPANY" ? null : actor.scope === "PROJECTS" ? [...(actor.projectIds ?? [])] : [];
    if (actor.scope === "SELF") {
      const assigned=await client.query<{project_id:string}>(`SELECT DISTINCT a.project_id FROM public.project_assignments a
        JOIN public.workers w ON w.company_id=a.company_id AND w.id=a.worker_id
        JOIN public.companies c ON c.id=a.company_id WHERE a.company_id=$1 AND w.user_id=$2 AND w.is_active
        AND a.voided_at IS NULL AND a.from_date<=(clock_timestamp() AT TIME ZONE c.timezone)::date
        AND (a.to_date IS NULL OR a.to_date>=(clock_timestamp() AT TIME ZONE c.timezone)::date)`,[actor.companyId,actor.userId]);
      ids=assigned.rows.map(x=>x.project_id);
    }
    const results: SearchHit[]=[];
    if (can(actor.roles,"projects.view")) {
      const rows=await client.query<{id:string;code:string;name:string}>(`SELECT p.id,p.code,p.name FROM public.projects p
        WHERE p.company_id=$1 AND p.is_active AND ($2::text[] IS NULL OR p.id=ANY($2::text[]))
        AND (p.name ILIKE $3 OR p.code ILIKE $3) ORDER BY p.name,p.id LIMIT 8`,[actor.companyId,ids,pattern]);
      results.push(...rows.rows.map(r=>({type:"PROJECT" as const,title:`${r.code} — ${r.name}`,href:actor.scope === "SELF" ? "/ured/projekti" : `/ured/projekti/${encodeURIComponent(r.id)}`})));
    }
    if (can(actor.roles,"workers.view")) {
      const rows=await client.query<{id:string;name:string}>(`SELECT w.id,w.first_name||' '||w.last_name AS name FROM public.workers w
        WHERE w.company_id=$1 AND w.is_active AND (w.first_name ILIKE $3 OR w.last_name ILIKE $3 OR (w.first_name||' '||w.last_name) ILIKE $3)
        AND ($2::text[] IS NULL OR ($4::boolean AND w.user_id=$5) OR (NOT $4::boolean AND EXISTS (
          SELECT 1 FROM public.project_assignments a JOIN public.companies c ON c.id=a.company_id
          WHERE a.company_id=w.company_id AND a.worker_id=w.id AND a.project_id=ANY($2::text[]) AND a.voided_at IS NULL
          AND a.from_date<=(clock_timestamp() AT TIME ZONE c.timezone)::date
          AND (a.to_date IS NULL OR a.to_date>=(clock_timestamp() AT TIME ZONE c.timezone)::date))))
        ORDER BY w.first_name,w.last_name,w.id LIMIT 8`,[actor.companyId,ids,pattern,actor.scope === "SELF",actor.userId]);
      results.push(...rows.rows.map(r=>({type:"WORKER" as const,title:r.name,href:`/ured/radnici/${encodeURIComponent(r.id)}`})));
    }
    if (can(actor.roles,"equipment.view")) {
      const rows=await client.query<{id:string;code:string;name:string}>(`SELECT m.id,m.code,m.name FROM public.machines m
        WHERE m.company_id=$1 AND m.is_active AND (m.name ILIKE $3 OR m.code ILIKE $3)
        AND ($2::text[] IS NULL OR (NOT $4::boolean AND EXISTS (SELECT 1 FROM public.project_assignments a
          JOIN public.companies c ON c.id=a.company_id WHERE a.company_id=m.company_id AND a.machine_id=m.id
          AND a.project_id=ANY($2::text[]) AND a.voided_at IS NULL AND a.from_date<=(clock_timestamp() AT TIME ZONE c.timezone)::date
          AND (a.to_date IS NULL OR a.to_date>=(clock_timestamp() AT TIME ZONE c.timezone)::date))))
        ORDER BY m.name,m.id LIMIT 8`,[actor.companyId,ids,pattern,actor.scope === "SELF"]);
      results.push(...rows.rows.map(r=>({type:"MACHINE" as const,title:`${r.code} — ${r.name}`,
        href:can(actor.roles,"service.view") ? `/ured/masine/${encodeURIComponent(r.id)}` : "/ured/masine"})));
    }
    if (actor.scope === "COMPANY" && can(actor.roles,"partners.view")) {
      const rows=await client.query<{code:string;name:string}>(`SELECT code,name FROM public.partners WHERE company_id=$1
        AND active AND (code ILIKE $2 OR name ILIKE $2) ORDER BY name,id LIMIT 8`,[actor.companyId,pattern]);
      results.push(...rows.rows.map(r=>({type:"PARTNER" as const,title:`${r.code} — ${r.name}`,href:"/ured/partneri"})));
    }
    if (actor.scope === "COMPANY" && can(actor.roles,"tenders.view")) {
      const rows=await client.query<{id:string;title:string}>(`SELECT id,title FROM public.tenders WHERE company_id=$1
        AND title ILIKE $2 ORDER BY title,id LIMIT 8`,[actor.companyId,pattern]);
      results.push(...rows.rows.map(r=>({type:"TENDER" as const,title:r.title,href:`/ured/tenderi/${encodeURIComponent(r.id)}`})));
    }
    if (can(actor.roles,"purchase.view") && actor.scope !== "SELF") {
      const rows=await client.query<{invoice_number:string}>(`SELECT invoice_number FROM public.purchase_invoices
        WHERE company_id=$1 AND ($2::text[] IS NULL OR project_id=ANY($2::text[])) AND invoice_number ILIKE $3
        ORDER BY invoice_number,id LIMIT 8`,[actor.companyId,ids,pattern]);
      results.push(...rows.rows.map(r=>({type:"INVOICE" as const,title:r.invoice_number,href:"/ured/nabavka"})));
    }
    if (can(actor.roles,"projects.costs.view") && actor.scope !== "SELF") {
      const rows=await client.query<{file_name:string;entity_id:string}>(`SELECT a.file_name,a.entity_id FROM public.attachments a
        JOIN public.projects p ON p.company_id=a.company_id AND p.id=a.entity_id
        WHERE a.company_id=$1 AND a.entity_type='PROJECT' AND a.status='ready' AND a.file_name ILIKE $3
        AND ($2::text[] IS NULL OR p.id=ANY($2::text[])) ORDER BY a.file_name,a.id LIMIT 8`,[actor.companyId,ids,pattern]);
      results.push(...rows.rows.map(r=>({type:"DOCUMENT" as const,title:r.file_name,href:`/ured/projekti/${encodeURIComponent(r.entity_id)}`})));
    }
    if (can(actor.roles,"projects.view") && actor.scope !== "SELF") {
      const rows=await client.query<{title:string}>(`SELECT t.title FROM public.project_tasks t
        WHERE t.company_id=$1 AND ($2::text[] IS NULL OR t.project_id=ANY($2::text[]))
          AND t.title ILIKE $3 ORDER BY t.title,t.id LIMIT 8`,[actor.companyId,ids,pattern]);
      results.push(...rows.rows.map(r=>({type:"TASK" as const,title:r.title,href:"/ured/zadaci"})));
    }
    if (can(actor.roles,"obligations.view")) {
      const rows=await client.query<{label:string}>(`SELECT t.label FROM public.obligations o
        JOIN public.obligation_types t ON t.company_id=o.company_id AND t.id=o.type_id
        WHERE o.company_id=$1 AND o.superseded_by IS NULL AND t.label ILIKE $3
        AND ($2::text[] IS NULL OR (NOT $4::boolean AND o.project_id=ANY($2::text[])) OR ($4::boolean AND EXISTS (
          SELECT 1 FROM public.workers w WHERE w.company_id=o.company_id AND w.id=o.worker_id AND w.user_id=$5)))
        ORDER BY t.label,o.id LIMIT 8`,[actor.companyId,ids,pattern,actor.scope === "SELF",actor.userId]);
      results.push(...rows.rows.map(r=>({type:"OBLIGATION" as const,title:r.label,href:"/ured/rokovi"})));
    }
    if (can(actor.roles,"service.view")) {
      const orderParams: unknown[] = [actor.companyId,pattern];
      const orderScope = equipmentScope(actor,orderParams,"s","order");
      const rows=await client.query<{id:string;description:string}>(`SELECT s.id,s.description FROM public.service_orders s
        WHERE s.company_id=$1 AND s.description ILIKE $2 AND ${orderScope}
        ORDER BY s.opened_at DESC,s.id LIMIT 8`,orderParams);
      results.push(...rows.rows.map(r=>({type:"SERVICE_ORDER" as const,title:r.description,href:`/ured/servis/${encodeURIComponent(r.id)}`})));
    }
    if (can(actor.roles,"hse.view")) {
      const rows=await client.query<{id:string;kind:string}>(`SELECT i.id,i.kind FROM public.hse_incidents i
        WHERE i.company_id=$1 AND i.kind ILIKE $3 AND ($2::text[] IS NULL OR
          (NOT $4::boolean AND i.project_id=ANY($2::text[])) OR ($4::boolean AND i.reporter_user_id=$5))
        ORDER BY i.occurred_at DESC,i.id LIMIT 8`,[actor.companyId,ids,pattern,actor.scope === "SELF",actor.userId]);
      results.push(...rows.rows.map(r=>({type:"INCIDENT" as const,title:`Incident — ${r.kind}`,href:`/ured/hse/${encodeURIComponent(r.id)}`})));
    }
    return results;
  });
}
