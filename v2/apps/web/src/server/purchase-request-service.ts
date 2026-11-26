import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { canApprovePurchase, purchaseNeedsApproval, toThousandths } from "@gradix/domain";
import type { PurchaseRequestInput, PurchaseRequestPatchInput } from "@gradix/contracts";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import type { WarehouseResult } from "./warehouse-service";

export type PurchaseActor = { companyId: string; userId: string; roles: readonly string[]; scope: "COMPANY" | "PROJECTS" | "SELF"; projectIds: string[] | null };
export function canUsePurchaseProject(actor: PurchaseActor, projectId: string | null): boolean {
  return actor.scope === "COMPANY" || (actor.scope === "PROJECTS" && projectId !== null && (actor.projectIds ?? []).includes(projectId));
}
const uid = (p: string) => `${p}_${randomUUID().replace(/-/g, "")}`;
const denied = {outcome:"FORBIDDEN",message:"Nemate pravo upravljanja nabavkom."} as const;
const missing = {outcome:"NOT_FOUND",message:"Zahtjev ne postoji."} as const;
const fields = "id,project_id,phase_id,requested_by_worker_id,needed_by::text,justification,status,total_estimated_cents::text,currency_code,created_by,created_at::text";

type Header = { id:string; project_id:string|null; status:string; total_estimated_cents:string; currency_code:string; approval_threshold_cents:string|null };
async function header(client:PoolClient, actor:PurchaseActor, id:string, lock=false):Promise<Header | null> {
  const result=await client.query<Header>(`SELECT id,project_id,status,total_estimated_cents::text,currency_code,approval_threshold_cents::text
    FROM public.purchase_requests WHERE company_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`, [actor.companyId,id]);
  const row=result.rows[0]; return row && canUsePurchaseProject(actor,row.project_id) ? row : null;
}
async function audit(client:PoolClient, actor:PurchaseActor, id:string, action:"purchase.request_created" | "purchase.request_updated" | "purchase.request_submitted" | "purchase.request_approved" | "purchase.request_rejected", metadata:Record<string,unknown> = {}):Promise<void> {
  await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action,entityType:"purchase_request",entityId:id,retentionClass:"FINANCIAL",metadata});
}
export async function listPurchaseRequests(pool:Pool,actor:PurchaseActor):Promise<WarehouseResult<unknown[]>> {
  if (!can(actor.roles,"purchase.view")) return denied;
  return withCompany(pool,companyId(actor.companyId),async (client) => {
    const rows=await client.query(`SELECT ${fields} FROM public.purchase_requests WHERE company_id=$1
      AND ($2::boolean OR project_id=ANY($3::text[])) ORDER BY created_at DESC,id LIMIT 500`,
    [actor.companyId,actor.scope==="COMPANY",actor.scope==="PROJECTS" ? actor.projectIds ?? [] : []]);
    return {outcome:"OK",data:rows.rows};
  });
}
export async function getPurchaseRequest(pool:Pool,actor:PurchaseActor,id:string):Promise<WarehouseResult<{request:unknown;items:unknown[]}>> {
  if (!can(actor.roles,"purchase.view")) return denied;
  return withCompany(pool,companyId(actor.companyId),async (client) => {
    const visible=await header(client,actor,id); if (!visible) return missing;
    const request=await client.query(`SELECT ${fields} FROM public.purchase_requests WHERE company_id=$1 AND id=$2`,[actor.companyId,id]);
    const items=await client.query(`SELECT id,item_id,description,unit,quantity::text,estimated_unit_price_cents::text
      FROM public.purchase_request_items WHERE company_id=$1 AND request_id=$2 ORDER BY id`,[actor.companyId,id]);
    return {outcome:"OK",data:{request:request.rows[0],items:items.rows}};
  });
}
export async function createPurchaseRequest(pool:Pool,actor:PurchaseActor,input:PurchaseRequestInput):Promise<WarehouseResult<{id:string}>> {
  if (!can(actor.roles,"purchase.manage")) return denied;
  const project=input.projectId ?? null;
  if (!canUsePurchaseProject(actor,project)) return denied;
  if (!input.justification.trim() || (input.phaseId && !project) || input.items.some((i)=>!i.description.trim() || !i.unit.trim() || toThousandths(i.quantity)<=0n)) {
    return {outcome:"VALIDATION_FAILED",message:"Neispravne stavke, faza ili obrazloženje."};
  }
  const total=input.items.reduce((sum,item)=>sum+(toThousandths(item.quantity)*BigInt(item.estimatedUnitPriceCents)+500n)/1000n,0n);
  if (total>9223372036854775807n) return {outcome:"VALIDATION_FAILED",message:"Vrijednost prelazi dozvoljeni opseg."};
  const hash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return withCompany(pool,companyId(actor.companyId),async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('purchase-request:' || $1 || ':' || $2,0))",[actor.companyId,input.clientGeneratedId]);
    const existing=await client.query<{id:string;project_id:string|null;request_hash:string}>("SELECT id,project_id,request_hash FROM public.purchase_requests WHERE company_id=$1 AND client_generated_id=$2",[actor.companyId,input.clientGeneratedId]);
    if(existing.rows[0]) {
      if(!canUsePurchaseProject(actor,existing.rows[0].project_id)) return denied;
      if(existing.rows[0].request_hash!==hash) return {outcome:"CONFLICT",message:"Identifikator je već korišten za drugačiji zahtjev."};
      return {outcome:"OK",data:{id:existing.rows[0].id}};
    }
    const valid=await client.query<{ok:boolean}>(`SELECT
      ($2::text IS NULL OR EXISTS(SELECT 1 FROM public.projects WHERE company_id=$1 AND id=$2 AND status<>'FINISHED'))
      AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM public.project_phases WHERE company_id=$1 AND id=$3 AND project_id=$2))
      AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM public.workers WHERE company_id=$1 AND id=$4))
      AND NOT EXISTS(SELECT 1 FROM unnest($5::text[]) x(id) WHERE NOT EXISTS(SELECT 1 FROM public.stock_items WHERE company_id=$1 AND id=x.id AND is_active))
      AND EXISTS(SELECT 1 FROM public.companies WHERE id=$1 AND currency=$6) AS ok`,
    [actor.companyId,project,input.phaseId ?? null,input.requestedByWorkerId ?? null,input.items.flatMap((i)=>i.itemId ? [i.itemId] : []),input.currencyCode]);
    if (!valid.rows[0]?.ok) return {outcome:"VALIDATION_FAILED",message:"Projekat, faza, radnik, artikal ili valuta nisu validni."};
    const id=uid("prq");
    await client.query(`INSERT INTO public.purchase_requests(id,company_id,project_id,phase_id,requested_by_worker_id,needed_by,justification,total_estimated_cents,currency_code,created_by,client_generated_id,request_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,actor.companyId,project,input.phaseId ?? null,input.requestedByWorkerId ?? null,input.neededBy ?? null,input.justification.trim(),total.toString(),input.currencyCode,actor.userId,input.clientGeneratedId,hash]);
    for (const item of input.items) await client.query(`INSERT INTO public.purchase_request_items(id,company_id,request_id,item_id,description,unit,quantity,estimated_unit_price_cents)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[uid("pri"),actor.companyId,id,item.itemId ?? null,item.description.trim(),item.unit.trim(),item.quantity,item.estimatedUnitPriceCents]);
    await audit(client,actor,id,"purchase.request_created",{projectId:project,totalCents:total.toString()});
    return {outcome:"OK",data:{id}};
  });
}
export async function patchPurchaseRequest(pool:Pool,actor:PurchaseActor,id:string,input:PurchaseRequestPatchInput):Promise<WarehouseResult<{id:string}>> {
  if (!can(actor.roles,"purchase.manage")) return denied;
  if (input.justification !== undefined && !input.justification.trim()) return {outcome:"VALIDATION_FAILED",message:"Obrazloženje je obavezno."};
  return withCompany(pool,companyId(actor.companyId),async (client) => {
    const row=await header(client,actor,id,true); if (!row) return missing;
    if (row.status!=="DRAFT") return {outcome:"CONFLICT",message:"Mijenja se samo nacrt."};
    await client.query(`UPDATE public.purchase_requests SET justification=COALESCE($3,justification),
      needed_by=CASE WHEN $4 THEN $5::date ELSE needed_by END,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2`,
    [actor.companyId,id,input.justification?.trim() ?? null,input.neededBy!==undefined,input.neededBy ?? null]);
    await audit(client,actor,id,"purchase.request_updated"); return {outcome:"OK",data:{id}};
  });
}
export async function transitionPurchaseRequest(pool:Pool,actor:PurchaseActor,id:string,action:"submit"|"approve"|"reject",reason?:string):Promise<WarehouseResult<{id:string;status:string;approvalRequired:boolean}>> {
  if (!can(actor.roles,"purchase.manage")) return denied;
  if (action==="reject" && (!reason || reason.trim().length<10)) return {outcome:"VALIDATION_FAILED",message:"Razlog odbijanja mora imati najmanje 10 znakova."};
  return withCompany(pool,companyId(actor.companyId),async (client) => {
    const row=await header(client,actor,id,true); if (!row) return missing;
    const threshold=await client.query<{value:string}>("SELECT purchase_approval_threshold_cents::text AS value FROM public.companies WHERE id=$1",[actor.companyId]);
    const amount=BigInt(row.total_estimated_cents), limit=BigInt(row.approval_threshold_cents ?? threshold.rows[0]!.value);
    const required=purchaseNeedsApproval(amount,limit);
    if (action==="submit") {
      if(row.status!=="DRAFT") return {outcome:"CONFLICT",message:"Samo nacrt se može predati."};
      if (required) await client.query(`INSERT INTO public.approval_requests(id,company_id,subject_type,subject_id,amount_cents,currency_code,status,requested_by)
        VALUES ($1,$2,'purchase',$3,$4,$5,'OPEN',$6)`,[uid("apr"),actor.companyId,id,row.total_estimated_cents,row.currency_code,actor.userId]);
      await client.query("UPDATE public.purchase_requests SET status='SUBMITTED',approval_threshold_cents=$3,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id,limit.toString()]);
      await audit(client,actor,id,"purchase.request_submitted",{approvalRequired:required});
      return {outcome:"OK",data:{id,status:"SUBMITTED",approvalRequired:required}};
    }
    if(row.status!=="SUBMITTED") return {outcome:"CONFLICT",message:"Zahtjev nije predan za odluku."};
    if(!canApprovePurchase(actor.roles,amount,limit)) return {outcome:"FORBIDDEN",code:"PURCHASE_APPROVAL_REQUIRED",message:"Za ovaj iznos potrebna je odluka vlasnika ili administratora."};
    const status=action==="approve" ? "APPROVED" : "REJECTED";
    if(required) {
      const changed=await client.query(`UPDATE public.approval_requests SET status=$3,decided_by=$4,decided_at=clock_timestamp(),reason=$5,updated_at=clock_timestamp()
        WHERE company_id=$1 AND subject_type='purchase' AND subject_id=$2 AND status='OPEN' RETURNING id`,[actor.companyId,id,status,actor.userId,action==="reject" ? reason!.trim() : null]);
      if(!changed.rowCount) throw new Error("PURCHASE_APPROVAL_MISSING");
    }
    await client.query("UPDATE public.purchase_requests SET status=$3,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id,status]);
    await audit(client,actor,id,action==="approve" ? "purchase.request_approved" : "purchase.request_rejected",{reason:reason ?? null});
    return {outcome:"OK",data:{id,status,approvalRequired:required}};
  });
}
