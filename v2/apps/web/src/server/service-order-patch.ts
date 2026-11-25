/**
 * F8 — izmjena naloga BEZ statusa.
 *
 * `PATCH` mijenja ono što se može ispraviti bez posljedica (prioritet, opis, mehaničar, projekat,
 * predračun, ponuda). Status i trošak NE idu ovim putem: oni imaju akcije (`start`, `finish`),
 * jer uz sebe nose `started_at`, satnicu i knjiženje. Da `PATCH` smije pisati iznos, ekran bi
 * mogao „popraviti“ trošak mimo ledgera — a ledger je dokaz.
 *
 * Predračun iznad praga otvara zahtjev za odobrenje ODMAH; spuštanje ispod praga NIJE razlog za
 * gašenje zahtjeva koji je već odobren (istorija odobrenja se ne prepisuje).
 */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { toHundredths } from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { insertServiceApprovalRequest } from "./service-order-service";
import type { ServiceActor, ServiceOutcome } from "./service-order-types";

export type PatchServiceOrderInput = {
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description?: string;
  plannedFor?: string | null;
  assignedMechanicWorkerId?: string | null;
  projectId?: string | null;
  partnerId?: string | null;
  plannedCostAmount?: string | null;
  externalQuoteAmount?: string | null;
  externalInvoiceRef?: string | null;
};

function cents(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return toHundredths(value);
  } catch {
    return null;
  }
}

export async function updateServiceOrder(
  pool: Pool,
  actor: ServiceActor,
  orderId: string,
  input: PatchServiceOrderInput,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "service.manage")) {
    return { outcome: "FORBIDDEN", code: "ROLE", message: "Nemate pravo na izmjenu naloga." };
  }
  const planned = cents(input.plannedCostAmount);
  if (input.plannedCostAmount && planned === null) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "PLANNED_COST_INVALID",
      message: "Predračun mora biti iznos sa dvije decimale.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const existing = await client.query<{ status: string; kind: string }>(
      "SELECT status, kind FROM public.service_orders WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, orderId],
    );
    const row = existing.rows[0];
    if (!row) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Nalog ne postoji." };
    if (row.status === "DONE" || row.status === "CANCELLED") {
      /* Završen nalog je zapis: mijenjanje mehaničara ili projekta poslije završetka prepisalo bi
         ko je radio i gdje trošak pripada — a trošak je već proknjižen. */
      return {
        outcome: "CONFLICT",
        code: "SERVICE_ALREADY_DONE",
        message: "Završen nalog se ne mijenja; ispravka ide kroz novi nalog.",
      };
    }
    await client.query(
      `UPDATE public.service_orders
          SET priority = COALESCE($3, priority),
              description = COALESCE($4, description),
              planned_for = COALESCE($5::date, planned_for),
              assigned_mechanic_worker_id = COALESCE($6, assigned_mechanic_worker_id),
              project_id = COALESCE($7, project_id),
              partner_id = COALESCE($8, partner_id),
              amount_cents = COALESCE($9, amount_cents),
              external_quote_cents = COALESCE($10, external_quote_cents),
              external_invoice_ref = COALESCE($11, external_invoice_ref),
              updated_by = $12,
              updated_at = clock_timestamp(),
              version = version + 1
        WHERE company_id = $1 AND id = $2`,
      [
        actor.companyId,
        orderId,
        input.priority ?? null,
        input.description?.trim() ?? null,
        input.plannedFor ?? null,
        input.assignedMechanicWorkerId ?? null,
        input.projectId ?? null,
        input.partnerId ?? null,
        planned === null ? null : planned.toString(),
        cents(input.externalQuoteAmount)?.toString() ?? null,
        input.externalInvoiceRef ?? null,
        actor.userId,
      ],
    );

    if (planned !== null) {
      const threshold = await client.query<{ cents: string; currency: string }>(
        `SELECT service_approval_threshold_cents::text AS cents, currency
           FROM public.companies WHERE id = $1`,
        [actor.companyId],
      );
      const limit = BigInt(threshold.rows[0]?.cents ?? "50000");
      if (planned > limit) {
        await insertServiceApprovalRequest(client, {
          companyId: actor.companyId,
          orderId,
          amountCents: planned,
          currencyCode: threshold.rows[0]?.currency ?? "BAM",
          requestedBy: actor.userId,
        });
      }
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "service.order_updated",
      entityType: "service_order",
      entityId: orderId,
      metadata: {
        fields: Object.keys(input),
        plannedCostCents: planned?.toString() ?? null,
      },
      retentionClass: "STANDARD",
    });

    return { outcome: "OK", id: orderId };
  });
}
