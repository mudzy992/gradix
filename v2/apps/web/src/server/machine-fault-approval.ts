/** R5.5: create OPEN approval_request when fault cost exceeds threshold. */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { needsFaultCostApproval } from "@gradix/domain";
import type { FaultStatus } from "./machine-fault-types";

export function initialFaultStatus(estimatedCostCents: bigint | null): FaultStatus {
  return needsFaultCostApproval(estimatedCostCents) ? "WAITING_APPROVAL" : "OPEN";
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
): Promise<boolean> {
  if (!needsFaultCostApproval(estimatedCostCents)) return true;
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
