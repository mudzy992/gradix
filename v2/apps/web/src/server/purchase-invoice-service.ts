import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { formatThousandths, invoiceReceiptComparison, isCurrency, toThousandths } from "@gradix/domain";
import type { PurchaseInvoiceInput, PurchaseInvoicePatchInput } from "@gradix/contracts";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { postCost } from "./cost-entry-service";
import { reclassify } from "./purchase-reclassification";
import { canUsePurchaseProject, type PurchaseActor } from "./purchase-request-service";
import { findPurchaseOrder } from "./purchase-order-service";
import type { WarehouseResult } from "./warehouse-service";

const uid=(p:string)=>`${p}_${randomUUID().replace(/-/g,"")}`;
const denied={outcome:"FORBIDDEN",message:"Nemate pravo upravljanja nabavkom."} as const;
const missing={outcome:"NOT_FOUND",message:"Račun ne postoji."} as const;
const fields=`id,partner_id,invoice_number,invoice_date::text,due_date::text,amount_cents::text,currency_code,
  order_id,project_id,phase_id,attachment_id,status,created_at::text`;
type Invoice={id:string;partner_id:string;invoice_number:string;invoice_date:string;due_date:string|null;amount_cents:string;currency_code:string;order_id:string|null;project_id:string|null;phase_id:string|null;attachment_id:string|null;status:string;created_at:string};
async function findInvoice(client:PoolClient,actor:PurchaseActor,id:string,lock=false):Promise<Invoice|null> {
  const rows=await client.query<Invoice>(`SELECT ${fields} FROM public.purchase_invoices WHERE company_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,[actor.companyId,id]);
  const row=rows.rows[0]; return row && canUsePurchaseProject(actor,row.project_id) ? row : null;
}
async function warnings(client:PoolClient,company:string,invoice:Invoice):Promise<string[]> {
  const received=await client.query<{amount:string|null;currency:string|null}>(`SELECT sum(round(ri.amount_cents * ii.quantity / ri.quantity))::text amount,
      CASE WHEN count(DISTINCT r.currency_code)=1 THEN min(r.currency_code) ELSE NULL END AS currency
    FROM public.purchase_invoice_items ii JOIN public.goods_receipt_items ri ON ri.company_id=ii.company_id AND ri.id=ii.receipt_item_id
    JOIN public.goods_receipts r ON r.company_id=ri.company_id AND r.id=ri.receipt_id
    WHERE ii.company_id=$1 AND ii.invoice_id=$2`,[company,invoice.id]);
  let row=received.rows[0]!;
  if(row.amount===null && invoice.order_id) {
    const all=await client.query<{amount:string|null;currency:string|null}>(`SELECT sum(ri.amount_cents)::text AS amount,
      CASE WHEN count(DISTINCT r.currency_code)=1 THEN min(r.currency_code) ELSE NULL END AS currency
      FROM public.goods_receipts r JOIN public.goods_receipt_items ri ON ri.company_id=r.company_id AND ri.receipt_id=r.id
      WHERE r.company_id=$1 AND r.order_id=$2`,[company,invoice.order_id]);
    row=all.rows[0]!;
  }
  const comparison=invoiceReceiptComparison({invoiceCents:BigInt(invoice.amount_cents),invoiceCurrency:invoice.currency_code,
    receivedCents:row.amount===null ? null : BigInt(row.amount),receiptCurrency:row.currency});
  return comparison==="MATCH" ? [] : [comparison];
}
async function audit(client:PoolClient,actor:PurchaseActor,id:string,action:"purchase.invoice_created"|"purchase.invoice_updated"|"purchase.invoice_approved",metadata:Record<string,unknown>={}):Promise<void> {
  await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action,entityType:"purchase_invoice",entityId:id,retentionClass:"FINANCIAL",metadata});
}
export async function listPurchaseInvoices(pool:Pool,actor:PurchaseActor):Promise<WarehouseResult<unknown[]>> {
  if(!can(actor.roles,"purchase.view")) return denied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const result=await client.query<Invoice>(`SELECT ${fields} FROM public.purchase_invoices WHERE company_id=$1
      AND ($2::boolean OR project_id=ANY($3::text[])) ORDER BY created_at DESC,id LIMIT 500`,[actor.companyId,actor.scope==="COMPANY",actor.scope==="PROJECTS" ? actor.projectIds ?? [] : []]);
    const rows=[]; for(const invoice of result.rows) rows.push({...invoice,warnings:await warnings(client,actor.companyId,invoice)});
    return {outcome:"OK",data:rows};
  });
}
export async function getPurchaseInvoice(pool:Pool,actor:PurchaseActor,id:string):Promise<WarehouseResult<{invoice:unknown;items:unknown[]}>> {
  if(!can(actor.roles,"purchase.view")) return denied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const invoice=await findInvoice(client,actor,id); if(!invoice) return missing;
    const rows=await client.query("SELECT id,receipt_item_id,quantity::text,amount_cents::text FROM public.purchase_invoice_items WHERE company_id=$1 AND invoice_id=$2 ORDER BY id",[actor.companyId,id]);
    return {outcome:"OK",data:{invoice:{...invoice,warnings:await warnings(client,actor.companyId,invoice)},items:rows.rows}};
  });
}
export async function createPurchaseInvoice(pool:Pool,actor:PurchaseActor,input:PurchaseInvoiceInput):Promise<WarehouseResult<{id:string;warnings:string[]}>> {
  if(!can(actor.roles,"purchase.manage")) return denied;
  if(!canUsePurchaseProject(actor,input.projectId ?? null)) return denied;
  if(!input.invoiceNumber.trim() || (input.phaseId && !input.projectId) || new Set(input.items.map(i=>i.receiptItemId)).size!==input.items.length || input.items.some(i=>toThousandths(i.quantity)<=0n)) return {outcome:"VALIDATION_FAILED",message:"Podaci računa nisu validni."};
  if(input.items.reduce((s,i)=>s+BigInt(i.amountCents),0n)>BigInt(input.amountCents)) return {outcome:"VALIDATION_FAILED",message:"Zbir povezanih stavki premašuje račun."};
  return withCompany(pool,companyId(actor.companyId),async client=>{
    if(input.orderId) {
      const order=await findPurchaseOrder(client,actor,input.orderId,true);
      if(!order) return {outcome:"NOT_FOUND",message:"Narudžbenica ne postoji."};
      if(order.partner_id!==input.partnerId || order.currency_code!==input.currencyCode || (order.request_id && order.project_id!==(input.projectId ?? null))) return {outcome:"VALIDATION_FAILED",message:"Račun ne odgovara narudžbenici."};
    } else if(actor.scope!=="COMPANY") return denied;
    const refs=await client.query<{ok:boolean}>(`SELECT EXISTS(SELECT 1 FROM public.partners p JOIN public.partner_roles r ON r.company_id=p.company_id AND r.partner_id=p.id
      WHERE p.company_id=$1 AND p.id=$2 AND p.active AND r.role='VENDOR' AND r.is_active)
      AND EXISTS(SELECT 1 FROM public.companies WHERE id=$1 AND currency=$3)
      AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM public.projects WHERE company_id=$1 AND id=$4 AND status<>'FINISHED'))
      AND ($5::text IS NULL OR EXISTS(SELECT 1 FROM public.project_phases WHERE company_id=$1 AND id=$5 AND project_id=$4))
      AND ($6::text IS NULL OR EXISTS(SELECT 1 FROM public.attachments WHERE company_id=$1 AND id=$6 AND status='ready')) AS ok`,
    [actor.companyId,input.partnerId,input.currencyCode,input.projectId ?? null,input.phaseId ?? null,input.attachmentId ?? null]);
    if(!refs.rows[0]?.ok) return {outcome:"VALIDATION_FAILED",message:"Dobavljač, valuta, projekat, faza ili prilog nisu validni."};
    const duplicate=await client.query("SELECT 1 FROM public.purchase_invoices WHERE company_id=$1 AND partner_id=$2 AND invoice_number=$3",[actor.companyId,input.partnerId,input.invoiceNumber.trim()]);
    if(duplicate.rowCount) return {outcome:"CONFLICT",code:"INVOICE_ALREADY_REGISTERED",message:"Račun s tim brojem već postoji za dobavljača."};
    for(const item of [...input.items].sort((a,b)=>a.receiptItemId.localeCompare(b.receiptItemId))) {
      const lock=await client.query<{ok:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended('receipt:' || $1 || ':' || $2,0)) AS ok",[actor.companyId,item.receiptItemId]);
      if(!lock.rows[0]?.ok) return {outcome:"CONFLICT",code:"PURCHASE_ALLOCATION_IN_PROGRESS",message:"Stavka prijema se već obrađuje."};
      const line=await client.query<{quantity:string;invoiced:string}>(`SELECT ri.quantity::text,COALESCE((SELECT sum(ii.quantity) FROM public.purchase_invoice_items ii
         WHERE ii.company_id=ri.company_id AND ii.receipt_item_id=ri.id),0)::text AS invoiced
       FROM public.goods_receipt_items ri JOIN public.goods_receipts r ON r.company_id=ri.company_id AND r.id=ri.receipt_id
       WHERE ri.company_id=$1 AND ri.id=$2 AND r.partner_id=$3 AND r.currency_code=$4 AND ($5::text IS NULL OR r.order_id=$5)`,
      [actor.companyId,item.receiptItemId,input.partnerId,input.currencyCode,input.orderId ?? null]);
      if(!line.rows[0] || toThousandths(line.rows[0].invoiced)+toThousandths(item.quantity)>toThousandths(line.rows[0].quantity)) return {outcome:"VALIDATION_FAILED",message:"Prijem ne odgovara računu ili je količina već fakturisana."};
    }
    const id=uid("pin");
    const inserted=await client.query(`INSERT INTO public.purchase_invoices(id,company_id,partner_id,invoice_number,invoice_date,due_date,amount_cents,currency_code,order_id,project_id,phase_id,attachment_id,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(company_id,partner_id,invoice_number) DO NOTHING RETURNING id`,
    [id,actor.companyId,input.partnerId,input.invoiceNumber.trim(),input.invoiceDate,input.dueDate ?? null,input.amountCents,input.currencyCode,input.orderId ?? null,input.projectId ?? null,input.phaseId ?? null,input.attachmentId ?? null,actor.userId]);
    if(!inserted.rowCount) return {outcome:"CONFLICT",code:"INVOICE_ALREADY_REGISTERED",message:"Račun s tim brojem već postoji za dobavljača."};
    for(const i of input.items) await client.query("INSERT INTO public.purchase_invoice_items(id,company_id,invoice_id,receipt_item_id,quantity,amount_cents) VALUES ($1,$2,$3,$4,$5,$6)",[uid("pini"),actor.companyId,id,i.receiptItemId,i.quantity,i.amountCents]);
    const invoice=await findInvoice(client,actor,id); if(!invoice) throw Error("PURCHASE_INVOICE_MISSING");
    const result=await warnings(client,actor.companyId,invoice);
    await audit(client,actor,id,"purchase.invoice_created",{warnings:result});
    return {outcome:"OK",data:{id,warnings:result}};
  });
}
export async function patchPurchaseInvoice(pool:Pool,actor:PurchaseActor,id:string,input:PurchaseInvoicePatchInput):Promise<WarehouseResult<{id:string;warnings:string[]}>> {
  if(!can(actor.roles,"purchase.manage")) return denied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const invoice=await findInvoice(client,actor,id,true); if(!invoice) return missing;
    if(invoice.status!=="PENDING") return {outcome:"CONFLICT",message:"Mijenja se samo račun na čekanju."};
    await client.query("UPDATE public.purchase_invoices SET due_date=CASE WHEN $3 THEN $4::date ELSE due_date END,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id,input.dueDate!==undefined,input.dueDate ?? null]);
    await audit(client,actor,id,"purchase.invoice_updated"); return {outcome:"OK",data:{id,warnings:await warnings(client,actor.companyId,invoice)}};
  });
}
export async function approvePurchaseInvoice(pool:Pool,actor:PurchaseActor,id:string):Promise<WarehouseResult<{id:string;warnings:string[];alreadyApproved:boolean}>> {
  if(!can(actor.roles,"purchase.manage")) return denied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const invoice=await findInvoice(client,actor,id,true); if(!invoice) return missing;
    if(invoice.status==="APPROVED" || invoice.status==="PAID") return {outcome:"OK",data:{id,warnings:await warnings(client,actor.companyId,invoice),alreadyApproved:true}};
    if(invoice.status!=="PENDING") return {outcome:"CONFLICT",message:"Račun nije na čekanju."};
    if(invoice.project_id) {
      const lock=await client.query<{ok:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended('purchase-project:' || $1 || ':' || $2,0)) AS ok",[actor.companyId,invoice.project_id]);
      if(!lock.rows[0]?.ok) return {outcome:"CONFLICT",code:"PURCHASE_ALLOCATION_IN_PROGRESS",message:"Projektna nabavka se već obrađuje."};
    }
    if(!isCurrency(invoice.currency_code)) return {outcome:"VALIDATION_FAILED",message:"Valuta nije podržana."};
    await client.query("UPDATE public.purchase_invoices SET status='APPROVED',updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id]);
    await postCost(client,{companyId:actor.companyId,projectId:invoice.project_id,phaseId:invoice.phase_id,sourceType:"PURCHASE",sourceId:id,
      occurredOn:invoice.invoice_date,amountCents:BigInt(invoice.amount_cents),currency:invoice.currency_code,actorId:actor.userId,
      entryKind:invoice.project_id ? "CHARGE" : "OVERHEAD",supplierInvoiceId:id,note:`Račun ${invoice.invoice_number}`});
    if(invoice.project_id) {
      const issues=await client.query<{id:string;item_id:string;warehouse_id:string;available:string;issue_date:string}>(`SELECT mi.id,mi.item_id,issue.warehouse_id,issue.issued_at::date::text AS issue_date,
        (mi.quantity-COALESCE((SELECT sum(a.quantity) FROM public.material_issue_allocations a WHERE a.company_id=mi.company_id AND a.issue_item_id=mi.id),0))::text AS available
        FROM public.material_issue_items mi JOIN public.material_issues issue ON issue.company_id=mi.company_id AND issue.id=mi.issue_id
        WHERE mi.company_id=$1 AND issue.project_id=$2 AND issue.currency_code=$3
        AND EXISTS(SELECT 1 FROM public.purchase_invoice_items ii JOIN public.goods_receipt_items ri ON ri.company_id=ii.company_id AND ri.id=ii.receipt_item_id
          JOIN public.goods_receipts r ON r.company_id=ri.company_id AND r.id=ri.receipt_id
          WHERE ii.company_id=mi.company_id AND ii.invoice_id=$4 AND ri.item_id=mi.item_id AND r.warehouse_id=issue.warehouse_id)
        ORDER BY issue.created_at,issue.id,mi.id`,[actor.companyId,invoice.project_id,invoice.currency_code,id]);
      for(const issue of issues.rows) if(toThousandths(issue.available)>0n) await reclassify(client,actor,{issueItemId:issue.id,itemId:issue.item_id,
        projectId:invoice.project_id,quantity:formatThousandths(toThousandths(issue.available)),date:invoice.invoice_date>issue.issue_date ? invoice.invoice_date : issue.issue_date,currency:invoice.currency_code,warehouseId:issue.warehouse_id});
    }
    const result=await warnings(client,actor.companyId,invoice);
    await audit(client,actor,id,"purchase.invoice_approved",{warnings:result});
    return {outcome:"OK",data:{id,warnings:result,alreadyApproved:false}};
  });
}
