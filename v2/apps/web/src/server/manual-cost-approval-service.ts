import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { isCurrency } from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { postCost } from "./cost-entry-service";
import { canUsePurchaseProject, type PurchaseActor } from "./purchase-request-service";
import type { WarehouseResult } from "./warehouse-service";

type Row={id:string;project_id:string;phase_id:string|null;category_id:string;occurred_on:string;amount_cents:string;currency_code:string;quantity:string|null;unit:string|null;note:string|null;attachment_id:string|null;status:string;cost_entry_id:string|null;client_generated_id:string};
export async function decideManualCost(pool:Pool,actor:PurchaseActor,id:string,decision:"approve"|"reject",reason?:string):Promise<WarehouseResult<{id:string;status:string;costEntryId:string|null}>> {
  if(!can(actor.roles,"purchase.approve")) return {outcome:"FORBIDDEN",message:"Samo vlasnik ili administrator odobrava trošak iznad praga."};
  if(decision==='reject' && (!reason || reason.trim().length<10)) return {outcome:"VALIDATION_FAILED",message:"Razlog odbijanja mora imati najmanje 10 znakova."};
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const result=await client.query<Row>(`SELECT id,project_id,phase_id,category_id,occurred_on::text,amount_cents::text,currency_code,quantity::text,unit,note,attachment_id,status,cost_entry_id,client_generated_id::text
      FROM public.manual_cost_requests WHERE company_id=$1 AND id=$2 FOR UPDATE`,[actor.companyId,id]);
    const row=result.rows[0];
    if(!row || !canUsePurchaseProject(actor,row.project_id)) return {outcome:"NOT_FOUND",message:"Zahtjev ručnog troška ne postoji."};
    if(row.status==="APPROVED" && decision==='approve') return {outcome:"OK",data:{id,status:row.status,costEntryId:row.cost_entry_id}};
    if(row.status==="REJECTED" && decision==='reject') return {outcome:"OK",data:{id,status:row.status,costEntryId:null}};
    if(row.status!=="PENDING") return {outcome:"CONFLICT",message:"Zahtjev je već obrađen."};
    const approval=await client.query("SELECT id FROM public.approval_requests WHERE company_id=$1 AND subject_type='purchase' AND subject_id=$2 AND status='OPEN' FOR UPDATE",[actor.companyId,id]);
    if(!approval.rowCount) return {outcome:"CONFLICT",message:"Zahtjev ne čeka odobrenje."};
    let costEntryId:string|null=null;
    if(decision==='approve') {
      if(!isCurrency(row.currency_code)) return {outcome:"VALIDATION_FAILED",message:"Valuta nije podržana."};
      const posted=await postCost(client,{companyId:actor.companyId,projectId:row.project_id,phaseId:row.phase_id,categoryId:row.category_id,sourceType:"MANUAL",sourceId:id,
        occurredOn:row.occurred_on,amountCents:BigInt(row.amount_cents),currency:row.currency_code,quantity:row.quantity===null ? null : Number(row.quantity),
        unit:row.unit,note:row.note,rateSnapshot:row.attachment_id ? {attachment_id:row.attachment_id} : null,actorId:actor.userId,clientGeneratedId:row.client_generated_id});
      costEntryId=posted.id;
    }
    const status=decision==='approve' ? 'APPROVED' : 'REJECTED';
    await client.query("UPDATE public.manual_cost_requests SET status=$3,cost_entry_id=$4,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id,status,costEntryId]);
    await client.query(`UPDATE public.approval_requests SET status=$3,decided_by=$4,decided_at=clock_timestamp(),reason=$5,updated_at=clock_timestamp()
      WHERE company_id=$1 AND subject_type='purchase' AND subject_id=$2 AND status='OPEN'`,[actor.companyId,id,status,actor.userId,decision==='reject' ? reason!.trim() : null]);
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:decision==='approve' ? "manual_cost.approved" : "manual_cost.rejected",entityType:"manual_cost_request",entityId:id,retentionClass:"FINANCIAL",metadata:{costEntryId,reason:reason ?? null}});
    return {outcome:"OK",data:{id,status,costEntryId}};
  });
}
