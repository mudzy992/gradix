import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { formatThousandths, invoiceReclassificationCents, toThousandths, type Currency } from "@gradix/domain";
import { postCost } from "./cost-entry-service";
import type { PurchaseActor } from "./purchase-request-service";
const uid=(p:string)=>`${p}_${randomUUID().replace(/-/g,"")}`;
type InvoiceLine={id:string;invoice_id:string;phase_id:string|null;category_id:string;quantity:string;amount_cents:string;allocated:string};
export async function reclassify(client:PoolClient,actor:PurchaseActor,params:{issueItemId:string;itemId:string;projectId:string;quantity:string;date:string;currency:Currency;warehouseId:string}):Promise<bigint> {
  const rows=await client.query<InvoiceLine>(`SELECT ii.id,ii.invoice_id,inv.phase_id,ci.category_id,ii.quantity::text,ii.amount_cents::text,
      COALESCE((SELECT sum(a.quantity) FROM public.material_issue_allocations a WHERE a.company_id=ii.company_id AND a.invoice_item_id=ii.id),0)::text AS allocated
    FROM public.purchase_invoice_items ii
    JOIN public.purchase_invoices inv ON inv.company_id=ii.company_id AND inv.id=ii.invoice_id
    JOIN public.goods_receipt_items ri ON ri.company_id=ii.company_id AND ri.id=ii.receipt_item_id
    JOIN public.goods_receipts r ON r.company_id=ri.company_id AND r.id=ri.receipt_id
    JOIN public.cost_entries ci ON ci.company_id=inv.company_id AND ci.source_type='PURCHASE' AND ci.source_id=inv.id AND ci.status='POSTED'
    JOIN public.material_issue_items mi ON mi.company_id=ii.company_id AND mi.id=$6
    JOIN public.material_issues issue ON issue.company_id=mi.company_id AND issue.id=mi.issue_id
    WHERE ii.company_id=$1 AND inv.project_id=$2 AND inv.status IN ('APPROVED','PAID') AND inv.currency_code=$3 AND ri.item_id=$4 AND r.warehouse_id=$5 AND r.created_at<=issue.created_at
    ORDER BY inv.created_at,inv.id,ii.id FOR UPDATE OF ii`,[actor.companyId,params.projectId,params.currency,params.itemId,params.warehouseId,params.issueItemId]);
  let remaining=toThousandths(params.quantity), total=0n;
  for(const line of rows.rows) {
    if(remaining===0n) break;
    const qty=toThousandths(line.quantity), previous=toThousandths(line.allocated), available=qty-previous;
    if(available<=0n) continue;
    const used=remaining<available ? remaining : available;
    const amount=invoiceReclassificationCents(BigInt(line.amount_cents),qty,previous,used);
    const allocationId=uid("mia");
    const cost=await postCost(client,{companyId:actor.companyId,projectId:params.projectId,phaseId:line.phase_id,categoryId:line.category_id,sourceType:"PURCHASE",
      sourceId:allocationId,occurredOn:params.date,amountCents:-amount,currency:params.currency,actorId:actor.userId,
      entryKind:"OFFSET",supplierInvoiceId:line.invoice_id,materialIssueItemId:params.issueItemId,note:"Razgraničenje povezanog računa"});
    await client.query(`INSERT INTO public.material_issue_allocations(id,company_id,issue_item_id,invoice_item_id,quantity,offset_cents,offset_cost_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,[allocationId,actor.companyId,params.issueItemId,line.id,formatThousandths(used),amount.toString(),cost.id]);
    remaining-=used; total+=amount;
  }
  return total;
}
