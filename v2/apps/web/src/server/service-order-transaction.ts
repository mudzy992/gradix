/**
 * F8 — završetak naloga u transakciji koju otvara POZIVALAC.
 *
 * Izdvojeno iz `service-order-actions.ts` iz dva razloga: (1) fajl sa akcijama je prelazio granicu
 * od 400 linija, pa je tijelo razdvojeno po odgovornosti — ovdje je isključivo „kako nastaje
 * trošak“; (2) mobilni sync je već u transakciji batcha, pa mu treba verzija koja ne otvara svoju.
 *
 * Redoslijed je namjeran i ne smije se mijenjati:
 *   1. satnica mehaničara na DAN RADA (ne danas) — promjena satnice ne prepisuje stari rad;
 *   2. `total = labor + parts + external` iz domene;
 *   3. upis naloga (baza provjerava `CHECK` da je zbir tačan);
 *   4. stvarni zastoj `finished − started`, sa ručnom korekcijom samo uz razlog.
 */
import type { PoolClient } from "pg";
import { ServiceError, assertServiceTransition, downtimeMinutes, serviceCost } from "@gradix/domain";
import { writeAudit } from "./audit";
import { bookServiceOrderCost } from "./cost-entry-service";
import { recordManualDowntime } from "./service-order-downtime";
import { orderStatus, parseExternalCost } from "./service-order-shared";
import type { ServiceOutcome } from "./service-order-types";

/**
 * Završetak u VEĆ otvorenoj transakciji — JEDNO tijelo za web i mobilni sync.
 *
 * Web koristi `finishServiceOrder`, koji otvara svoju transakciju; sync je već unutar nje (stavka
 * batcha), pa bi druga transakcija bila drugi vlasnik iste radnje. Zato tijelo ide u funkciju koja
 * prima klijenta — jedno tijelo, dva ulaza, isti trošak.
 */
