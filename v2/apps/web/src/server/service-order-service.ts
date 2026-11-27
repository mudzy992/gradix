import { equipmentScope, equipmentRecordAllowed, equipmentTargetAllowed, isActorWorker, type EquipmentActor } from "./equipment-scope";
/**
 * F8 (Modul 9) — servisni nalozi: rad, a ne samo kvar.
 *
 * Pravila iz `docs/specs/09-servis-odrzavanje.md` koja ovaj fajl sprovodi:
 *
 *  1. **Nalog je zapis o RADU** (§1.1). Kvar je događaj; nalog nosi mehaničara, sate, dijelove,
 *     stvarno trajanje i trošak. Zato `DONE` traži `started_at` i `finished_at` — bez njih nema
 *     MTTR-a, a „završeno“ bez trajanja je tvrdnja bez podatka.
 *  2. **Trošak je IZVEDEN** (§1.6): `total = labor + parts + external`. `labor` je
 *     `sati × satnica na dan rada` iz `worker_rates`; satnica se čita pri završetku i upisuje u
 *     nalog, pa promjena satnice NE mijenja stari nalog.
 *  3. **Knjiženje je posljedica završetka** (§1.4): trošak ide na projekat ako nalog ima
 *     `project_id`, inače SAMO na mašinu; nikad oboje, jer jedan `(source_type, source_id)` daje
 *     jedan red u ledgeru. Garancijski nalog knjiži iznos 0 (vidi se, ne plaća se dvaput).
 *  4. **Zaliha je `SUM(stock_movements)`** (§1.3): utrošak dijela je kretnja `OUT`, a `parts_cost`
 *     je zbir `service_order_parts`. Idempotencija ide preko djelimičnog unikata kretnji.
 *  5. **Odobrenje je drugi par očiju** (§1.5): predračun iznad praga firme traži `APPROVED`
 *     zahtjev prije `IN_PROGRESS`; vanjski servis iznad praga traži ponudu.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isWarrantyClaim, serviceApprovalCheck, toHundredths } from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { companyToday } from "./project-service";
import type { ServiceOrderFilters, ServiceOrderRow } from "./service-order-types";
import { toServiceOrderRow, type DbServiceOrderRow } from "./service-order-mapper";
import { ORDER_SELECT, serviceOrderDetail } from "./service-order-read";

export type {
  ServiceActor,
  ServiceOrderEventRow,
  ServiceOrderFilters,
  ServiceOrderPartRow,
  ServiceOrderRow,
  ServiceOutcome,
} from "./service-order-types";

/* ------------------------------------------------------------------- čitanje */

async function redactHiddenFaults(client: PoolClient, actor: EquipmentActor, orders: ServiceOrderRow[]): Promise<void> {
  const ids = orders.flatMap((order) => order.fault_id ? [order.fault_id] : []);
  if (!ids.length) return;
  const params: unknown[] = [actor.companyId, ids];
  const scope = equipmentScope(actor, params, "f", "fault");
  const result = can(actor.roles, "machines.fault.view")
    ? await client.query<{id:string}>(`SELECT f.id FROM public.machine_faults f WHERE f.company_id=$1 AND f.id=ANY($2::text[]) AND ${scope}`, params)
    : { rows: [] };
  const visible = new Set(result.rows.map((row) => row.id));
  for (const order of orders) if (order.fault_id && !visible.has(order.fault_id)) {
    order.fault_id = null;
    order.fault_title = null;
  }
}

export async function listServiceOrders(
  pool: Pool,
  actor: EquipmentActor,
  filters: ServiceOrderFilters,
): Promise<ServiceOrderRow[]> {
  if (!can(actor.roles, "service.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const conditions = ["so.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    conditions.push(equipmentScope(actor, params, "so", "order"));
    let index = params.length + 1;
    if (filters.dashboardMine) {
      conditions.push(`so.assigned_mechanic_worker_id IN (SELECT w.id FROM public.workers w
        WHERE w.company_id=so.company_id AND w.user_id=$${index} AND w.is_active)`);
      params.push(actor.userId); index += 1;
      conditions.push(filters.dashboardMine === "waiting" ? "so.status='WAITING_PARTS'" : "so.status IN ('PLANNED','APPROVED','IN_PROGRESS')");
      if (filters.dashboardProjectIds !== null) {
        conditions.push(`so.project_id = ANY($${index}::text[])`);
        params.push(filters.dashboardProjectIds ?? []); index += 1;
      }
    }
    if (filters.status) {
      conditions.push(`so.status = $${index}`);
      params.push(filters.status);
      index += 1;
    }
    if (filters.machineId) {
      conditions.push(`so.machine_id = $${index}`);
      params.push(filters.machineId);
      index += 1;
    }
    if (filters.waitingParts) conditions.push("so.status = 'WAITING_PARTS'");
    if (filters.mineOnly) {
      /* „Moji nalozi“ je vezan na mehaničara kao RADNIKA, ne na korisnički nalog: serviser je
         zaposleni u firmi, a `workers` je jedini registar zaposlenih. */
      conditions.push(`so.assigned_mechanic_worker_id = (
        SELECT w.id FROM public.workers w
         WHERE w.company_id = so.company_id AND w.user_id = $${index} AND w.is_active LIMIT 1)`);
      params.push(actor.userId);
      index += 1;
    }
    const result = await client.query<DbServiceOrderRow>(
      `SELECT ${ORDER_SELECT}
        WHERE ${conditions.join(" AND ")}
        ORDER BY
          CASE so.status WHEN 'WAITING_PARTS' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'APPROVED' THEN 2
                         WHEN 'PLANNED' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
          CASE so.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
          so.opened_at ASC`,
      params,
    );
    const today = await companyToday(client, toCompanyId(actor.companyId));
    const orders = result.rows.map((row) => toServiceOrderRow(row, today));
    await redactHiddenFaults(client, actor, orders);
    return orders;
  });
}

