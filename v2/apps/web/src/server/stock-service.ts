/**
 * F8 — minimalno skladište dijelova.
 *
 * Jedno pravilo nosi cijeli modul: **stanje je `SUM(stock_movements)`, nikad `UPDATE quantity`**
 * (spec 09 §1.3/14). Zato `stock_items` NEMA kolonu stanja. Zaliha je izvod iz dokumenata —
 * kad se pojavi razlika, vidi se KOJA kretnja je pogrešna, a ne samo da broj ne valja.
 *
 * F10 uvodi više skladišta; starim pozivima bez warehouseId koristi se Centralno.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  formatHundredths,
  formatThousandths,
  isBelowMinimum,
  stockOnHand,
  toHundredths,
  toThousandths,
} from "@gradix/domain";
import { can } from "./permissions";
import { companyToday } from "./project-service";
import type { ServiceActor } from "./service-order-types";

export type StockItemRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category_id: string | null;
  min_quantity: string;
  on_hand: string;
  below_minimum: boolean;
  last_unit_cost_amount: string | null;
  is_active: boolean;
  note: string | null;
};

export type StockMovementRow = {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  kind: string;
  quantity: string;
  unit_cost_amount: string | null;
  occurred_on: string;
  source_type: string | null;
  source_id: string | null;
  note: string | null;
  created_by_name: string | null;
};

/**
 * Stanje se računa u SQL-u (`SUM` sa znakom po tipu kretnje) da bi lista artikala bila JEDAN upit.
 * Ista formula postoji i u domeni (`stockOnHand`) za testove i za klijenta — dvije verzije iste
 * formule provjerava test u domeni.
 */
const ON_HAND_SQL = `COALESCE((
  SELECT SUM(CASE WHEN sm.kind = 'IN' THEN sm.quantity
                  WHEN sm.kind = 'OUT' THEN -sm.quantity
                  WHEN sm.kind = 'COUNT' AND NOT sm.legacy_ignored THEN sm.quantity
                  ELSE 0 END)
    FROM public.stock_movements sm
   WHERE sm.company_id = i.company_id AND sm.item_id = i.id
     AND sm.warehouse_id = (SELECT w.id FROM public.warehouses w WHERE w.company_id=i.company_id AND w.kind='CENTRAL')
), 0)`;

export async function listStockItems(
  pool: Pool,
  actor: ServiceActor,
  filters: { belowMinimumOnly?: boolean; search?: string } = {},
): Promise<StockItemRow[]> {
  if (!can(actor.roles, "stock.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const conditions = ["i.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    if (filters.search) {
      conditions.push(`(i.code ILIKE $2 OR i.name ILIKE $2)`);
      params.push(`%${filters.search}%`);
    }
    const result = await client.query<{
      id: string;
      code: string;
      name: string;
      unit: string;
      category_id: string | null;
      min_quantity: string;
      on_hand: string;
      last_unit_cost_cents: string | null;
      is_active: boolean;
      note: string | null;
    }>(
      `SELECT i.id, i.code, i.name, i.unit, i.category_id,
              COALESCE((SELECT l.min_quantity FROM public.stock_item_levels l JOIN public.warehouses w
                ON w.company_id=l.company_id AND w.id=l.warehouse_id
                WHERE l.company_id=i.company_id AND l.item_id=i.id AND w.kind='CENTRAL'),i.min_quantity)::text AS min_quantity,
              ${ON_HAND_SQL}::text AS on_hand,
              (SELECT sm.unit_cost_cents::text FROM public.stock_movements sm
                WHERE sm.company_id = i.company_id AND sm.item_id = i.id
                  AND sm.unit_cost_cents IS NOT NULL
                ORDER BY sm.occurred_on DESC, sm.created_at DESC LIMIT 1) AS last_unit_cost_cents,
              i.is_active, i.note
         FROM public.stock_items i
        WHERE ${conditions.join(" AND ")}
        ORDER BY i.is_active DESC, i.code`,
      params,
    );
    return result.rows
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        unit: row.unit,
        category_id: row.category_id,
        min_quantity: row.min_quantity,
        on_hand: row.on_hand,
        below_minimum: isBelowMinimum(row.on_hand, row.min_quantity),
        last_unit_cost_amount:
          row.last_unit_cost_cents === null ? null : formatHundredths(BigInt(row.last_unit_cost_cents)),
        is_active: row.is_active,
        note: row.note,
      }))
      .filter((row) => !filters.belowMinimumOnly || row.below_minimum);
  });
}

