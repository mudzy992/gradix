import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { balanceExpression, lockWarehouse, validQuantity, type WarehouseResult } from "./warehouse-service";
import type { ServiceActor } from "./service-order-types";

const uid = (p: string) => `${p}_${randomUUID().replace(/-/g, "")}`;
const noRole = { outcome: "FORBIDDEN", message: "Nemate pravo upravljanja zalihama." } as const;

export async function listStockCounts(pool: Pool, actor: ServiceActor): Promise<WarehouseResult<unknown[]>> {
  if (!can(actor.roles, "stock.manage")) return noRole;
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const result = await client.query(`SELECT id,warehouse_id,status,reason,created_at::text,applied_at::text
      FROM public.stock_counts WHERE company_id=$1 ORDER BY created_at DESC LIMIT 500`, [actor.companyId]);
    return { outcome: "OK", data: result.rows };
  });
}

export async function getStockCount(pool: Pool, actor: ServiceActor, id: string): Promise<WarehouseResult<{ count: unknown; items: unknown[] }>> {
  if (!can(actor.roles, "stock.manage")) return noRole;
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const header = await client.query(`SELECT id,warehouse_id,status,reason,created_at::text,applied_at::text
      FROM public.stock_counts WHERE company_id=$1 AND id=$2`, [actor.companyId,id]);
    if (!header.rows[0]) return { outcome: "NOT_FOUND", message: "Popis ne postoji." };
    const items = await client.query(`SELECT item_id,counted_quantity::text,system_quantity::text,difference::text
      FROM public.stock_count_items WHERE company_id=$1 AND count_id=$2 ORDER BY item_id`, [actor.companyId,id]);
    return { outcome: "OK", data: { count: header.rows[0], items: items.rows } };
  });
}

export async function createStockCount(pool: Pool, actor: ServiceActor, input: {
  warehouseId: string; reason?: string | null; items: { itemId: string; countedQuantity: string }[];
}): Promise<WarehouseResult<{ id: string }>> {
  if (!can(actor.roles, "stock.manage")) return noRole;
  if (!input.items.length || input.items.length > 500 || new Set(input.items.map((item) => item.itemId)).size !== input.items.length || input.items.some((item) => !validQuantity(item.countedQuantity,true))) {
    return { outcome: "VALIDATION_FAILED", message: "Stavke popisa nisu validne." };
  }
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const warehouse = await client.query("SELECT id FROM public.warehouses WHERE company_id=$1 AND id=$2 AND is_active", [actor.companyId,input.warehouseId]);
    const items = await client.query("SELECT id FROM public.stock_items WHERE company_id=$1 AND id=ANY($2::text[]) AND is_active", [actor.companyId,input.items.map((item) => item.itemId)]);
    if (!warehouse.rowCount || items.rowCount !== input.items.length) return { outcome: "NOT_FOUND", message: "Skladište ili artikal ne postoji." };
    const id = uid("cnt");
    await client.query("INSERT INTO public.stock_counts(id,company_id,warehouse_id,reason,created_by) VALUES ($1,$2,$3,$4,$5)", [id,actor.companyId,input.warehouseId,input.reason?.trim() || null,actor.userId]);
    for (const item of input.items) await client.query(
      `INSERT INTO public.stock_count_items(id,company_id,count_id,item_id,counted_quantity) VALUES ($1,$2,$3,$4,$5)`,
      [uid("cni"),actor.companyId,id,item.itemId,item.countedQuantity],
    );
    return { outcome: "OK", data: { id } };
  });
}

