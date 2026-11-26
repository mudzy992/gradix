import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { toThousandths } from "@gradix/domain";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import type { ServiceActor } from "./service-order-types";

export type WarehouseResult<T> = { outcome: "OK"; data: T } | { outcome: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT"; message: string; code?: string };
const uid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`;
const noRole = { outcome: "FORBIDDEN", message: "Nemate pravo upravljanja zalihama." } as const;
export const balanceExpression = `COALESCE(sum(CASE WHEN kind='IN' THEN quantity WHEN kind='OUT' THEN -quantity WHEN kind='COUNT' AND NOT legacy_ignored THEN quantity ELSE 0 END),0)`;

/** Sve izmjene i popis koriste identičan pokušaj transakcijske brave, bez čekanja. */
export async function lockWarehouse(client: PoolClient, company: string, warehouse: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_xact_lock(hashtextextended($1 || ':' || $2,0)) AS locked", [company, warehouse],
  );
  return result.rows[0]?.locked === true;
}

export function validQuantity(value: string, allowZero = false): boolean {
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(value)) return false;
  try { return allowZero ? toThousandths(value) >= 0n : toThousandths(value) > 0n; } catch { return false; }
}

export async function listWarehouses(pool: Pool, actor: ServiceActor): Promise<WarehouseResult<unknown[]>> {
  if (!can(actor.roles, "stock.view")) return noRole;
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const rows = await client.query(
      `SELECT id,code,name,kind,project_id,address,is_active FROM public.warehouses
        WHERE company_id=$1 ORDER BY kind,code`, [actor.companyId],
    );
    return { outcome: "OK", data: rows.rows };
  });
}

export type WarehouseInput = { code: string; name: string; kind: "SITE"; projectId: string; address?: string | null };
export async function createWarehouse(pool: Pool, actor: ServiceActor, input: WarehouseInput): Promise<WarehouseResult<{ id: string }>> {
  if (!can(actor.roles, "stock.manage")) return noRole;
  if (!input.code.trim() || !input.name.trim() || !input.projectId.trim()) return { outcome: "VALIDATION_FAILED", message: "Šifra, naziv i projekat su obavezni." };
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const project = await client.query("SELECT id FROM public.projects WHERE company_id=$1 AND id=$2", [actor.companyId, input.projectId]);
    if (!project.rowCount) return { outcome: "NOT_FOUND", message: "Projekat ne postoji." };
    const id = uid("wh");
    const result = await client.query(
      `INSERT INTO public.warehouses(id,company_id,code,name,kind,project_id,address)
       VALUES ($1,$2,$3,$4,'SITE',$5,$6) ON CONFLICT (company_id,code) DO NOTHING RETURNING id`,
      [id, actor.companyId, input.code.trim(), input.name.trim(), input.projectId, input.address ?? null],
    );
    return result.rowCount ? { outcome: "OK", data: { id } } : { outcome: "CONFLICT", message: "Šifra skladišta već postoji." };
  });
}

export async function patchWarehouse(pool: Pool, actor: ServiceActor, id: string, input: { name?: string; address?: string | null; isActive?: boolean }): Promise<WarehouseResult<{ id: string }>> {
  if (!can(actor.roles, "stock.manage")) return noRole;
  if (input.name !== undefined && !input.name.trim()) return { outcome: "VALIDATION_FAILED", message: "Naziv skladišta je obavezan." };
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const updated = await client.query(
      `UPDATE public.warehouses SET name=COALESCE($3,name),address=CASE WHEN $4 THEN $5 ELSE address END,
              is_active=COALESCE($6,is_active),updated_at=clock_timestamp()
        WHERE company_id=$1 AND id=$2 AND kind='SITE' RETURNING id`,
      [actor.companyId, id, input.name?.trim() ?? null, input.address !== undefined, input.address ?? null, input.isActive ?? null],
    );
    return updated.rowCount ? { outcome: "OK", data: { id } } : { outcome: "NOT_FOUND", message: "Skladište ne postoji ili se održava kroz cisternu." };
  });
}

export async function stockBalance(pool: Pool, actor: ServiceActor, filters: { warehouseId?: string; itemId?: string; belowMinimum?: boolean }): Promise<WarehouseResult<unknown[]>> {
  if (!can(actor.roles, "stock.view")) return noRole;
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const rows = await client.query(
      `SELECT w.id AS warehouse_id,w.name AS warehouse_name,i.id AS item_id,i.code,i.name,i.unit,
          COALESCE(l.min_quantity,0)::text AS min_quantity,l.max_quantity::text,
          COALESCE(b.balance,0)::text AS on_hand,(COALESCE(b.balance,0)<COALESCE(l.min_quantity,0)) AS below_minimum
         FROM public.warehouses w CROSS JOIN public.stock_items i
         LEFT JOIN public.fuel_tanks t ON t.company_id=w.company_id AND t.warehouse_id=w.id
         LEFT JOIN public.stock_item_levels l ON l.company_id=w.company_id AND l.warehouse_id=w.id AND l.item_id=i.id
         LEFT JOIN LATERAL (SELECT ${balanceExpression} AS balance FROM public.stock_movements
           WHERE company_id=w.company_id AND warehouse_id=w.id AND item_id=i.id) b ON true
        WHERE w.company_id=$1 AND i.company_id=$1 AND w.is_active AND i.is_active
          AND (w.kind <> 'TANK' OR t.fuel_item_id=i.id)
          AND ($2::text IS NULL OR w.id=$2) AND ($3::text IS NULL OR i.id=$3)
          AND (NOT $4::boolean OR COALESCE(b.balance,0)<COALESCE(l.min_quantity,0))
        ORDER BY w.code,i.code LIMIT 1000`,
      [actor.companyId, filters.warehouseId ?? null, filters.itemId ?? null, filters.belowMinimum ?? false],
    );
    return { outcome: "OK", data: rows.rows };
  });
}

export async function setStockLevel(pool: Pool, actor: ServiceActor, item: string, input: { warehouseId: string; minQuantity: string; maxQuantity?: string | null }): Promise<WarehouseResult<{ id: string }>> {
  if (!can(actor.roles, "stock.manage")) return noRole;
  if (!validQuantity(input.minQuantity, true) || (input.maxQuantity != null && (!validQuantity(input.maxQuantity, true) || toThousandths(input.maxQuantity) < toThousandths(input.minQuantity)))) return { outcome: "VALIDATION_FAILED", message: "Nivoi nisu validni." };
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const refs = await client.query(`SELECT 1 FROM public.stock_items i JOIN public.warehouses w ON w.company_id=i.company_id
       LEFT JOIN public.fuel_tanks t ON t.company_id=w.company_id AND t.warehouse_id=w.id
       WHERE i.company_id=$1 AND i.id=$2 AND w.id=$3 AND i.is_active AND w.is_active
         AND (w.kind<>'TANK' OR t.fuel_item_id=i.id)`, [actor.companyId,item,input.warehouseId]);
    if (!refs.rowCount) return { outcome: "NOT_FOUND", message: "Artikal ili skladište ne postoji." };
    const rows = await client.query<{ id: string }>(
      `INSERT INTO public.stock_item_levels(id,company_id,item_id,warehouse_id,min_quantity,max_quantity)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (company_id,item_id,warehouse_id)
       DO UPDATE SET min_quantity=EXCLUDED.min_quantity,max_quantity=EXCLUDED.max_quantity RETURNING id`,
      [uid("lvl"),actor.companyId,item,input.warehouseId,input.minQuantity,input.maxQuantity ?? null],
    );
    return { outcome: "OK", data: { id: rows.rows[0]!.id } };
  });
}

export async function transferStock(pool: Pool, actor: ServiceActor, input: { fromWarehouseId: string; toWarehouseId: string; itemId: string; quantity: string; occurredOn: string }): Promise<WarehouseResult<{ transferId: string; belowMinimum: boolean }>> {
  if (!can(actor.roles, "stock.manage")) return noRole;
  if (input.fromWarehouseId === input.toWarehouseId || !validQuantity(input.quantity)) return { outcome: "VALIDATION_FAILED", message: "Skladišta i količina nisu validni." };
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    const refs = await client.query(
      `SELECT w.id FROM public.warehouses w JOIN public.stock_items i ON i.company_id=w.company_id
        WHERE w.company_id=$1 AND w.id=ANY($2::text[]) AND w.is_active AND i.id=$3 AND i.is_active`,
      [actor.companyId,[input.fromWarehouseId,input.toWarehouseId],input.itemId],
    );
    if (refs.rowCount !== 2) return { outcome: "NOT_FOUND", message: "Artikal ili skladište ne postoji." };
    for (const id of [input.fromWarehouseId,input.toWarehouseId].sort()) {
      if (!await lockWarehouse(client, actor.companyId, id)) return { outcome: "CONFLICT", code: "STOCK_COUNT_IN_PROGRESS", message: "Popis ili kretnja su u toku." };
    }
    const aggregate = await client.query<{ balance: string; unit_cost: string | null; amount: string | null; minimum: string }>(
      `SELECT ${balanceExpression}::text AS balance,
         CASE WHEN count(*) FILTER(WHERE kind='IN' AND amount_cents IS NULL)>0 OR sum(quantity) FILTER(WHERE kind='IN') IS NULL
           THEN NULL ELSE round(sum(amount_cents) FILTER(WHERE kind='IN') / sum(quantity) FILTER(WHERE kind='IN'))::text END AS unit_cost,
         CASE WHEN count(*) FILTER(WHERE kind='IN' AND amount_cents IS NULL)>0 OR sum(quantity) FILTER(WHERE kind='IN') IS NULL
           THEN NULL ELSE round(sum(amount_cents) FILTER(WHERE kind='IN') * $4::numeric / sum(quantity) FILTER(WHERE kind='IN'))::text END AS amount,
         COALESCE((SELECT min_quantity FROM public.stock_item_levels l WHERE l.company_id=$1 AND l.warehouse_id=$2 AND l.item_id=$3),0)::text AS minimum
       FROM public.stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3`,
      [actor.companyId,input.fromWarehouseId,input.itemId,input.quantity],
    );
    const row = aggregate.rows[0]!;
    if (toThousandths(row.balance) < toThousandths(input.quantity)) return { outcome: "CONFLICT", code: "STOCK_INSUFFICIENT", message: "Nema dovoljno zaliha." };
    const tanks = await client.query<{ warehouse_id: string; fuel_item_id: string; capacity_l: string; balance: string }>(
      `SELECT t.warehouse_id,t.fuel_item_id,t.capacity_l::text,
         (SELECT ${balanceExpression}::text FROM public.stock_movements
           WHERE company_id=t.company_id AND warehouse_id=t.warehouse_id AND item_id=t.fuel_item_id) AS balance
        FROM public.fuel_tanks t WHERE t.company_id=$1 AND t.warehouse_id=ANY($2::text[])`,
      [actor.companyId,[input.fromWarehouseId,input.toWarehouseId]],
    );
    for (const tank of tanks.rows) {
      if (tank.fuel_item_id !== input.itemId) return { outcome: "VALIDATION_FAILED", message: "U cisternu se može prenijeti samo gorivo." };
      if (tank.warehouse_id === input.toWarehouseId && toThousandths(tank.balance) + toThousandths(input.quantity) > toThousandths(tank.capacity_l)) {
        return { outcome: "VALIDATION_FAILED", message: "Količina premašuje kapacitet cisterne." };
      }
    }
    const id = uid("trf");
    for (const [warehouse, kind] of [[input.fromWarehouseId,"OUT"],[input.toWarehouseId,"IN"]] as const) {
      await client.query(
        `INSERT INTO public.stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,unit_cost_cents,occurred_on,transfer_id,created_by,amount_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11)`,
        [uid("stm"),actor.companyId,input.itemId,warehouse,kind,input.quantity,row.unit_cost,input.occurredOn,id,actor.userId,row.amount],
      );
    }
    await writeAudit(client, {
      companyId: actor.companyId, actorId: actor.userId, actorEmail: null, action: "stock.transfer_created",
      entityType: "stock_transfer", entityId: id, retentionClass: "FINANCIAL",
      metadata: { itemId: input.itemId, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, quantity: input.quantity },
    });
    return { outcome: "OK", data: { transferId: id, belowMinimum: toThousandths(row.balance) - toThousandths(input.quantity) < toThousandths(row.minimum) } };
  });
}
