import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { formatThousandths, purchaseReceiptStatus, toThousandths } from "@gradix/domain";
import type { GoodsReceiptInput } from "@gradix/contracts";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { canUsePurchaseProject, type PurchaseActor } from "./purchase-request-service";
import { findPurchaseOrder } from "./purchase-order-service";
import { balanceExpression, lockWarehouse, type WarehouseResult } from "./warehouse-service";

const uid=(p:string)=>`${p}_${randomUUID().replace(/-/g,"")}`;
export async function receiveGoods(pool:Pool,actor:PurchaseActor,input:GoodsReceiptInput):Promise<WarehouseResult<{id:string;warnings:string[];orderStatus:string|null}>> {
  if(!can(actor.roles,"purchase.manage")) return {outcome:"FORBIDDEN",message:"Nemate pravo upravljanja nabavkom."};
  if((!input.orderId && (!input.note || input.note.trim().length<3)) || (input.note !== null && input.note !== undefined && input.note.trim().length<3)) return {outcome:"VALIDATION_FAILED",message:"Prijem bez narudžbenice traži napomenu od najmanje tri znaka."};
  if(new Set(input.items.map(i=>i.itemId)).size!==input.items.length || input.items.some(i=>toThousandths(i.quantity)<=0n || (toThousandths(i.quantity)*BigInt(i.unitPriceCents)+500n)/1000n>9223372036854775807n)) return {outcome:"VALIDATION_FAILED",message:"Stavke prijema nisu validne."};
  const hash=createHash("sha256").update(JSON.stringify({order:input.orderId ?? null,partner:input.partnerId,warehouse:input.warehouseId,date:input.receivedAt,currency:input.currencyCode,note:input.note?.trim() ?? null,items:input.items.map(i=>({orderItem:i.orderItemId ?? null,item:i.itemId,quantity:formatThousandths(toThousandths(i.quantity)),price:BigInt(i.unitPriceCents).toString()})).sort((a,b)=>a.item.localeCompare(b.item))})).digest("hex");
  return withCompany(pool,companyId(actor.companyId),async client=>{
    if(input.clientGeneratedId) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('goods-receipt:' || $1 || ':' || $2,0))",[actor.companyId,input.clientGeneratedId]);
      const existing=await client.query<{id:string;request_hash:string;order_id:string|null;resulting_order_status:string|null;project_id:string|null}>(`SELECT r.id,r.request_hash,r.order_id,r.resulting_order_status,CASE WHEN r.order_id IS NULL THEN w.project_id ELSE pr.project_id END AS project_id
        FROM public.goods_receipts r JOIN public.warehouses w ON w.company_id=r.company_id AND w.id=r.warehouse_id
        LEFT JOIN public.purchase_orders o ON o.company_id=r.company_id AND o.id=r.order_id
        LEFT JOIN public.purchase_requests pr ON pr.company_id=o.company_id AND pr.id=o.request_id
        WHERE r.company_id=$1 AND r.client_generated_id=$2`,[actor.companyId,input.clientGeneratedId]);
      const row=existing.rows[0];
      if(row) {
        if(!canUsePurchaseProject(actor,row.project_id)) return {outcome:"FORBIDDEN",message:"Prijem nije u vašem opsegu."};
        if(row.request_hash!==hash) return {outcome:"CONFLICT",message:"Identifikator je već korišten za drugačiji prijem."};
        return {outcome:"OK",data:{id:row.id,warnings:row.order_id ? [] : ["RECEIPT_WITHOUT_ORDER"],orderStatus:row.resulting_order_status}};
      }
    }
    let orderStatus:string|null=null;
    if(input.orderId) {
      const order=await findPurchaseOrder(client,actor,input.orderId,true);
      if(!order) return {outcome:"NOT_FOUND",message:"Narudžbenica ne postoji."};
      if(!["SENT","PARTIALLY_RECEIVED"].includes(order.status)) return {outcome:"CONFLICT",message:"Narudžbenica nije otvorena za prijem."};
      if(order.partner_id!==input.partnerId || order.currency_code!==input.currencyCode) return {outcome:"VALIDATION_FAILED",message:"Dobavljač ili valuta ne odgovara narudžbenici."};
    }
    const warehouse=await client.query<{project_id:string|null;kind:string;fuel_item_id:string|null;capacity_l:string|null}>(
      `SELECT w.project_id,w.kind,t.fuel_item_id,t.capacity_l::text FROM public.warehouses w
       LEFT JOIN public.fuel_tanks t ON t.company_id=w.company_id AND t.warehouse_id=w.id
       WHERE w.company_id=$1 AND w.id=$2 AND w.is_active`,[actor.companyId,input.warehouseId]);
    const w=warehouse.rows[0];
    if(!w || (w.kind==='SITE' && !canUsePurchaseProject(actor,w.project_id)) || (!input.orderId && !canUsePurchaseProject(actor,w.project_id))) return {outcome:"NOT_FOUND",message:"Skladište ne postoji ili nije dostupno."};
    const valid=await client.query<{ok:boolean}>(`SELECT EXISTS(SELECT 1 FROM public.partners p JOIN public.partner_roles r ON r.company_id=p.company_id AND r.partner_id=p.id
      WHERE p.company_id=$1 AND p.id=$2 AND p.active AND r.role='VENDOR' AND r.is_active)
      AND EXISTS(SELECT 1 FROM public.companies WHERE id=$1 AND currency=$3)
      AND NOT EXISTS(SELECT 1 FROM unnest($4::text[]) x(id) WHERE NOT EXISTS(SELECT 1 FROM public.stock_items WHERE company_id=$1 AND id=x.id AND is_active)) AS ok`,
    [actor.companyId,input.partnerId,input.currencyCode,input.items.map(i=>i.itemId)]);
    if(!valid.rows[0]?.ok) return {outcome:"VALIDATION_FAILED",message:"Dobavljač, valuta ili artikal nisu validni."};
    if(!await lockWarehouse(client,actor.companyId,input.warehouseId)) return {outcome:"CONFLICT",code:"STOCK_COUNT_IN_PROGRESS",message:"Popis ili kretnja su u toku."};
    for(const i of input.items) {
      if(input.orderId) {
        const line=await client.query<{ordered:string;received:string}>(`SELECT p.quantity::text AS ordered,
          COALESCE((SELECT sum(x.quantity) FROM public.goods_receipt_items x WHERE x.company_id=p.company_id AND x.order_item_id=p.id),0)::text AS received
          FROM public.purchase_order_items p WHERE p.company_id=$1 AND p.id=$2 AND p.order_id=$3 AND p.item_id=$4`,[actor.companyId,i.orderItemId ?? null,input.orderId,i.itemId]);
        if(!line.rows[0] || toThousandths(line.rows[0].received)+toThousandths(i.quantity)>toThousandths(line.rows[0].ordered)) return {outcome:"VALIDATION_FAILED",message:"Stavka ne pripada narudžbenici ili premašuje naručenu količinu."};
      } else if(i.orderItemId) return {outcome:"VALIDATION_FAILED",message:"Stavka narudžbenice zahtijeva narudžbenicu."};
      if(w.kind==='TANK') {
        if(w.fuel_item_id!==i.itemId || !w.capacity_l) return {outcome:"VALIDATION_FAILED",message:"U cisternu se prima samo gorivo."};
        const level=await client.query<{balance:string}>(`SELECT ${balanceExpression}::text AS balance FROM public.stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3`,[actor.companyId,input.warehouseId,i.itemId]);
        if(toThousandths(level.rows[0]!.balance)+toThousandths(i.quantity)>toThousandths(w.capacity_l)) return {outcome:"VALIDATION_FAILED",message:"Prijem premašuje kapacitet cisterne."};
      }
    }
    if(input.orderId) {
      const lines=await client.query<{id:string;ordered:string;received:string}>(`SELECT p.id,p.quantity::text AS ordered,
        COALESCE((SELECT sum(x.quantity) FROM public.goods_receipt_items x WHERE x.company_id=p.company_id AND x.order_item_id=p.id),0)::text AS received
        FROM public.purchase_order_items p WHERE p.company_id=$1 AND p.order_id=$2`,[actor.companyId,input.orderId]);
      orderStatus=purchaseReceiptStatus(lines.rows.map(r=>({orderedMilli:toThousandths(r.ordered),receivedMilli:toThousandths(r.received)+input.items.filter(i=>i.orderItemId===r.id).reduce((sum,i)=>sum+toThousandths(i.quantity),0n)})));
    }
    const id=uid("gr");
    await client.query(`INSERT INTO public.goods_receipts(id,company_id,order_id,partner_id,warehouse_id,received_at,currency_code,note,created_by,client_generated_id,request_hash,resulting_order_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,actor.companyId,input.orderId ?? null,input.partnerId,input.warehouseId,input.receivedAt,input.currencyCode,input.note?.trim() || null,actor.userId,input.clientGeneratedId ?? null,input.clientGeneratedId ? hash : null,orderStatus]);
    for(const i of input.items) {
      const movement=uid("stm"), amount=(toThousandths(i.quantity)*BigInt(i.unitPriceCents)+500n)/1000n;
      await client.query(`INSERT INTO public.stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,unit_cost_cents,amount_cents,occurred_on,source_type,source_id,created_by)
        VALUES ($1,$2,$3,$4,'IN',$5,$6,$7,$8::timestamptz::date,'PURCHASE',$9,$10)`,[movement,actor.companyId,i.itemId,input.warehouseId,i.quantity,i.unitPriceCents,amount.toString(),input.receivedAt,id,actor.userId]);
      await client.query(`INSERT INTO public.goods_receipt_items(id,company_id,receipt_id,order_item_id,item_id,quantity,unit_price_cents,amount_cents,movement_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[uid("gri"),actor.companyId,id,i.orderItemId ?? null,i.itemId,i.quantity,i.unitPriceCents,amount.toString(),movement]);
    }
    if(input.orderId) await client.query("UPDATE public.purchase_orders SET status=$3,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,input.orderId,orderStatus]);
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"purchase.goods_received",entityType:"goods_receipt",entityId:id,retentionClass:"FINANCIAL",metadata:{orderId:input.orderId ?? null,warehouseId:input.warehouseId}});
    return {outcome:"OK",data:{id,warnings:input.orderId ? [] : ["RECEIPT_WITHOUT_ORDER"],orderStatus}};
  });
}