export async function getServiceOrder(
  pool: Pool,
  actor: EquipmentActor,
  orderId: string,
) {
  if (!can(actor.roles, "service.view")) return null;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentRecordAllowed(client, actor, "order", orderId)) return null;
    const detail = await serviceOrderDetail(client, actor.companyId, orderId);
    if (detail) await redactHiddenFaults(client, actor, [detail.order]);
    return detail;
  });
}

/* ------------------------------------------------------------------- upis */

/** Prefiks `svo_` je isti koji koristi triger iz kvara — jedan format za sve naloge. */
function newServiceOrderId(): string {
  return `svo_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function companyCurrencyCode(client: PoolClient, companyId: string): Promise<string> {
  const row = await client.query<{ currency: string }>(
    "SELECT currency FROM public.companies WHERE id = $1",
    [companyId],
  );
  return row.rows[0]?.currency ?? "BAM";
}

async function serviceThreshold(client: PoolClient, companyId: string): Promise<bigint> {
  const row = await client.query<{ cents: string }>(
    "SELECT service_approval_threshold_cents::text AS cents FROM public.companies WHERE id = $1",
    [companyId],
  );
  return BigInt(row.rows[0]?.cents ?? "50000");
}

export type CreateServiceOrderInput = {
  machineId: string;
  faultId?: string | null;
  projectId?: string | null;
  partnerId?: string | null;
  maintenancePlanId?: string | null;
  origin: "FAULT" | "PREVENTIVE" | "MANUAL" | "INSPECTION";
  kind: "INTERNAL" | "EXTERNAL";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  plannedFor?: string | null;
  assignedMechanicWorkerId?: string | null;
  plannedCostAmount?: string | null;
  externalQuoteAmount?: string | null;
};

function centsFromAmount(amount: string | null | undefined): bigint | null {
  if (amount === null || amount === undefined || amount === "") return null;
  try {
    return toHundredths(amount);
  } catch {
    return null;
  }
}

export async function createServiceOrder(
  pool: Pool,
  actor: EquipmentActor,
  input: CreateServiceOrderInput,
) {
  if (!can(actor.roles, "service.manage")) {
    return { outcome: "FORBIDDEN" as const, code: "ROLE", message: "Nemate pravo na servisne naloge." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentTargetAllowed(client, actor, input.projectId, input.machineId)
        || (actor.scope === "SELF" && !await isActorWorker(client, actor, input.assignedMechanicWorkerId))) {
      return { outcome: "NOT_FOUND" as const, code: "NOT_FOUND", message: "Mašina ili projekat ne postoji." };
    }
    if (actor.scope !== "COMPANY" && input.faultId) {
      if (!await equipmentRecordAllowed(client, actor, "fault", input.faultId)) {
        return { outcome: "NOT_FOUND" as const, code: "NOT_FOUND", message: "Kvar ne postoji." };
      }
      const fault = await client.query("SELECT id FROM public.machine_faults WHERE company_id=$1 AND id=$2 AND machine_id=$3 AND project_id=$4",
        [actor.companyId, input.faultId, input.machineId, input.projectId]);
      if (!fault.rows[0]) return { outcome: "NOT_FOUND" as const, code: "NOT_FOUND", message: "Kvar ne postoji." };
    }
    const machine = await client.query<{ id: string }>(
      "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2",
      [actor.companyId, input.machineId],
    );
    if (!machine.rows[0]) {
      return { outcome: "NOT_FOUND" as const, code: "MACHINE_NOT_FOUND", message: "Mašina ne postoji." };
    }
    if (input.kind === "EXTERNAL" && !input.partnerId) {
      return {
        outcome: "VALIDATION_FAILED" as const,
        code: "PARTNER_REQUIRED",
        message: "Vanjski servis traži partnera (servisera).",
      };
    }

    const currency = await companyCurrencyCode(client, actor.companyId);
    const plannedCost = centsFromAmount(input.plannedCostAmount);
    const quote = centsFromAmount(input.externalQuoteAmount);
    const threshold = await serviceThreshold(client, actor.companyId);
    const check = serviceApprovalCheck({
      kind: input.kind,
      plannedCostCents: plannedCost ?? 0n,
      thresholdCents: threshold,
      externalQuoteCents: quote,
    });
    /*
     * Ponuda se traži tek pri ODOBRENJU, ne pri planiranju (§1.5/25–26): nalog se planira i bez
     * ponude (da se zna da je servis potreban), ali vanjski rad iznad praga ne počinje bez nje.
     */

    /* Garancija na izvedeni rad (§1.7/32): novi kvar unutar `warranty_until` ranijeg naloga nosi
       `warranty_claim` i vezu na izvorni nalog — trošak tada ne nastaje dvaput. */
    const today = await companyToday(client, toCompanyId(actor.companyId));
    let warrantyClaim = false;
    let warrantySourceOrderId: string | null = null;
    if (input.origin === "FAULT") {
      const warrantyParams: unknown[] = [actor.companyId, input.machineId, today];
      const warrantyScope = equipmentScope(actor, warrantyParams, "so", "order");
      const warranty = await client.query<{ id: string; warranty_until: string }>(
        `SELECT so.id, so.warranty_until::text FROM public.service_orders so
          WHERE so.company_id = $1 AND so.machine_id = $2 AND so.warranty_until IS NOT NULL
            AND so.warranty_until >= $3::date AND so.status = 'DONE' AND ${warrantyScope}
          ORDER BY so.warranty_until DESC LIMIT 1`, warrantyParams,
      );
      const source = warranty.rows[0];
      if (source) {
        const decision = isWarrantyClaim(today, [
          { id: source.id, machineId: input.machineId, warrantyUntil: source.warranty_until },
        ], input.machineId);
        warrantyClaim = decision.claim;
        warrantySourceOrderId = decision.sourceOrderId;
      }
    }

    const id = newServiceOrderId();
    await client.query(
      `INSERT INTO public.service_orders
         (id, company_id, machine_id, fault_id, project_id, partner_id, description, amount_cents,
          currency_code, created_by, origin, kind, priority, planned_for, assigned_mechanic_worker_id,
          maintenance_plan_id, external_quote_cents, warranty_claim, warranty_source_order_id,
          status, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,$15,$16,$17,$18,$19,
               'PLANNED',$10)`,
      [
        id,
        actor.companyId,
        input.machineId,
        input.faultId ?? null,
        input.projectId ?? null,
        input.partnerId ?? null,
        input.description.trim(),
        /* Predračun i valuta idu UVIJEK zajedno (CHECK `amount_pair`): planiranje samo po
           sebi nije trošak, a nalog bez ijednog iznosa bi u redu čekanja izgledao besplatan. */
        (plannedCost ?? 0n).toString(),
        currency,
        actor.userId,
        input.origin,
        input.kind,
        input.priority,
        input.plannedFor ?? null,
        input.assignedMechanicWorkerId ?? null,
        input.maintenancePlanId ?? null,
        quote === null ? null : quote.toString(),
        warrantyClaim,
        warrantySourceOrderId,
      ],
    );

    /* Zahtjev za odobrenje nastaje ODMAH kad predračun prelazi prag: ako se čeka početak rada,
       između planiranja i rada postoji stanje u kojem niko ne zna da odobrenje treba. */
    if (check.needsApproval && plannedCost !== null) {
      await insertServiceApprovalRequest(client, {
        companyId: actor.companyId,
        orderId: id,
        amountCents: plannedCost,
        currencyCode: currency,
        requestedBy: actor.userId,
      });
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "service.order_created",
      entityType: "service_order",
      entityId: id,
      metadata: {
        machineId: input.machineId,
        origin: input.origin,
        kind: input.kind,
        plannedCostCents: plannedCost?.toString() ?? null,
        approvalRequired: check.needsApproval,
        warrantyClaim,
      },
      retentionClass: "FINANCIAL",
    });

    return { outcome: "OK" as const, id, approvalRequired: check.needsApproval };
  });
}

export async function insertServiceApprovalRequest(
  client: PoolClient,
  input: {
    companyId: string;
    orderId: string;
    amountCents: bigint;
    currencyCode: string;
    requestedBy: string;
  },
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM public.approval_requests
      WHERE company_id = $1 AND subject_type = 'service_order' AND subject_id = $2
        AND status = 'OPEN' LIMIT 1`,
    [input.companyId, input.orderId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = `apr_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await client.query(
    `INSERT INTO public.approval_requests
       (id, company_id, subject_type, subject_id, amount_cents, currency_code, status, requested_by)
     VALUES ($1,$2,'service_order',$3,$4,$5,'OPEN',$6)`,
    [id, input.companyId, input.orderId, input.amountCents.toString(), input.currencyCode, input.requestedBy],
  );
  return id;
}
