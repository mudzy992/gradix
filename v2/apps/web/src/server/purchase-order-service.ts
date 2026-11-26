import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { toThousandths } from "@gradix/domain";
import type { PurchaseOrderInput, PurchaseOrderPatchInput } from "@gradix/contracts";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { canUsePurchaseProject, type PurchaseActor } from "./purchase-request-service";
import type { WarehouseResult } from "./warehouse-service";

const uid=(p:string)=>`${p}_${randomUUID().replace(/-/g,"")}`;
const denied={outcome:"FORBIDDEN",message:"Nemate pravo upravljanja nabavkom."} as const;
const missing={outcome:"NOT_FOUND",message:"Narudžbenica ne postoji."} as const;
const fields="o.id,o.request_id,o.partner_id,o.ordered_at::text,o.expected_at::text,o.status,o.total_cents::text,o.currency_code,o.created_at::text";
export type OrderHeader={id:string;request_id:string|null;partner_id:string;status:string;currency_code:string;project_id:string|null};
export async function findPurchaseOrder(client:PoolClient,actor:PurchaseActor,id:string,lock=false):Promise<OrderHeader|null> {
  const result=await client.query<OrderHeader>(`SELECT o.id,o.request_id,o.partner_id,o.status,o.currency_code,r.project_id
    FROM public.purchase_orders o LEFT JOIN public.purchase_requests r ON r.company_id=o.company_id AND r.id=o.request_id
    WHERE o.company_id=$1 AND o.id=$2 ${lock ? "FOR UPDATE OF o" : ""}`,[actor.companyId,id]);
  const row=result.rows[0]; return row && canUsePurchaseProject(actor,row.project_id) ? row : null;
}
async function audit(client:PoolClient,actor:PurchaseActor,id:string,action:"purchase.order_created"|"purchase.order_updated"|"purchase.order_sent",metadata:Record<string,unknown>={}):Promise<void> {
  await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action,entityType:"purchase_order",entityId:id,retentionClass:"FINANCIAL",metadata});
}
export async function listPurchaseOrders(pool:Pool,actor:PurchaseActor):Promise<WarehouseResult<unknown[]>> {
  if(!can(actor.roles,"purchase.view")) return denied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const rows=await client.query(`SELECT ${fields} FROM public.purchase_orders o LEFT JOIN public.purchase_requests r ON r.company_id=o.company_id AND r.id=o.request_id
      WHERE o.company_id=$1 AND ($2::boolean OR r.project_id=ANY($3::text[])) ORDER BY o.created_at DESC,o.id LIMIT 500`,
    [actor.companyId,actor.scope==="COMPANY",actor.scope==="PROJECTS" ? actor.projectIds ?? [] : []]);
    return {outcome:"OK",data:rows.rows};
  });
}
export async function getPurchaseOrder(pool:Pool,actor:PurchaseActor,id:string):Promise<WarehouseResult<{order:unknown;items:unknown[]}>> {
  if(!can(actor.roles,"purchase.view")) return denied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    if(!await findPurchaseOrder(client,actor,id)) return missing;
    const order=await client.query(`SELECT ${fields} FROM public.purchase_orders o WHERE o.company_id=$1 AND o.id=$2`,[actor.companyId,id]);
    const items=await client.query(`SELECT i.id,i.request_item_id,i.item_id,i.description,i.unit,i.quantity::text,i.unit_price_cents::text,
      COALESCE((SELECT sum(ri.quantity) FROM public.goods_receipt_items ri WHERE ri.company_id=i.company_id AND ri.order_item_id=i.id),0)::text AS received_quantity
      FROM public.purchase_order_items i WHERE i.company_id=$1 AND i.order_id=$2 ORDER BY i.id`,[actor.companyId,id]);
    return {outcome:"OK",data:{order:order.rows[0],items:items.rows}};
  });
}
export async function createPurchaseOrder(pool:Pool,actor:PurchaseActor,input:PurchaseOrderInput):Promise<WarehouseResult<{id:string}>> {
  if(!can(actor.roles,"purchase.manage")) return denied;
  if (new Set(input.items.map(i=>i.itemId)).size!==input.items.length || input.items.some(i=>toThousandths(i.quantity)<=0n || !i.unit.trim() || !i.description.trim())) return {outcome:"VALIDATION_FAILED",message:"Stavke narudžbenice nisu validne."};
  const total=input.items.reduce((sum,i)=>sum+(toThousandths(i.quantity)*BigInt(i.unitPriceCents)+500n)/1000n,0n);
  if(total>9223372036854775807n) return {outcome:"VALIDATION_FAILED",message:"Vrijednost prelazi dozvoljeni opseg."};
  const hash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return withCompany(pool,companyId(actor.companyId),async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('purchase-order:' || $1 || ':' || $2,0))",[actor.companyId,input.clientGeneratedId]);
    const existing=await client.query<{id:string;project_id:string|null;request_hash:string}>(`SELECT o.id,r.project_id,o.request_hash FROM public.purchase_orders o
      LEFT JOIN public.purchase_requests r ON r.company_id=o.company_id AND r.id=o.request_id
      WHERE o.company_id=$1 AND o.client_generated_id=$2`,[actor.companyId,input.clientGeneratedId]);
    if(existing.rows[0]) {
      if(!canUsePurchaseProject(actor,existing.rows[0].project_id)) return denied;
      if(existing.rows[0].request_hash!==hash) return {outcome:"CONFLICT",message:"Identifikator je već korišten za drugačiju narudžbenicu."};
      return {outcome:"OK",data:{id:existing.rows[0].id}};
    }
    if(input.requestId) {
      const request=await client.query<{status:string;project_id:string|null}>("SELECT status,project_id FROM public.purchase_requests WHERE company_id=$1 AND id=$2 FOR UPDATE",[actor.companyId,input.requestId]);
      if(!request.rows[0] || !canUsePurchaseProject(actor,request.rows[0].project_id)) return {outcome:"NOT_FOUND",message:"Zahtjev ne postoji."};
      if(!["APPROVED","ORDERED"].includes(request.rows[0].status)) return {outcome:"CONFLICT",message:"Narudžbenica traži odobren zahtjev."};
    } else if(actor.scope!=="COMPANY") return denied;
    const refs=await client.query<{ok:boolean}>(`SELECT EXISTS (SELECT 1 FROM public.partners p JOIN public.partner_roles r ON r.company_id=p.company_id AND r.partner_id=p.id
      WHERE p.company_id=$1 AND p.id=$2 AND p.active AND r.role='VENDOR' AND r.is_active)
      AND EXISTS(SELECT 1 FROM public.companies WHERE id=$1 AND currency=$3)
      AND NOT EXISTS(SELECT 1 FROM unnest($4::text[]) x(id) WHERE NOT EXISTS(SELECT 1 FROM public.stock_items WHERE company_id=$1 AND id=x.id AND is_active)) AS ok`,
    [actor.companyId,input.partnerId,input.currencyCode,input.items.map(i=>i.itemId)]);
    if(!refs.rows[0]?.ok) return {outcome:"VALIDATION_FAILED",message:"Dobavljač, valuta ili artikal nisu validni."};
    for(const i of input.items) if(i.requestItemId) {
      const ref=await client.query("SELECT 1 FROM public.purchase_request_items WHERE company_id=$1 AND id=$2 AND request_id=$3 AND (item_id IS NULL OR item_id=$4)",[actor.companyId,i.requestItemId,input.requestId ?? null,i.itemId]);
      if(!ref.rowCount) return {outcome:"VALIDATION_FAILED",message:"Stavka ne pripada zahtjevu."};
    }
    const id=uid("po");
    await client.query(`INSERT INTO public.purchase_orders(id,company_id,request_id,partner_id,expected_at,total_cents,currency_code,created_by,client_generated_id,request_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,actor.companyId,input.requestId ?? null,input.partnerId,input.expectedAt ?? null,total.toString(),input.currencyCode,actor.userId,input.clientGeneratedId,hash]);
    for(const i of input.items) await client.query(`INSERT INTO public.purchase_order_items(id,company_id,order_id,request_item_id,item_id,description,unit,quantity,unit_price_cents)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[uid("poi"),actor.companyId,id,i.requestItemId ?? null,i.itemId,i.description.trim(),i.unit.trim(),i.quantity,i.unitPriceCents]);
    await audit(client,actor,id,"purchase.order_created",{requestId:input.requestId ?? null,totalCents:total.toString()});
    return {outcome:"OK",data:{id}};
  });
}
export async function patchPurchaseOrder(pool:Pool,actor:PurchaseActor,id:string,input:PurchaseOrderPatchInput):Promise<WarehouseResult<{id:string}>> {
  if(!can(actor.roles,"purchase.manage")) return denied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const order=await findPurchaseOrder(client,actor,id,true); if(!order) return missing;
    if(order.status!=="DRAFT") return {outcome:"CONFLICT",message:"Mijenja se samo nacrt narudžbenice."};
    await client.query("UPDATE public.purchase_orders SET expected_at=CASE WHEN $3 THEN $4::date ELSE expected_at END,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id,input.expectedAt!==undefined,input.expectedAt ?? null]);
    await audit(client,actor,id,"purchase.order_updated"); return {outcome:"OK",data:{id}};
  });
}
export async function sendPurchaseOrder(pool:Pool,actor:PurchaseActor,id:string):Promise<WarehouseResult<{id:string;status:string}>> {
  if(!can(actor.roles,"purchase.manage")) return denied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const order=await findPurchaseOrder(client,actor,id,true); if(!order) return missing;
    if(order.status!=="DRAFT") return {outcome:"CONFLICT",message:"Samo nacrt može biti poslan."};
    if(order.request_id) {
      const request=await client.query<{status:string}>("SELECT status FROM public.purchase_requests WHERE company_id=$1 AND id=$2 FOR UPDATE",[actor.companyId,order.request_id]);
      if(!request.rows[0] || !["APPROVED","ORDERED"].includes(request.rows[0].status)) return {outcome:"CONFLICT",message:"Zahtjev nije odobren."};
      await client.query("UPDATE public.purchase_requests SET status='ORDERED',updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,order.request_id]);
    }
    await client.query("UPDATE public.purchase_orders SET status='SENT',ordered_at=clock_timestamp(),updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id]);
    await audit(client,actor,id,"purchase.order_sent"); return {outcome:"OK",data:{id,status:"SENT"}};
  });
}