export async function finishOrderInTransaction(
  client: PoolClient,
  params: {
    companyId: string;
    actorId: string;
    orderId: string;
    laborHours: string;
    /** Centi kad ih je pozivalac već provjerio (web), ili `null` uz `externalCostAmount`. */
    externalCostCents: bigint | null;
    /** Tekst iz mobilnog payloada — provjerava se ISTIM parserom kao na webu. */
    externalCostAmount?: string | null;
    externalInvoiceRef: string | null;
    warrantyUntil: string | null;
    downtimeMinutes: number | null;
    downtimeReason: string | null;
  },
): Promise<ServiceOutcome> {
    /* Vanjski trošak: ili su centi već provjereni (web) ili dolazi tekst (sync). Drugi parser bi
       propustio iznos koji web odbija — zato isti `parseExternalCost`. */
    let externalCents = params.externalCostCents;
    if (params.externalCostAmount) {
      const parsed = parseExternalCost(params.externalCostAmount);
      if (parsed === "INVALID") {
        return {
          outcome: "VALIDATION_FAILED",
          code: "EXTERNAL_COST_INVALID",
          message: "Vanjski trošak mora biti iznos sa dvije decimale.",
        };
      }
      externalCents = parsed;
    }

    const current = await orderStatus(client, params.companyId, params.orderId);
    if (!current.ok) return current.result;
    if (current.status === "DONE") {
      return {
        outcome: "CONFLICT" as const,
        code: "SERVICE_ALREADY_DONE",
        message: "Nalog je već završen.",
      };
    }
    try {
      assertServiceTransition(current.status, "DONE");
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      const conflict = error.code === "SERVICE_ALREADY_DONE" || error.code === "SERVICE_INVALID_STATUS";
      return {
        outcome: conflict ? "CONFLICT" : "VALIDATION_FAILED",
        code: error.code,
        message: error.message,
      };
    }

    const header = await client.query<{
      machine_id: string;
      assigned_mechanic_worker_id: string | null;
      opened_at: string;
      started_at: string | null;
      parts_cost_cents: string;
      external_cost_cents: string;
      labor_hours: string;
      currency_code: string | null;
      partner_id: string | null;
    }>(
      `SELECT machine_id, assigned_mechanic_worker_id, opened_at::text, started_at::text,
              parts_cost_cents::text, external_cost_cents::text, labor_hours::text, currency_code,
              partner_id
         FROM public.service_orders WHERE company_id = $1 AND id = $2`,
      [params.companyId, params.orderId],
    );
    const row = header.rows[0]!;

    /* Satnica: `worker_rates` na dan rada. Bez satnice rad je moguć, ali tada sati ulaze sa
       iznosom 0 — i to je VIDLJIVO, jer je `labor_cost` nula uz nenegativne sate. */
    const workDate = (row.started_at ?? row.opened_at).slice(0, 10);
    let hourlyRateCents = 0n;
    if (row.assigned_mechanic_worker_id) {
      const rate = await client.query<{ amount_cents: string | null }>(
        `SELECT amount_cents::text FROM public.worker_rates
          WHERE company_id = $1 AND worker_id = $2
            AND valid_from <= $3::date AND (valid_to IS NULL OR valid_to >= $3::date)
          ORDER BY valid_from DESC, created_at DESC LIMIT 1`,
        [params.companyId, row.assigned_mechanic_worker_id, workDate],
      );
      if (rate.rows[0]?.amount_cents) hourlyRateCents = BigInt(rate.rows[0].amount_cents);
    }

    /* Vanjski trošak mijenja NALOG, ne komponentu `SERVICE` stope mašine: stopa je prosjek iz
       prošlih naloga, a ovaj nalog je događaj. */

    const cost = serviceCost({
      laborHours: params.laborHours,
      hourlyRateCents,
      partsCostCents: BigInt(row.parts_cost_cents),
      externalCostCents: externalCents ?? BigInt(row.external_cost_cents),
    });

    const currency = row.currency_code ?? "BAM";
    await client.query(
      `UPDATE public.service_orders
          SET status = 'DONE',
              finished_at = clock_timestamp(),
              labor_hours = $3,
              labor_cost_cents = $4,
              parts_cost_cents = $5,
              external_cost_cents = $6,
              total_cost_cents = $7,
              currency_code = $8,
              external_invoice_ref = COALESCE($9, external_invoice_ref),
              warranty_until = COALESCE($10::date, warranty_until),
              closed_at = clock_timestamp(),
              updated_by = $11,
              updated_at = clock_timestamp(),
              version = version + 1
        WHERE company_id = $1 AND id = $2`,
      [
        params.companyId,
        params.orderId,
        params.laborHours,
        cost.laborCostCents.toString(),
        cost.partsCostCents.toString(),
        cost.externalCostCents.toString(),
        cost.totalCostCents.toString(),
        currency,
        params.externalInvoiceRef ?? null,
        params.warrantyUntil ?? null,
        params.actorId,
      ],
    );

    /* Stvarni zastoj: `finished − started`. Ručna korekcija je izuzetak sa razlogom i auditom. */
    if (row.started_at) {
      const computed = downtimeMinutes(row.started_at, new Date().toISOString());
      if (typeof params.downtimeMinutes === "number" && computed !== params.downtimeMinutes) {
        await recordManualDowntime(client, {
          companyId: params.companyId,
          orderId: params.orderId,
          machineId: row.machine_id,
          actorId: params.actorId,
          computedMinutes: computed ?? 0,
          manualMinutes: params.downtimeMinutes,
          reason: params.downtimeReason ?? null,
        });
      }
      if (computed !== null) {
        await client.query(
          `UPDATE public.machine_faults SET downtime_minutes = $3
            WHERE company_id = $1 AND id = (SELECT fault_id FROM public.service_orders
                                              WHERE company_id = $1 AND id = $2)`,
          [params.companyId, params.orderId, computed],
        );
      }
    }

    await writeAudit(client, {
      companyId: params.companyId,
      actorId: params.actorId,
      actorEmail: null,
      action: "service.order_finished",
      entityType: "service_order",
      entityId: params.orderId,
      metadata: {
        laborHours: params.laborHours,
        laborCostCents: cost.laborCostCents.toString(),
        partsCostCents: cost.partsCostCents.toString(),
        externalCostCents: cost.externalCostCents.toString(),
        totalCostCents: cost.totalCostCents.toString(),
      },
      retentionClass: "FINANCIAL",
    });

    const booked = await bookServiceOrderCost(client, {
      companyId: params.companyId,actorId: params.actorId,serviceOrderId: params.orderId,
    });
    return { outcome: "OK" as const, id: params.orderId, cost: booked };
}

