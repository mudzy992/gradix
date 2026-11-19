/** R5.5 DB row mapping and helpers for machine faults. */
import type { PoolClient } from "pg";
import { isCurrency, money, toAmountString, type Currency } from "@gradix/domain";
import type { FaultActor, FaultPriority, FaultRow, FaultStatus } from "./machine-fault-types";

export type DbFaultRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  reporter_worker_id: string | null;
  reporter_name: string | null;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  reported_at: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  estimated_cost_cents: string | null;
  currency_code: string | null;
  downtime_minutes: number | null;
  version: number;
  created_at: string;
  approval_request_id: string | null;
  approval_status: string | null;
};

export function mapFaultRow(row: DbFaultRow): FaultRow {
  return {
    id: row.id,
    machine_id: row.machine_id,
    machine_code: row.machine_code,
    machine_name: row.machine_name,
    reporter_worker_id: row.reporter_worker_id,
    reporter_name: row.reporter_name,
    project_id: row.project_id,
    project_code: row.project_code,
    project_name: row.project_name,
    partner_id: row.partner_id,
    partner_name: row.partner_name,
    reported_at: row.reported_at,
    title: row.title,
    description: row.description,
    priority: row.priority as FaultPriority,
    status: row.status as FaultStatus,
    estimated_cost: row.estimated_cost_cents !== null && row.currency_code
      ? toAmountString({ cents: BigInt(row.estimated_cost_cents), currency: row.currency_code as Currency })
      : null,
    currency_code: row.currency_code,
    downtime_minutes: row.downtime_minutes,
    version: row.version,
    created_at: row.created_at,
    approval_request_id: row.approval_request_id,
    approval_status: row.approval_status,
  };
}

export async function companyCurrency(client: PoolClient, companyId: string): Promise<Currency> {
  const row = await client.query<{ currency: string }>(
    "SELECT currency FROM public.companies WHERE id = $1",
    [companyId],
  );
  const code = row.rows[0]?.currency ?? "BAM";
  if (!isCurrency(code)) return "BAM";
  return code;
}

export async function resolveFaultActorWorkerId(
  client: PoolClient,
  actor: FaultActor,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT w.id FROM public.workers w
      WHERE w.company_id = $1 AND w.user_id = $2 AND w.is_active LIMIT 1`,
    [actor.companyId, actor.userId],
  );
  return result.rows[0]?.id ?? null;
}

export function isFaultPriority(value: string): value is FaultPriority {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

export function isFaultStatus(value: string): value is FaultStatus {
  return value === "OPEN" || value === "WAITING_APPROVAL" || value === "APPROVED"
    || value === "IN_PROGRESS" || value === "DONE" || value === "CANCELLED";
}

export function parseFaultMoney(amount: string, currency: Currency): bigint {
  return money(amount, currency).cents;
}
