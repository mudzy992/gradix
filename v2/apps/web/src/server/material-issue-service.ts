import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { averageIssueCostCents, formatThousandths, isCurrency, toThousandths } from "@gradix/domain";
import type { MaterialIssueInput } from "@gradix/contracts";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { ensureCostCategories, postCost } from "./cost-entry-service";
import { canUsePurchaseProject, type PurchaseActor } from "./purchase-request-service";
import { reclassify } from "./purchase-reclassification";
import { balanceExpression, lockWarehouse, type WarehouseResult } from "./warehouse-service";

const uid=(p:string)=>`${p}_${randomUUID().replace(/-/g,"")}`;
type IssueLine={itemId:string;quantity:string;amount:bigint;unitPrice:bigint;below:boolean};
export async function issueMaterial(pool:Pool,actor:PurchaseActor,input:MaterialIssueInput):Promise<WarehouseResult<{id:string;amountCents:string;offsetCents:string;belowMinimum:boolean}>> {
  if(!can(actor.roles,"stock.manage")) return {outcome:"FORBIDDEN",message:"Nemate pravo izdavanja materijala."};
  const project=input.projectId ?? null;
  if(!canUsePurchaseProject(actor,project)) return {outcome:"FORBIDDEN",message:"Projekat nije u vašem opsegu."};
  if(!input.items.length) return {outcome:"VALIDATION_FAILED",code:"MATERIAL_ISSUE_EMPTY",message:"Izlaz mora imati stavke."};
  if((input.phaseId && !project) || new Set(input.items.map(i=>i.itemId)).size!==input.items.length || input.items.some(i=>toThousandths(i.quantity)<=0n) || (input.note!==undefined && input.note!==null && !input.note.trim())) return {outcome:"VALIDATION_FAILED",message:"Stavke ili faza nisu validni."};
  const requestHash=createHash("sha256").update(JSON.stringify({warehouseId:input.warehouseId,projectId:project,phaseId:input.phaseId ?? null,worker:input.issuedToWorkerId ?? null,issuedAt:input.issuedAt,note:input.note?.trim() ?? null,items:input.items.map(i=>({itemId:i.itemId,quantity:formatThousandths(toThousandths(i.quantity))})).sort((a,b)=>a.itemId.localeCompare(b.itemId))})).digest("hex");
  return withCompany(pool,companyId(actor.companyId),async client=>{
    if(input.clientGeneratedId) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('material-issue:' || $1 || ':' || $2,0))",[actor.companyId,input.clientGeneratedId]);
      const existing=await client.query<{request_hash:string;project_id:string|null;id:string;amount:string;offset:string;below_minimum:boolean}>(`SELECT i.id,i.project_id,i.request_hash,i.below_minimum,
        COALESCE((SELECT sum(amount_cents) FROM public.material_issue_items WHERE company_id=i.company_id AND issue_id=i.id),0)::text AS amount,
        COALESCE((SELECT sum(a.offset_cents) FROM public.material_issue_allocations a JOIN public.material_issue_items x ON x.company_id=a.company_id AND x.id=a.issue_item_id WHERE a.company_id=i.company_id AND x.issue_id=i.id),0)::text AS offset
        FROM public.material_issues i WHERE i.company_id=$1 AND i.client_generated_id=$2`,[actor.companyId,input.clientGeneratedId]);
      const row=existing.rows[0];
      if(row) {
        if(!canUsePurchaseProject(actor,row.project_id)) return {outcome:"FORBIDDEN",message:"Projekat nije u vašem opsegu."};
        if(row.request_hash!==requestHash) return {outcome:"CONFLICT",message:"Identifikator je već korišten za drugačiji izlaz."};
        return {outcome:"OK",data:{id:row.id,amountCents:row.amount,offsetCents:row.offset,belowMinimum:row.below_minimum}};
      }
    }
    const refs=await client.query<{ok:boolean;currency:string}>(`SELECT c.currency,
      ($2::text IS NULL OR EXISTS(SELECT 1 FROM public.projects WHERE company_id=$1 AND id=$2 AND status<>'FINISHED'))
      AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM public.project_phases WHERE company_id=$1 AND id=$3 AND project_id=$2))
      AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM public.workers WHERE company_id=$1 AND id=$4))
      AND EXISTS(SELECT 1 FROM public.warehouses WHERE company_id=$1 AND id=$5 AND is_active) AS ok
      FROM public.companies c WHERE c.id=$1`,[actor.companyId,project,input.phaseId ?? null,input.issuedToWorkerId ?? null,input.warehouseId]);
    const ref=refs.rows[0];
    if(!ref?.ok || !isCurrency(ref.currency)) return {outcome:"VALIDATION_FAILED",message:"Skladište, projekat, faza, radnik ili valuta nisu validni."};
    const warehouse=await client.query<{kind:string;project_id:string|null}>("SELECT kind,project_id FROM public.warehouses WHERE company_id=$1 AND id=$2",[actor.companyId,input.warehouseId]);
    if(warehouse.rows[0]?.kind==='SITE' && !canUsePurchaseProject(actor,warehouse.rows[0].project_id)) return {outcome:"NOT_FOUND",message:"Skladište nije dostupno."};
    const currency=ref.currency;
    if(!await lockWarehouse(client,actor.companyId,input.warehouseId)) return {outcome:"CONFLICT",code:"STOCK_COUNT_IN_PROGRESS",message:"Popis ili kretnja su u toku."};
    if(project) {
      const lock=await client.query<{ok:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended('purchase-project:' || $1 || ':' || $2,0)) AS ok",[actor.companyId,project]);
      if(!lock.rows[0]?.ok) return {outcome:"CONFLICT",code:"PURCHASE_ALLOCATION_IN_PROGRESS",message:"Projektna nabavka se već obrađuje."};
    }
    const lines:IssueLine[]=[]; let total=0n;
    for(const i of input.items) {
      const result=await client.query<{balance:string;inqty:string|null;value:string|null;unknown:boolean;minimum:string;tank_item:string|null}>(`SELECT
          (SELECT ${balanceExpression}::text FROM public.stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND item_id=i.id) AS balance,
          (SELECT sum(quantity)::text FROM public.stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND item_id=i.id AND kind='IN') AS inqty,
          (SELECT sum(amount_cents)::text FROM public.stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND item_id=i.id AND kind='IN') AS value,
          EXISTS(SELECT 1 FROM public.stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND item_id=i.id AND kind='IN' AND amount_cents IS NULL) AS unknown,
          COALESCE(l.min_quantity,0)::text AS minimum,t.fuel_item_id AS tank_item
        FROM public.stock_items i JOIN public.warehouses w ON w.company_id=i.company_id AND w.id=$2
        LEFT JOIN public.stock_item_levels l ON l.company_id=i.company_id AND l.warehouse_id=w.id AND l.item_id=i.id
        LEFT JOIN public.fuel_tanks t ON t.company_id=w.company_id AND t.warehouse_id=w.id
        WHERE i.company_id=$1 AND i.id=$3 AND i.is_active`,[actor.companyId,input.warehouseId,i.itemId]);
      const row=result.rows[0]; if(!row || (row.tank_item && row.tank_item!==i.itemId)) return {outcome:"NOT_FOUND",message:"Artikal ne postoji u skladištu."};
      const quantity=toThousandths(i.quantity),balance=toThousandths(row.balance);
      if(quantity>balance) return {outcome:"CONFLICT",code:"STOCK_INSUFFICIENT",message:"Nema dovoljno zaliha."};
      if(row.unknown || row.value===null || row.inqty===null) return {outcome:"VALIDATION_FAILED",message:"Prosječna cijena nije poznata; prvo unesite cijenu prijema."};
      const incoming=toThousandths(row.inqty), value=BigInt(row.value);
      const amount=averageIssueCostCents(value,incoming,quantity); if(amount===null) return {outcome:"VALIDATION_FAILED",message:"Prosječna cijena nije poznata."};
      const unitPrice=(value*1000n+incoming/2n)/incoming;
      total+=amount; if(total>9223372036854775807n || unitPrice>9223372036854775807n) return {outcome:"VALIDATION_FAILED",message:"Vrijednost prelazi dozvoljeni opseg."};
      lines.push({itemId:i.itemId,quantity:i.quantity,amount,unitPrice,below:balance-quantity<toThousandths(row.minimum)});
    }
    const id=uid("mi"), date=input.issuedAt.slice(0,10);
    await client.query(`INSERT INTO public.material_issues(id,company_id,warehouse_id,project_id,phase_id,issued_to_worker_id,issued_at,currency_code,note,created_by,client_generated_id,request_hash,below_minimum)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,actor.companyId,input.warehouseId,project,input.phaseId ?? null,input.issuedToWorkerId ?? null,input.issuedAt,currency,input.note?.trim() ?? null,actor.userId,input.clientGeneratedId ?? null,input.clientGeneratedId ? requestHash : null,lines.some(l=>l.below)]);
    const issueItems:Array<{id:string;line:IssueLine}>=[];
    for(const line of lines) {
      const movement=uid("stm"), lineId=uid("mii");
      await client.query(`INSERT INTO public.stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,unit_cost_cents,amount_cents,occurred_on,source_type,source_id,created_by)
        VALUES ($1,$2,$3,$4,'OUT',$5,$6,$7,$8::date,'MATERIAL_ISSUE',$9,$10)`,[movement,actor.companyId,line.itemId,input.warehouseId,line.quantity,line.unitPrice.toString(),line.amount.toString(),date,id,actor.userId]);
      await client.query(`INSERT INTO public.material_issue_items(id,company_id,issue_id,item_id,quantity,amount_cents,movement_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [lineId,actor.companyId,id,line.itemId,line.quantity,line.amount.toString(),movement]);
      issueItems.push({id:lineId,line});
    }
    await ensureCostCategories(client,actor.companyId,actor.userId);
    const cat=await client.query<{id:string}>("SELECT id FROM public.cost_categories WHERE company_id=$1 AND code='MATERIJAL' AND is_active",[actor.companyId]);
    if(!cat.rows[0]) throw Error("COST_CATEGORY_MISSING");
    const categoryId=cat.rows[0].id;
    await postCost(client,{companyId:actor.companyId,projectId:project,phaseId:input.phaseId ?? null,categoryId,sourceType:"PURCHASE",sourceId:id,
      occurredOn:date,amountCents:total,currency,actorId:actor.userId,entryKind:project ? "CHARGE" : "OVERHEAD",note:input.note?.trim() ?? null});
    let offset=0n;
    if(project) for(const part of issueItems) offset+=await reclassify(client,actor,{issueItemId:part.id,itemId:part.line.itemId,projectId:project,quantity:part.line.quantity,date,currency,warehouseId:input.warehouseId});
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"purchase.material_issued",entityType:"material_issue",entityId:id,retentionClass:"FINANCIAL",metadata:{projectId:project,amountCents:total.toString(),offsetCents:offset.toString()}});
    return {outcome:"OK",data:{id,amountCents:total.toString(),offsetCents:offset.toString(),belowMinimum:lines.some(l=>l.below)}};
  });
}
