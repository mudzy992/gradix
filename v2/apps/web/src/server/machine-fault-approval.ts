/** R5.5: create OPEN approval_request when fault cost exceeds threshold. */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { FAULT_COST_APPROVAL_THRESHOLD_CENTS } from "@gradix/domain";
import type { FaultStatus } from "./machine-fault-types";

/**
 * F4 (spec 05 §1.6.24): prag odobrenja je PODATAK FIRME (`fault_approval_threshold_cents`).
 *
 * Bez parametra funkcija ostaje kompatibilna sa R5.5 (default 500 KM iz domena), pa stari
 * pozivaoci i testovi ne moraju znati za novu kolonu — ali svaki novi poziv prolazi prag firme.
 */
export function initialFaultStatus(
  estimatedCostCents: bigint | null,
  thresholdCents: bigint = FAULT_COST_APPROVAL_THRESHOLD_CENTS,
): FaultStatus {
  if (estimatedCostCents === null) return "OPEN";
  return estimatedCostCents >= thresholdCents ? "WAITING_APPROVAL" : "OPEN";
}

export async function insertFaultApprovalRequest(
  client: PoolClient,
  input: {
    companyId: string;
    faultId: string;
    amountCents: bigint;
    currencyCode: string;
    requestedBy: string;
  },
): Promise<string> {
  const id = `apr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await client.query(
    `INSERT INTO public.approval_requests
       (id, company_id, subject_type, subject_id, amount_cents, currency_code,
        status, requested_by)
     VALUES ($1, $2, 'machine_fault', $3, $4, $5, 'OPEN', $6)`,
    [id, input.companyId, input.faultId, input.amountCents.toString(), input.currencyCode, input.requestedBy],
  );
  return id;
}

export async function canProgressWithCost(
  client: PoolClient,
  companyId: string,
  faultId: string,
  status: FaultStatus,
  estimatedCostCents: bigint | null,
  thresholdCents: bigint = FAULT_COST_APPROVAL_THRESHOLD_CENTS,
): Promise<boolean> {
  // Ispod praga firme nema zahtjeva za odobrenje — prag se čita iz firme, ne iz konstante.
  if (estimatedCostCents === null || estimatedCostCents < thresholdCents) return true;
  if (status === "APPROVED" || status === "IN_PROGRESS" || status === "DONE") return true;
  const approved = await client.query<{ id: string }>(
    `SELECT id FROM public.approval_requests
      WHERE company_id = $1 AND subject_type = 'machine_fault' AND subject_id = $2
        AND status = 'APPROVED'
      LIMIT 1`,
    [companyId, faultId],
  );
  return Boolean(approved.rows[0]);
}