export type StockItemInput = {
  code?: string;
  name?: string;
  unit?: string;
  categoryId?: string | null;
  minQuantity?: string;
  isActive?: boolean;
  note?: string | null;
};

export async function saveStockItem(
  pool: Pool,
  actor: ServiceActor,
  itemId: string | null,
  input: StockItemInput,
): Promise<{ outcome: "OK"; id: string } | { outcome: "FORBIDDEN" } | { outcome: "NOT_FOUND" } | { outcome: "VALIDATION_FAILED"; message: string }> {
  if (!can(actor.roles, "stock.manage")) return { outcome: "FORBIDDEN" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (itemId) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM public.stock_items WHERE company_id = $1 AND id = $2",
        [actor.companyId, itemId],
      );
      if (!existing.rows[0]) return { outcome: "NOT_FOUND" as const };
      if (input.minQuantity !== undefined) {
        const max = await client.query<{ max_quantity: string | null }>(`SELECT l.max_quantity::text FROM public.stock_item_levels l
          JOIN public.warehouses w ON w.company_id=l.company_id AND w.id=l.warehouse_id
          WHERE l.company_id=$1 AND l.item_id=$2 AND w.kind='CENTRAL'`, [actor.companyId,itemId]);
        if (max.rows[0]?.max_quantity != null && toThousandths(input.minQuantity) > toThousandths(max.rows[0].max_quantity)) {
          return { outcome: "VALIDATION_FAILED" as const, message: "Minimum ne može biti veći od maksimuma centralnog skladišta." };
        }
      }
      /* Namjerno NEMA `on_hand`/`quantity` u SET-u: stanje se mijenja ISKLJUČIVO kretnjom. */
      await client.query(
        `UPDATE public.stock_items
            SET code = COALESCE($3, code),
                name = COALESCE($4, name),
                unit = COALESCE($5, unit),
                category_id = COALESCE($6, category_id),
                min_quantity = COALESCE($7, min_quantity),
                is_active = COALESCE($8, is_active),
                note = COALESCE($9, note),
                updated_by = $10,
                updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [
          actor.companyId,
          itemId,
          input.code ?? null,
          input.name ?? null,
          input.unit ?? null,
          input.categoryId ?? null,
          input.minQuantity ?? null,
          input.isActive ?? null,
          input.note ?? null,
          actor.userId,
        ],
      );
      if (input.minQuantity !== undefined) await client.query(`INSERT INTO public.stock_item_levels(id,company_id,item_id,warehouse_id,min_quantity)
        SELECT $1,$2,$3,w.id,$4 FROM public.warehouses w WHERE w.company_id=$2 AND w.kind='CENTRAL'
        ON CONFLICT (company_id,item_id,warehouse_id) DO UPDATE SET min_quantity=EXCLUDED.min_quantity`,
      [`lvl_${randomUUID().replace(/-/g, "")}`,actor.companyId,itemId,input.minQuantity]);
      return { outcome: "OK" as const, id: itemId };
    }
    if (!input.code || !input.name) {
      return { outcome: "VALIDATION_FAILED" as const, message: "code i name su obavezni." };
    }
    const id = `sti_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    try {
      await client.query(
        `INSERT INTO public.stock_items
           (id, company_id, code, name, unit, category_id, min_quantity, is_active, note,
            created_by, updated_by)
         VALUES ($1,$2,$3,$4,COALESCE($5,'kom'),$6,COALESCE($7,0),COALESCE($8,true),$9,$10,$10)`,
        [
          id,
          actor.companyId,
          input.code,
          input.name,
          input.unit ?? null,
          input.categoryId ?? null,
          input.minQuantity ?? null,
          input.isActive ?? null,
          input.note ?? null,
          actor.userId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return {
          outcome: "VALIDATION_FAILED" as const,
          message: "Artikal sa tom šifrom već postoji u firmi.",
        };
      }
      throw error;
    }
    await client.query(`INSERT INTO public.stock_item_levels(id,company_id,item_id,warehouse_id,min_quantity)
      SELECT $1,$2,$3,w.id,i.min_quantity FROM public.warehouses w JOIN public.stock_items i ON i.company_id=w.company_id
      WHERE w.company_id=$2 AND w.kind='CENTRAL' AND i.id=$3`,
    [`lvl_${randomUUID().replace(/-/g, "")}`,actor.companyId,id]);
    return { outcome: "OK" as const, id };
  });
}

