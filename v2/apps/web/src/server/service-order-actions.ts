import { equipmentRecordAllowed, linkedFaultAllowed, type EquipmentActor } from "./equipment-scope";
/**
 * F8 — akcije na servisnom nalogu: početak, čekanje dijelova, završetak, utrošak, odobrenje.
 *
 * Sve ide kroz akciju, nikad kroz `PATCH { status }`. Razlog je što status nosi POSLJEDICE koje
 * moraju nastati u istoj transakciji:
 *   - `start` postavlja `started_at` (stvarni zastoj je razlika, §1.6/29);
 *   - `finish` računa trajanje, trošak, satnicu, garanciju i knjiži ledger (§1.4);
 *   - `parts` skida zalihu kretnjom i uvećava `parts_cost` (§1.3).
 * Da je `PATCH` smio pisati `DONE`, ekran bi mogao završiti nalog bez troška i bez zastoja.
 */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  ServiceError,
  averageIssueCostCents,
  assertServiceTransition,
  serviceApprovalCheck,
  formatHundredths,
  toHundredths,
  toThousandths,
  type ServiceOrderStatus,
} from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { companyToday } from "./project-service";
import { loadServiceOrder } from "./service-order-read";
import type { ServiceOutcome } from "./service-order-types";
import { orderStatus, parseExternalCost } from "./service-order-shared";
import { preparePartStock } from "./service-part-stock";

const NO_ROLE = { outcome: "FORBIDDEN" as const, code: "ROLE", message: "Nemate pravo na ovu radnju." };


export async function setStatus(
  client: PoolClient,
  params: {
    companyId: string;
    orderId: string;
    actorId: string;
    status: ServiceOrderStatus;
    extra?: { startedAt?: boolean; finishedAt?: boolean };
  },
): Promise<void> {
  /* Događaj (`service_order_events`) piše TRIGER, ne ovaj upit: prelaz se mijenja na više mjesta
     (sync, ručna ispravka), pa bi jedno od njih zaboravilo događaj. */
  const sets = ["status = $3", "updated_by = $4", "updated_at = clock_timestamp()", "version = version + 1"];
  if (params.extra?.startedAt) sets.push("started_at = COALESCE(started_at, clock_timestamp())");
  if (params.extra?.finishedAt) sets.push("finished_at = COALESCE(finished_at, clock_timestamp())");
  if (params.status === "DONE" || params.status === "CANCELLED") {
    sets.push("closed_at = COALESCE(closed_at, clock_timestamp())");
  }
  if (params.status === "IN_PROGRESS") sets.push("closed_at = NULL, finished_at = NULL");
  await client.query(
    `UPDATE public.service_orders SET ${sets.join(", ")}
      WHERE company_id = $1 AND id = $2`,
    [params.companyId, params.orderId, params.status, params.actorId],
  );
}

/* ------------------------------------------------------------------ start */

export async function startServiceOrder(
  pool: Pool,
  actor: EquipmentActor,
  orderId: string,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "service.manage")) return NO_ROLE;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentRecordAllowed(client, actor, "order", orderId)) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Nalog ne postoji." };
    const current = await orderStatus(client, actor.companyId, orderId);
    if (!current.ok) return current.result;
    try {
      assertServiceTransition(current.status, "IN_PROGRESS");
    } catch (error) {
      return transitionFailed(error);
    }
    const blocked = await approvalBlock(client, actor.companyId, orderId);
    if (blocked) return blocked;
    await setStatus(client, {
      companyId: actor.companyId,
      orderId,
      actorId: actor.userId,
      status: "IN_PROGRESS",
      extra: { startedAt: true },
    });
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "service.order_started",
      entityType: "service_order",
      entityId: orderId,
      metadata: { from: current.status },
      retentionClass: "STANDARD",
    });
    return { outcome: "OK" as const, id: orderId };
  });
}

/**
 * Odobrenje PRIJE rada (§1.5/25): iznad praga firme nalog ne prelazi u `IN_PROGRESS` dok
 * zahtjev nije odobren. Vanjski servis iznad praga traži i ponudu — bez nje odobrenje nema
 * osnova, jer se odobrava iznos koji nije ponuđen.
 */