export async function applyStockCount(pool: Pool, actor: ServiceActor, id: string, reason?: string | null): Promise<WarehouseResult<{ id: string; alreadyApplied: boolean }>> {
  if (!can(actor.roles, "stock.manage")) return noRole;
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const initial = await client.query<{ warehouse_id: string }>("SELECT warehouse_id FROM public.stock_counts WHERE company_id=$1 AND id=$2", [actor.companyId,id]);
    if (!initial.rows[0]) return { outcome: "NOT_FOUND", message: "Popis ne postoji." };
    const warehouse = initial.rows[0].warehouse_id;
    if (!await lockWarehouse(client,actor.companyId,warehouse)) return { outcome: "CONFLICT", code: "STOCK_COUNT_IN_PROGRESS", message: "Popis ili kretnja su u toku." };
    const header = await client.query<{ status: string; reason: string | null; tolerance: string }>(
      `SELECT s.status,s.reason,c.stock_count_tolerance_cents::text AS tolerance FROM public.stock_counts s
        JOIN public.companies c ON c.id=s.company_id WHERE s.company_id=$1 AND s.id=$2 FOR UPDATE OF s`, [actor.companyId,id],
    );
    if (!header.rows[0]) return { outcome: "NOT_FOUND", message: "Popis ne postoji." };
    if (header.rows[0].status === "APPLIED") return { outcome: "OK", data: { id, alreadyApplied: true } };
    const details = await client.query<{ id: string; item_id: string; counted: string; system: string; difference: string; unknown_price: boolean; diff_cents: string }>(
      `SELECT ci.id,ci.item_id,ci.counted_quantity::text AS counted, s.balance::text AS system,
        (ci.counted_quantity-s.balance)::text AS difference,
        (s.in_qty IS NULL OR s.unknown_price) AS unknown_price,
        COALESCE(round(abs(ci.counted_quantity-s.balance)*s.in_value/NULLIF(s.in_qty,0)),0)::text AS diff_cents
       FROM public.stock_count_items ci
       CROSS JOIN LATERAL (SELECT ${balanceExpression} AS balance,
         sum(quantity) FILTER (WHERE kind='IN') AS in_qty,
         sum(amount_cents) FILTER(WHERE kind='IN') AS in_value,
         count(*) FILTER (WHERE kind='IN' AND amount_cents IS NULL)>0 AS unknown_price
         FROM public.stock_movements WHERE company_id=$1 AND warehouse_id=$3 AND item_id=ci.item_id) s
       WHERE ci.company_id=$1 AND ci.count_id=$2 ORDER BY ci.item_id`, [actor.companyId,id,warehouse],
    );
    if (!details.rowCount) return { outcome: "VALIDATION_FAILED", message: "Popis nema stavki." };
    const affected = details.rows.filter((row) => Number(row.difference) !== 0);
    const amount = affected.reduce((sum,row) => sum+BigInt(row.diff_cents),0n);
    const explanation = reason?.trim() || header.rows[0].reason;
    if ((affected.some((row) => row.unknown_price) || amount > BigInt(header.rows[0].tolerance)) && (!explanation || explanation.length < 3)) {
      return { outcome: "VALIDATION_FAILED", message: "Razlika iznad tolerancije ili bez poznate cijene zahtijeva razlog." };
    }
    const tank = await client.query<{ fuel_item_id: string; capacity_l: string }>("SELECT fuel_item_id,capacity_l::text FROM public.fuel_tanks WHERE company_id=$1 AND warehouse_id=$2", [actor.companyId,warehouse]);
    if (tank.rows[0] && details.rows.some((row) => row.item_id !== tank.rows[0]!.fuel_item_id || Number(row.counted) > Number(tank.rows[0]!.capacity_l))) return { outcome: "VALIDATION_FAILED", message: "Neispravna količina ili artikal cisterne." };
    for (const row of details.rows) {
      await client.query("UPDATE public.stock_count_items SET system_quantity=$3,difference=$4 WHERE company_id=$1 AND id=$2", [actor.companyId,row.id,row.system,row.difference]);
      if (Number(row.difference) !== 0) await client.query(
        `INSERT INTO public.stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,occurred_on,source_type,source_id,note,created_by)
         VALUES ($1,$2,$3,$4,'COUNT',$5,current_date,'COUNT',$6,$7,$8)`,
        [uid("stm"),actor.companyId,row.item_id,warehouse,row.difference,id,explanation ?? null,actor.userId],
      );
    }
    await client.query("UPDATE public.stock_counts SET status='APPLIED',applied_at=clock_timestamp(),reason=$3 WHERE company_id=$1 AND id=$2", [actor.companyId,id,explanation ?? null]);
    if (tank.rows[0]) await client.query("UPDATE public.fuel_tanks SET last_count_at=clock_timestamp(),updated_at=clock_timestamp() WHERE company_id=$1 AND warehouse_id=$2", [actor.companyId,warehouse]);
    await writeAudit(client, {
      companyId: actor.companyId, actorId: actor.userId, actorEmail: null, action: "stock.count_applied",
      entityType: "stock_count", entityId: id, retentionClass: "FINANCIAL",
      metadata: { warehouseId: warehouse, differences: affected.length, valueCents: amount.toString(), unknownPrice: affected.some((row) => row.unknown_price) },
    });
    return { outcome: "OK", data: { id, alreadyApplied: false } };
  });
}