export async function listStockMovements(
  pool: Pool,
  actor: ServiceActor,
  filters: { itemId?: string; limit?: number } = {},
): Promise<StockMovementRow[]> {
  if (!can(actor.roles, "stock.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const conditions = ["sm.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    if (filters.itemId) {
      conditions.push("sm.item_id = $2");
      params.push(filters.itemId);
    }
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
    const result = await client.query<StockMovementRow & { unit_cost_cents: string | null }>(
      `SELECT sm.id, sm.item_id, i.code AS item_code, i.name AS item_name, sm.kind,
              sm.quantity::text, sm.unit_cost_cents::text, sm.occurred_on::text,
              sm.source_type, sm.source_id, sm.note,
              CASE WHEN u.id IS NULL THEN NULL
                   ELSE btrim(u.first_name || ' ' || u.last_name) END AS created_by_name
         FROM public.stock_movements sm
         JOIN public.stock_items i ON i.company_id = sm.company_id AND i.id = sm.item_id
         LEFT JOIN public.users u ON u.id = sm.created_by
        WHERE ${conditions.join(" AND ")}
        ORDER BY sm.occurred_on DESC, sm.created_at DESC
        LIMIT ${limit}`,
      params,
    );
    return result.rows.map((row) => ({
      ...row,
      unit_cost_amount:
        row.unit_cost_cents === null ? null : formatHundredths(BigInt(row.unit_cost_cents)),
    }));
  });
}

export type StockMovementInput = {
  itemId: string;
  warehouseId?: string;
  kind: "IN" | "OUT" | "COUNT";
  quantity: string;
  unitCostAmount?: string | null;
  occurredOn?: string;
  note?: string | null;
};

/**
 * Ručna kretnja. `COUNT` je potpisana razlika izbrojanog i trenutnog stanja; uz kretnju
 * nastaje i nepromjenjiv dokument popisa, a ne paralelno stanje.
 */