export async function approvalBlock(
  client: PoolClient,
  companyId: string,
  orderId: string,
): Promise<ServiceOutcome | null> {
  const order = await client.query<{
    kind: string;
    status: string;
    amount_cents: string | null;
    external_quote_cents: string | null;
    threshold_cents: string;
  }>(
    `SELECT so.kind, so.status, so.amount_cents::text, so.external_quote_cents::text,
            c.service_approval_threshold_cents::text AS threshold_cents
       FROM public.service_orders so
       JOIN public.companies c ON c.id = so.company_id
      WHERE so.company_id = $1 AND so.id = $2`,
    [companyId, orderId],
  );
  const row = order.rows[0];
  if (!row) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Nalog ne postoji." };
  const planned = row.amount_cents === null ? 0n : BigInt(row.amount_cents);
  const check = serviceApprovalCheck({
    kind: row.kind === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
    plannedCostCents: planned,
    thresholdCents: BigInt(row.threshold_cents),
    externalQuoteCents: row.external_quote_cents === null ? null : BigInt(row.external_quote_cents),
  });
  if (!check.needsApproval) return null;
  if (check.needsQuote) {
    return {
      outcome: "CONFLICT",
      code: "EXTERNAL_QUOTE_REQUIRED",
      message: "Vanjski servis iznad praga traži ponudu prije odobrenja i početka rada.",
    };
  }
  const approval = await client.query<{ status: string }>(
    `SELECT status FROM public.approval_requests
      WHERE company_id = $1 AND subject_type = 'service_order' AND subject_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [companyId, orderId],
  );
  if (approval.rows[0]?.status !== "APPROVED") {
    return {
      outcome: "CONFLICT",
      code: "SERVICE_APPROVAL_REQUIRED",
      message: "Predračun je iznad praga firme — nalog treba odobrenje prije početka rada.",
    };
  }
  return null;
}

export function transitionFailed(error: unknown): ServiceOutcome {
  if (error instanceof ServiceError) {
    const conflict = error.code === "SERVICE_ALREADY_DONE" || error.code === "SERVICE_INVALID_STATUS";
    return {
      outcome: conflict ? "CONFLICT" : "VALIDATION_FAILED",
      code: error.code,
      message: error.message,
    };
  }
  throw error;
}

/* ------------------------------------------------------- čekanje dijelova */

export async function waitServiceOrderParts(
  pool: Pool,
  actor: EquipmentActor,
  orderId: string,
  note?: string | null,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "service.manage")) return NO_ROLE;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentRecordAllowed(client, actor, "order", orderId)) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Nalog ne postoji." };
    const current = await orderStatus(client, actor.companyId, orderId);
    if (!current.ok) return current.result;
    try {
      assertServiceTransition(current.status, "WAITING_PARTS");
    } catch (error) {
      return transitionFailed(error);
    }
    await setStatus(client, {
      companyId: actor.companyId,
      orderId,
      actorId: actor.userId,
      status: "WAITING_PARTS",
    });
    if (note?.trim()) {
      /* Razlog čekanja je važan za radionicu (koji dio i od koga), pa ide kao događaj sa
         napomenom — ne u `description`, koji opisuje kvar, a ne trenutno stanje. */
      await client.query(
        `INSERT INTO public.service_order_events
           (id, company_id, service_order_id, kind, actor_id, note)
         VALUES ($1,$2,$3,'PARTS_REQUESTED',$4,$5)`,
        [
          `soe_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
          actor.companyId,
          orderId,
          actor.userId,
          note.trim().slice(0, 1000),
        ],
      );
    }
    return { outcome: "OK" as const, id: orderId };
  });
}

/* ----------------------------------------------------------------- finish */

/**
 * Vanjski trošak kao centi ili `null`. Zajednički za web i sync, da oba ulaza odbiju isti tekst
 * istom greškom — inače bi telefon mogao poslati iznos koji web odbija.
 */

export type FinishInput = {
  laborHours?: string;
  externalCostAmount?: string | null;
  externalInvoiceRef?: string | null;
  warrantyUntil?: string | null;
  downtimeMinutes?: number | null;
  downtimeReason?: string | null;
};

