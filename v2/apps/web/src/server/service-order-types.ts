/**
 * F8 (Modul 9) — tipovi servisnog naloga.
 *
 * Odvojeni od `service-order-service.ts` da bi rute, servis i testovi dijelili JEDAN oblik
 * podatka. Iznosi putuju kao decimalni stringovi (`"125.50"`), nikad kao `number`: novac je u
 * domeni `bigint`, a JSON nema `bigint` — konverzija se radi tačno na jednom mjestu.
 */
import type { ServiceOrderStatus } from "@gradix/domain";

export type ServiceActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
};

export type ServiceOutcome =
  | { outcome: "OK"; id: string; cost?: { posted: number; pending: number; skipped: number } }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "NOT_FOUND"; code: string; message: string };

export type ServiceOrderRow = {
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
  origin: "FAULT" | "PREVENTIVE" | "MANUAL" | "INSPECTION";
  kind: "INTERNAL" | "EXTERNAL";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: ServiceOrderStatus;
  description: string | null;
  planned_for: string | null;
  opened_at: string;
  started_at: string | null;
  finished_at: string | null;
  downtime_minutes: number | null;
  assigned_mechanic_worker_id: string | null;
  assigned_mechanic_name: string | null;
  labor_hours: string;
  labor_cost_amount: string;
  parts_cost_amount: string;
  external_cost_amount: string;
  total_cost_amount: string;
  currency_code: string;
  planned_cost_amount: string | null;
  external_quote_amount: string | null;
  external_invoice_ref: string | null;
  maintenance_plan_id: string | null;
  warranty_until: string | null;
  warranty_claim: boolean;
  warranty_source_order_id: string | null;
  cancel_reason: string | null;
  open_days: number;
  approval_status: "OPEN" | "APPROVED" | "REJECTED" | null;
  approval_request_id: string | null;
  version: number;
};

export type ServiceOrderEventRow = {
  id: string;
  kind: string;
  at: string;
  actor_name: string | null;
  note: string | null;
};

export type ServiceOrderPartRow = {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  unit: string;
  quantity: string;
  unit_cost_amount: string;
  total_cost_amount: string;
  stock_movement_id: string | null;
  note: string | null;
};

export type ServiceOrderFilters = {
  status?: ServiceOrderStatus;
  machineId?: string;
  /** „Samo ono što čeka dijelove“ — filter radionice. */
  waitingParts?: boolean;
  /** Nalozi dodijeljeni prijavljenom mehaničaru (mobilni ekran). */
  mineOnly?: boolean;
};

/** Detalj naloga: jedan zahtjev donosi sve što ekran prikazuje (tok, dijelove, trošak). */
export type ServiceOrderDetail = {
  order: ServiceOrderRow;
  events: ServiceOrderEventRow[];
  parts: ServiceOrderPartRow[];
  costEntry: { id: string; amount_amount: string | null; status: string; project_id: string | null } | null;
  nextStatuses: string[];
};