export async function recordStockMovement(
  pool: Pool,
  actor: ServiceActor,
  input: StockMovementInput,
): Promise<{ outcome: "OK"; id: string; onHand: string; belowMinimum: boolean } | { outcome: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT"; message?: string; code?: string }> {
  if (!can(actor.roles, "stock.manage")) return { outcome: "FORBIDDEN" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const item = await client.query<{ min_quantity: string; warehouse_id: string; tank_item: string | null; capacity_l: string | null }>(
      `SELECT COALESCE(l.min_quantity,CASE WHEN w.kind='CENTRAL' THEN i.min_quantity ELSE 0 END)::text AS min_quantity,
              w.id AS warehouse_id,t.fuel_item_id AS tank_item,t.capacity_l::text AS capacity_l
         FROM public.stock_items i JOIN public.warehouses w ON w.company_id=i.company_id
         LEFT JOIN public.stock_item_levels l ON l.company_id=i.company_id AND l.item_id=i.id AND l.warehouse_id=w.id
         LEFT JOIN public.fuel_tanks t ON t.company_id=w.company_id AND t.warehouse_id=w.id
        WHERE i.company_id=$1 AND i.id=$2 AND i.is_active AND w.is_active
          AND (w.id=$3 OR ($3::text IS NULL AND w.kind='CENTRAL'))`,
      [actor.companyId, input.itemId, input.warehouseId ?? null],
    );
    if (!item.rows[0]) return { outcome: "NOT_FOUND" as const, message: "Artikal ili skladište ne postoji." };
    if (item.rows[0].tank_item && item.rows[0].tank_item !== input.itemId) return { outcome: "VALIDATION_FAILED", message: "U cisterni se može voditi samo gorivo." };
    const warehouseId = item.rows[0].warehouse_id;
    let quantity = input.quantity;
    try {
      /* Količina je na TRI decimale (metar, kilogram, litar) — `10.500` je ispravno, a
         `toHundredths` bi ga odbio jer je namijenjen novcu. */
      toThousandths(quantity);
    } catch {
      return { outcome: "VALIDATION_FAILED" as const, message: "Količina mora biti broj." };
    }
    const onDate = input.occurredOn ?? (await companyToday(client, toCompanyId(actor.companyId)));
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0)) AS locked`, [actor.companyId, warehouseId],
    );
    if (!lock.rows[0]?.locked) return { outcome: "CONFLICT", code: "STOCK_COUNT_IN_PROGRESS", message: "Popis ili kretnja su u toku." };
    if (item.rows[0].capacity_l && (input.kind === "IN" || input.kind === "COUNT")) {
      const newLevel = input.kind === "COUNT" ? toThousandths(quantity) : toThousandths(await currentOnHand(client, actor.companyId, input.itemId, warehouseId)) + toThousandths(quantity);
      if (newLevel > toThousandths(item.rows[0].capacity_l)) return { outcome: "VALIDATION_FAILED", message: "Količina premašuje kapacitet cisterne." };
    }

    if (input.kind === "COUNT") {
      if (input.note && input.note.trim().length < 3) return { outcome: "VALIDATION_FAILED", message: "Razlog mora imati najmanje tri znaka." };
      if (toThousandths(quantity) < 0n) return { outcome: "VALIDATION_FAILED", message: "Izbrojana količina ne može biti negativna." };
      const current = await currentOnHand(client, actor.companyId, input.itemId, warehouseId);
      const difference = toThousandths(quantity) - toThousandths(current);
      if (difference === 0n) {
        return {
          outcome: "VALIDATION_FAILED" as const,
          message: "Izbrojano stanje je jednako stanju po kretnjama — popis ne mijenja ništa.",
        };
      }
      const valuation = await client.query<{ needs_reason: boolean }>(
        `SELECT (CASE WHEN count(*) FILTER (WHERE m.kind='IN' AND m.amount_cents IS NULL)>0
                   OR COALESCE(sum(m.quantity) FILTER (WHERE m.kind='IN'),0)=0 THEN true
                 ELSE round(abs($3::numeric) * sum(m.amount_cents) FILTER (WHERE m.kind='IN') /
                   sum(m.quantity) FILTER (WHERE m.kind='IN')) > c.stock_count_tolerance_cents END) AS needs_reason
           FROM public.companies c JOIN public.warehouses w ON w.company_id=c.id AND w.id=$4
           LEFT JOIN public.stock_movements m ON m.company_id=c.id AND m.warehouse_id=w.id AND m.item_id=$2
          WHERE c.id=$1 GROUP BY c.stock_count_tolerance_cents`,
        [actor.companyId, input.itemId, formatThousandths(difference), warehouseId],
      );
      if (valuation.rows[0]?.needs_reason && (!input.note || input.note.trim().length < 3)) {
        return { outcome: "VALIDATION_FAILED", message: "Razlika iznad tolerancije ili bez cijene traži razlog." };
      }
      const countId = `cnt_${randomUUID().replace(/-/g, "")}`;
      await client.query(`INSERT INTO public.stock_counts(id,company_id,warehouse_id,reason,created_by) VALUES ($1,$2,$3,$4,$5)`,
        [countId,actor.companyId,warehouseId,input.note?.trim() || null,actor.userId]);
      await client.query(`INSERT INTO public.stock_count_items(id,company_id,count_id,item_id,counted_quantity,system_quantity,difference)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [`cni_${randomUUID().replace(/-/g, "")}`,actor.companyId,countId,input.itemId,input.quantity,current,formatThousandths(difference)]);
      quantity = formatThousandths(difference);
      const moved = await insertMovement(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        itemId: input.itemId,
        kind: "COUNT",
        quantity,
        sourceId: countId,
        warehouseId,
        unitCostAmount: input.unitCostAmount ?? null,
        occurredOn: onDate,
        note: `Popis: izbrojano ${input.quantity}${input.note ? ` — ${input.note}` : ""}`.slice(0, 1000),
      });
      await client.query("UPDATE public.stock_counts SET status='APPLIED',applied_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,countId]);
      if (item.rows[0].tank_item) await client.query("UPDATE public.fuel_tanks SET last_count_at=clock_timestamp(),updated_at=clock_timestamp() WHERE company_id=$1 AND warehouse_id=$2",[actor.companyId,warehouseId]);
      const after = await currentOnHand(client, actor.companyId, input.itemId, warehouseId);
      return {
        outcome: "OK" as const,
        id: moved,
        onHand: after,
        belowMinimum: isBelowMinimum(after, item.rows[0].min_quantity),
      };
    }

    if ((input.kind !== "IN" && input.kind !== "OUT") || toThousandths(quantity) <= 0n) {
      return { outcome: "VALIDATION_FAILED", message: "Smjer i količina kretnje nisu validni." };
    }
    if (input.kind === "OUT" && toThousandths(await currentOnHand(client, actor.companyId, input.itemId, warehouseId)) < toThousandths(quantity)) {
      return { outcome: "CONFLICT", code: "STOCK_INSUFFICIENT", message: "Nema dovoljno zaliha." };
    }
    const id = await insertMovement(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      itemId: input.itemId,
      kind: input.kind,
      quantity,
      warehouseId,
      unitCostAmount: input.unitCostAmount ?? null,
      occurredOn: onDate,
      note: input.note ?? null,
    });
    const after = await currentOnHand(client, actor.companyId, input.itemId, warehouseId);
    return {
      outcome: "OK" as const,
      id,
      onHand: after,
      belowMinimum: isBelowMinimum(after, item.rows[0].min_quantity),
    };
  });
}

