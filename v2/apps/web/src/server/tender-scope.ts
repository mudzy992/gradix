import type { PoolClient } from "pg";
import type { Scope } from "@gradix/domain";
import { obligationTargetAllowed } from "./obligation-scope";

export type TenderScopeActor = { userId:string; companyId:string; scope:Scope; projectIds:readonly string[] | null };

/** PROJECTS is limited to converted projects and a live, active assignment. */
export function tenderScope(actor:TenderScopeActor, params:unknown[], alias:string):string {
  if (actor.scope === "COMPANY") return "TRUE";
  if (actor.scope !== "PROJECTS") return "FALSE";
  params.push(actor.projectIds ?? [],actor.userId);
  const projects=`$${params.length-1}`, user=`$${params.length}`;
  return `(${alias}.converted_project_id=ANY(${projects}::text[]) AND EXISTS (
    SELECT 1 FROM public.project_assignments pa
    JOIN public.workers w ON w.company_id=pa.company_id AND w.id=pa.worker_id
    JOIN public.companies c ON c.id=pa.company_id
    WHERE pa.company_id=${alias}.company_id AND pa.project_id=${alias}.converted_project_id
      AND w.user_id=${user} AND w.is_active AND pa.voided_at IS NULL
      AND pa.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
      AND (pa.to_date IS NULL OR pa.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)))`;
}

/** Lock source and live authorization in the same tenant transaction as the operation. */
export async function tenderRecordAllowed(client:PoolClient, actor:TenderScopeActor, id:string, write=false):Promise<boolean> {
  if (actor.scope === "COMPANY") return true;
  if (actor.scope !== "PROJECTS") return false;
  const rows=await client.query<{converted_project_id:string|null}>(`SELECT converted_project_id FROM public.tenders
    WHERE company_id=$1 AND id=$2 FOR ${write ? "UPDATE" : "SHARE"}`, [actor.companyId,id]);
  const row=rows.rows[0];
  if (!row) return false;
  return !!row.converted_project_id && obligationTargetAllowed(client,actor.companyId,actor,{projectId:row.converted_project_id});
}

export function tenderDenied(actor:TenderScopeActor) {
  void actor;
  return {ok:false as const,outcome:"FORBIDDEN" as const,code:"FORBIDDEN" as const,message:"Tender nije dostupan u vašem opsegu."};
}