import { finishOrderInTransaction } from "./service-order-transaction";

export { finishOrderInTransaction };

export async function finishServiceOrder(
  pool: Pool,
  actor: EquipmentActor,
  orderId: string,
  input: FinishInput,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "service.manage")) return NO_ROLE;
  let laborHours = "0";
  if (input.laborHours !== undefined) {
    try {
      toHundredths(input.laborHours);
      laborHours = input.laborHours;
    } catch {
      return {
        outcome: "VALIDATION_FAILED",
        code: "LABOR_HOURS_INVALID",
        message: "Sati mehaničara moraju biti broj sa najviše dvije decimale.",
      };
    }
  }
  const externalCents = parseExternalCost(input.externalCostAmount);
  if (externalCents === "INVALID") {
    return {
      outcome: "VALIDATION_FAILED",
      code: "EXTERNAL_COST_INVALID",
      message: "Vanjski trošak mora biti iznos sa dvije decimale.",
    };
  }

  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentRecordAllowed(client, actor, "order", orderId) || !await linkedFaultAllowed(client, actor, orderId))
      return { outcome: "NOT_FOUND" as const, code: "NOT_FOUND", message: "Nalog ne postoji." };
    return finishOrderInTransaction(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      orderId,
      laborHours,
      externalCostCents: externalCents,
      externalInvoiceRef: input.externalInvoiceRef ?? null,
      warrantyUntil: input.warrantyUntil ?? null,
      downtimeMinutes: input.downtimeMinutes ?? null,
      downtimeReason: input.downtimeReason ?? null,
    });
  });


}

/* ------------------------------------------------------------------ parts */

/**
 * Utrošak dijela: kretnja `OUT` (idempotentna po izvoru) + red u `service_order_parts` +
 * uvećan `parts_cost_cents`. Stanje se NIKAD ne piše direktno — ono je zbir kretnji.
 */