export async function currentOnHand(
  client: PoolClient,
  companyId: string,
  itemId: string,
  warehouseId?: string,
): Promise<string> {
  const result = await client.query<{ on_hand: string }>(
    `SELECT COALESCE(sum(CASE WHEN sm.kind='IN' THEN sm.quantity WHEN sm.kind='OUT' THEN -sm.quantity
                   WHEN sm.kind='COUNT' AND NOT sm.legacy_ignored THEN sm.quantity ELSE 0 END),0)::text AS on_hand
       FROM public.stock_movements sm JOIN public.warehouses w ON w.company_id=sm.company_id AND w.id=sm.warehouse_id
      WHERE sm.company_id=$1 AND sm.item_id=$2 AND (w.id=$3 OR ($3::text IS NULL AND w.kind='CENTRAL'))`,
    [companyId, itemId, warehouseId ?? null],
  );
  return result.rows[0]?.on_hand ?? "0";
}

export async function insertMovement(
  client: PoolClient,
  params: {
    companyId: string;
    actorId: string;
    itemId: string;
    kind: "IN" | "OUT" | "COUNT";
    quantity: string;
    warehouseId?: string;
    sourceId?: string;
    unitCostAmount: string | null;
    occurredOn: string;
    note: string | null;
  },
): Promise<string> {
  const id = `stm_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await client.query(
    `INSERT INTO public.stock_movements
       (id, company_id, item_id, kind, quantity, unit_cost_cents, occurred_on, source_type,
        source_id, note, created_by, warehouse_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$10,$11,$8,$9,$12)`,
    [
      id,
      params.companyId,
      params.itemId,
      params.kind,
      params.quantity,
      params.unitCostAmount === null ? null : toHundredths(params.unitCostAmount).toString(),
      params.occurredOn,
      params.note,
      params.actorId,
      params.sourceId ? "COUNT" : null,
      params.sourceId ?? null,
      params.warehouseId ?? null,
    ],
  );
  return id;
}

/** Sve kretnje za jedan artikal — za prikaz „kako je stanje nastalo“ i za test `SUM`-a. */
export async function itemLedger(
  client: PoolClient,
  companyId: string,
  itemId: string,
): Promise<{ kind: string; quantity: string; legacy_ignored: boolean }[]> {
  const result = await client.query<{ kind: string; quantity: string; legacy_ignored: boolean }>(
    `SELECT kind, quantity::text, legacy_ignored FROM public.stock_movements
      WHERE company_id = $1 AND item_id = $2 ORDER BY occurred_on, created_at`,
    [companyId, itemId],
  );
  return result.rows;
}

/** Isti zbir kao u SQL-u, ali kroz domenu — koristi se u testu koji dokazuje da su jednaki. */
export function onHandFromRows(rows: { kind: string; quantity: string; legacy_ignored?: boolean }[]): string {
  return stockOnHand(
    rows.map((row) => ({
      kind: row.kind === "IN" || row.kind === "OUT" || row.kind === "TRANSFER" || row.kind === "COUNT" ? row.kind : "IN",
      quantity: row.quantity,
      legacyIgnored: row.legacy_ignored,
    })),
  );
}
