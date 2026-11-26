import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import type { PurchaseActor } from "./purchase-request-service";
import type { WarehouseResult } from "./warehouse-service";

/** Sve liste su ograničene i firmom i projektnim opsegom sesije. */
export async function listMaterialIssues(pool: Pool, actor: PurchaseActor): Promise<WarehouseResult<unknown[]>> {
  if (!can(actor.roles, "purchase.view")) return {outcome:"FORBIDDEN",message:"Nemate pravo pregleda nabavke."};
  return withCompany(pool, companyId(actor.companyId), async client => {
    const result = await client.query(`SELECT i.id,i.warehouse_id,w.name AS warehouse_name,i.project_id,i.phase_id,
      i.issued_at::text,i.currency_code,i.note,i.below_minimum,
      COALESCE((SELECT sum(x.amount_cents) FROM public.material_issue_items x WHERE x.company_id=i.company_id AND x.issue_id=i.id),0)::text AS amount_cents
      FROM public.material_issues i JOIN public.warehouses w ON w.company_id=i.company_id AND w.id=i.warehouse_id
      WHERE i.company_id=$1 AND ($2::boolean OR (i.project_id=ANY($3::text[]) AND (w.kind<>'SITE' OR w.project_id=ANY($3::text[]))))
      ORDER BY i.issued_at DESC,i.id LIMIT 500`,
      [actor.companyId,actor.scope === "COMPANY",actor.scope === "PROJECTS" ? actor.projectIds ?? [] : []]);
    return {outcome:"OK",data:result.rows};
  });
}

export async function listPendingManualCosts(pool: Pool, actor: PurchaseActor, projectId?: string): Promise<WarehouseResult<unknown[]>> {
  if (!can(actor.roles, "projects.costs.view")) return {outcome:"FORBIDDEN",message:"Nemate pravo pregleda troškova."};
  return withCompany(pool, companyId(actor.companyId), async client => {
    const result = await client.query(`SELECT m.id,m.project_id,m.phase_id,m.category_id,c.name AS category_name,
      m.occurred_on::text,m.amount_cents::text,m.currency_code,m.note,m.attachment_id,m.created_at::text
      FROM public.manual_cost_requests m JOIN public.cost_categories c ON c.company_id=m.company_id AND c.id=m.category_id
      WHERE m.company_id=$1 AND m.status='PENDING' AND ($2::boolean OR m.project_id=ANY($3::text[]))
      AND ($4::text IS NULL OR m.project_id=$4) ORDER BY m.created_at DESC,m.id LIMIT 500`,
      [actor.companyId,actor.scope === "COMPANY",actor.scope === "PROJECTS" ? actor.projectIds ?? [] : [],projectId ?? null]);
    return {outcome:"OK",data:result.rows};
  });
}

/** Prijemi i stavke koriste se za izbor stvarne stavke na dobavljačkom računu. */
export async function listGoodsReceipts(pool:Pool, actor:PurchaseActor):Promise<WarehouseResult<unknown[]>> {
  if(!can(actor.roles,"purchase.view")) return {outcome:"FORBIDDEN",message:"Nemate pravo pregleda nabavke."};
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const result=await client.query(`SELECT r.id,r.order_id,r.partner_id,r.warehouse_id,r.received_at::text,r.currency_code,r.note,
      ri.id AS item_id,ri.item_id AS stock_item_id,si.name AS item_name,si.unit,ri.quantity::text,ri.amount_cents::text
      FROM public.goods_receipts r JOIN public.goods_receipt_items ri ON ri.company_id=r.company_id AND ri.receipt_id=r.id
      JOIN public.stock_items si ON si.company_id=ri.company_id AND si.id=ri.item_id
      JOIN public.warehouses w ON w.company_id=r.company_id AND w.id=r.warehouse_id
      LEFT JOIN public.purchase_orders o ON o.company_id=r.company_id AND o.id=r.order_id
      LEFT JOIN public.purchase_requests q ON q.company_id=o.company_id AND q.id=o.request_id
      WHERE r.company_id=$1 AND ($2::boolean OR ((q.project_id=ANY($3::text[]) OR (r.order_id IS NULL AND w.kind='SITE' AND w.project_id=ANY($3::text[])))
        AND (w.kind<>'SITE' OR w.project_id=ANY($3::text[]))))
      ORDER BY r.received_at DESC,r.id,ri.id LIMIT 500`,[actor.companyId,actor.scope==="COMPANY",actor.scope==="PROJECTS" ? actor.projectIds ?? [] : []]);
    return {outcome:"OK",data:result.rows};
  });
}