export async function addServiceOrderPart(
  pool: Pool,
  actor: EquipmentActor,
  orderId: string,
  input: { itemId: string; quantity: string; unitCostAmount?: string | null; note?: string | null },
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "service.manage")) return NO_ROLE;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentRecordAllowed(client, actor, "order", orderId)) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Nalog ne postoji." };
    const current = await orderStatus(client, actor.companyId, orderId);
    if (!current.ok) return current.result;
    if (current.status === "DONE" || current.status === "CANCELLED") {
      return {
        outcome: "CONFLICT" as const,
        code: "SERVICE_ALREADY_DONE",
        message: "Na završen ili otkazan nalog se dijelovi ne dodaju.",
      };
    }
    const partId = `sop_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const result = await recordPartUsage(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      orderId,
      itemId: input.itemId,
      quantity: input.quantity,
      unitCostAmount: input.unitCostAmount ?? null,
      note: input.note ?? null,
      partId,
    });
    if (result.outcome !== "OK") return result;
    return { outcome: "OK" as const, id: partId };
  });
}

/** Izdvojeno da mobilni sync može ponoviti istu operaciju sa istim `partId` (idempotencija). */
export async function recordPartUsage(
  client: PoolClient,
  params: {
    companyId: string;
    actorId: string;
    orderId: string;
    itemId: string;
    quantity: string;
    unitCostAmount: string | null;
    note: string | null;
    partId: string;
  },
): Promise<ServiceOutcome> {
  try {
    if (toThousandths(params.quantity) <= 0n) throw new Error("invalid quantity");
  } catch {
    return { outcome: "VALIDATION_FAILED", code: "QUANTITY_INVALID", message: "Količina mora biti pozitivan broj sa do tri decimale." };
  }
  const item = await client.query<{ unit: string }>(
    "SELECT unit FROM public.stock_items WHERE company_id = $1 AND id = $2 AND is_active",
    [params.companyId, params.itemId],
  );
  if (!item.rows[0]) {
    return { outcome: "NOT_FOUND", code: "ITEM_NOT_FOUND", message: "Artikal ne postoji ili nije aktivan." };
  }
  const stockError = await preparePartStock(client, params);
  if (stockError) return stockError;
  // Isti ulazi i ista formula kao izlaz materijala, pod već stečenom bravom skladišta.
  // Ukupnu vrijednost čuvamo odvojeno od zaokružene jedinične cijene.
  const pricing = await client.query<{qty:string|null;value:string|null;unknown:boolean}>(
    `SELECT sum(quantity)::text AS qty,sum(amount_cents)::text AS value,
            COALESCE(bool_or(amount_cents IS NULL),false) AS unknown
       FROM public.stock_movements WHERE company_id=$1 AND item_id=$2 AND kind='IN'
        AND warehouse_id=(SELECT id FROM public.warehouses WHERE company_id=$1 AND kind='CENTRAL')`,
    [params.companyId,params.itemId]);
  const price=pricing.rows[0]!;
  if (price.unknown || price.qty===null || price.value===null)
    return {outcome:"VALIDATION_FAILED",code:"STOCK_PRICE_UNKNOWN",message:"Prosječna cijena nije poznata; unesite cijenu prijema."};
  const incoming=toThousandths(price.qty), value=BigInt(price.value);
  const amount=averageIssueCostCents(value,incoming,toThousandths(params.quantity));
  if (amount===null) return {outcome:"VALIDATION_FAILED",code:"STOCK_PRICE_UNKNOWN",message:"Prosječna cijena nije poznata."};
  const unitCostCents=(value*1000n+incoming/2n)/incoming;
  if (amount>9223372036854775807n || unitCostCents>9223372036854775807n)
    return {outcome:"VALIDATION_FAILED",code:"UNIT_COST_INVALID",message:"Vrijednost dijela prelazi dozvoljeni opseg."};
  // Stari klijenti još šalju cijenu: ne smiju je tiho prepisati niti zavesti korisnika.
  if(params.unitCostAmount !== null) {
    try {
      if(toHundredths(params.unitCostAmount)!==unitCostCents)
        return {outcome:"VALIDATION_FAILED",code:"UNIT_COST_INVALID",message:"Cijena se određuje po prosječnoj nabavnoj cijeni skladišta; osvježite nalog."};
    } catch {return {outcome:"VALIDATION_FAILED",code:"UNIT_COST_INVALID",message:"Cijena dijela mora imati dvije decimale."};}
  }

  const today = await companyToday(client, toCompanyId(params.companyId));
  const movementId = `stm_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO public.stock_movements
       (id, company_id, item_id, kind, quantity, unit_cost_cents, occurred_on, source_type,
        source_id, note, created_by, amount_cents)
     VALUES ($1,$2,$3,'OUT',$4,$5,$6::date,'SERVICE_ORDER',$7,$8,$9,$10)
     ON CONFLICT (company_id, source_type, source_id, item_id) WHERE source_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      movementId,
      params.companyId,
      params.itemId,
      params.quantity,
      unitCostCents.toString(),
      today,
      `${params.orderId}:${params.partId}`,
      params.note ?? null,
      params.actorId,
      amount.toString(),
    ],
  );
  const movement = inserted.rows[0];
  if (!movement) {
    return {
      outcome: "CONFLICT",
      code: "STOCK_ALREADY_POSTED",
      message: "Taj dio je već proknjižen na nalog — zaliha nije skinuta dvaput.",
    };
  }

  await client.query(
    `INSERT INTO public.service_order_parts
       (id, company_id, service_order_id, item_id, quantity, unit_cost_cents, currency_code,
        stock_movement_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT currency FROM public.companies WHERE id = $2),$7,$8,$9)`,
    [
      params.partId,
      params.companyId,
      params.orderId,
      params.itemId,
      params.quantity,
      unitCostCents.toString(),
      movement.id,
      params.note ?? null,
      params.actorId,
    ],
  );

  /* `parts_cost` je zbir stavki — izveden iz redova, pa ga poslije svakog utroška izračunamo
     iznova. Sabiranje „trenutno + novo“ bi poslije storno-a ostavilo pogrešan zbir. */
  await client.query(
    `UPDATE public.service_orders so
        SET parts_cost_cents = src.total,
            total_cost_cents = so.labor_cost_cents + src.total + so.external_cost_cents,
            updated_at = clock_timestamp(),
            version = version + 1
       FROM (
         SELECT COALESCE(SUM(COALESCE(sm.amount_cents, round(sp.quantity * sp.unit_cost_cents))), 0)::bigint AS total
           FROM public.service_order_parts sp
           LEFT JOIN public.stock_movements sm ON sm.company_id=sp.company_id AND sm.id=sp.stock_movement_id
          WHERE sp.company_id = $1 AND sp.service_order_id = $2
       ) src
      WHERE so.company_id = $1 AND so.id = $2`,
    [params.companyId, params.orderId],
  );

  return { outcome: "OK", id: params.partId };
}

