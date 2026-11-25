/**
 * F8 — mapiranje reda baze u oblik koji ruta vraća.
 *
 * Jedno mjesto gdje se `bigint` centi pretvaraju u decimalni string i gdje se računa `open_days`
 * (koliko nalog stoji). Da se to radi u ruti, svaka ruta bi mogla zaokružiti drugačije — a
 * ekran radionice i detalj naloga moraju pokazati ISTI broj.
 */
import { daysBetween, downtimeMinutes, formatHundredths, nextServiceStatuses } from "@gradix/domain";
import type { ServiceOrderRow } from "./service-order-types";
import { isServiceOrderStatus as domainIsServiceOrderStatus, type ServiceOrderStatus } from "@gradix/domain";

export type DbServiceOrderRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  fault_id: string | null;
  fault_title: string | null;
  project_id: string | null;
  project_code: string | null;
  partner_id: string | null;
  partner_name: string | null;
  origin: string;
  kind: string;
  priority: string;
  status: string;
  description: string | null;
  planned_for: string | null;
  opened_at: string;
  started_at: string | null;
  finished_at: string | null;
  assigned_mechanic_worker_id: string | null;
  assigned_mechanic_name: string | null;
  labor_hours: string;
  labor_cost_cents: string;
  parts_cost_cents: string;
  external_cost_cents: string;
  total_cost_cents: string;
  currency_code: string | null;
  amount_cents: string | null;
  external_quote_cents: string | null;
  external_invoice_ref: string | null;
  maintenance_plan_id: string | null;
  warranty_until: string | null;
  warranty_claim: boolean;
  warranty_source_order_id: string | null;
  cancel_reason: string | null;
  version: number;
  approval_request_id: string | null;
  approval_status: string | null;
};

function status(value: string): ServiceOrderStatus {
  return (["PLANNED", "APPROVED", "IN_PROGRESS", "WAITING_PARTS", "DONE", "CANCELLED"] as const).includes(
    value as ServiceOrderStatus,
  )
    ? (value as ServiceOrderStatus)
    : "PLANNED";
}

export function toServiceOrderRow(row: DbServiceOrderRow, today: string): ServiceOrderRow {
  const plannedCost = row.amount_cents === null ? null : BigInt(row.amount_cents);
  return {
    id: row.id,
    machine_id: row.machine_id,
    machine_code: row.machine_code,
    machine_name: row.machine_name,
    fault_id: row.fault_id,
    fault_title: row.fault_title,
    project_id: row.project_id,
    project_code: row.project_code,
    partner_id: row.partner_id,
    partner_name: row.partner_name,
    origin: row.origin as ServiceOrderRow["origin"],
    kind: row.kind as ServiceOrderRow["kind"],
    priority: row.priority as ServiceOrderRow["priority"],
    status: status(row.status),
    description: row.description,
    planned_for: row.planned_for,
    opened_at: row.opened_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    downtime_minutes: downtimeMinutes(row.started_at, row.finished_at),
    assigned_mechanic_worker_id: row.assigned_mechanic_worker_id,
    assigned_mechanic_name: row.assigned_mechanic_name,
    labor_hours: row.labor_hours,
    labor_cost_amount: formatHundredths(BigInt(row.labor_cost_cents)),
    parts_cost_amount: formatHundredths(BigInt(row.parts_cost_cents)),
    external_cost_amount: formatHundredths(BigInt(row.external_cost_cents)),
    total_cost_amount: formatHundredths(BigInt(row.total_cost_cents)),
    currency_code: row.currency_code ?? "BAM",
    planned_cost_amount: plannedCost === null ? null : formatHundredths(plannedCost),
    external_quote_amount:
      row.external_quote_cents === null ? null : formatHundredths(BigInt(row.external_quote_cents)),
    external_invoice_ref: row.external_invoice_ref,
    maintenance_plan_id: row.maintenance_plan_id,
    warranty_until: row.warranty_until,
    warranty_claim: row.warranty_claim,
    warranty_source_order_id: row.warranty_source_order_id,
    cancel_reason: row.cancel_reason,
    /*
     * „Koliko stoji“ je pitanje reda čekanja: otvoren nalog stoji od `planned_for` (ili od
     * otvaranja), a završen ne stoji. Završen nalog sa danima bi u prosjeku radionice izgledao
     * kao zaostatak koji ne postoji.
     */
    open_days:
      row.status === "DONE" || row.status === "CANCELLED"
        ? 0
        : Math.max(0, daysBetween((row.planned_for ?? row.opened_at).slice(0, 10), today)),
    approval_status: row.approval_status as "OPEN" | "APPROVED" | "REJECTED" | null,
    approval_request_id: row.approval_request_id,
    version: row.version,
  };
}

export function nextStatusesOf(value: ServiceOrderStatus): ServiceOrderStatus[] {
  return [...nextServiceStatuses(value)];
}

export const isServiceOrderStatus = domainIsServiceOrderStatus;