/* ------------------------------------------------------------- odobrenje */

export async function approveServiceOrder(
  pool: Pool,
  actor: EquipmentActor,
  orderId: string,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "service.approve")) return NO_ROLE;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentRecordAllowed(client, actor, "order", orderId)) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Nalog ne postoji." };
    const current = await orderStatus(client, actor.companyId, orderId);
    if (!current.ok) return current.result;
    const open = await client.query<{ id: string }>(
      `SELECT id FROM public.approval_requests
        WHERE company_id = $1 AND subject_type = 'service_order' AND subject_id = $2
          AND status = 'OPEN' LIMIT 1`,
      [actor.companyId, orderId],
    );
    if (!open.rows[0]) {
      return {
        outcome: "CONFLICT" as const,
        code: "NO_OPEN_REQUEST",
        message: "Nema otvorenog zahtjeva za odobrenje.",
      };
    }
    await client.query(
      `UPDATE public.approval_requests
          SET status = 'APPROVED', decided_by = $3, decided_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, open.rows[0].id, actor.userId],
    );
    if (current.status === "PLANNED") {
      await setStatus(client, {
        companyId: actor.companyId,
        orderId,
        actorId: actor.userId,
        status: "APPROVED",
      });
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "service.order_approved",
      entityType: "service_order",
      entityId: orderId,
      metadata: { requestId: open.rows[0].id },
      retentionClass: "FINANCIAL",
    });
    return { outcome: "OK" as const, id: orderId };
  });
}

export async function rejectServiceOrder(
  pool: Pool,
  actor: EquipmentActor,
  orderId: string,
  reason: string,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "service.approve")) return NO_ROLE;
  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "REASON_TOO_SHORT",
      message: "Razlog odbijanja mora imati najmanje 10 znakova.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentRecordAllowed(client, actor, "order", orderId)) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Nalog ne postoji." };
    const current = await orderStatus(client, actor.companyId, orderId);
    if (!current.ok) return current.result;
    if (current.status === "DONE") {
      return {
        outcome: "CONFLICT" as const,
        code: "SERVICE_ALREADY_DONE",
        message: "Završen nalog se ne odbija.",
      };
    }
    const open = await client.query<{ id: string }>(
      `SELECT id FROM public.approval_requests
        WHERE company_id = $1 AND subject_type = 'service_order' AND subject_id = $2
          AND status = 'OPEN' LIMIT 1`,
      [actor.companyId, orderId],
    );
    if (open.rows[0]) {
      await client.query(
        `UPDATE public.approval_requests
            SET status = 'REJECTED', decided_by = $3, decided_at = clock_timestamp(),
                reason = $4, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, open.rows[0].id, actor.userId, trimmed],
      );
    }
    await client.query(
      `UPDATE public.service_orders
          SET status = 'CANCELLED', cancel_reason = $3, closed_at = clock_timestamp(),
              updated_by = $4, updated_at = clock_timestamp(), version = version + 1
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, orderId, trimmed, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "service.order_rejected",
      entityType: "service_order",
      entityId: orderId,
      metadata: { reason: trimmed },
      retentionClass: "FINANCIAL",
    });
    return { outcome: "OK" as const, id: orderId };
  });
}

export { loadServiceOrder, formatHundredths };
export { orderStatus, parseExternalCost } from "./service-order-shared";
