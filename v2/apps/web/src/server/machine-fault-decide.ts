/** R5.5: OWNER/ADMIN approve or reject fault cost approval_requests. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import type { FaultActor, MutationOutcome } from "./machine-fault-types";

export async function approveMachineFault(
  pool: Pool,
  actor: FaultActor,
  faultId: string,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.fault.approve")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return decide(pool, actor, faultId, "APPROVED", "APPROVED");
}

export async function rejectMachineFault(
  pool: Pool,
  actor: FaultActor,
  faultId: string,
  reason?: string | null,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.fault.approve")) return { outcome: "FORBIDDEN", code: "ROLE" };
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length > 0 && trimmed.length < 10) {
    return { outcome: "VALIDATION_FAILED", code: "REASON_TOO_SHORT", message: "Razlog ≥10 znakova." };
  }
  return decide(pool, actor, faultId, "REJECTED", "CANCELLED", trimmed || null);
}

async function decide(
  pool: Pool,
  actor: FaultActor,
  faultId: string,
  approvalStatus: "APPROVED" | "REJECTED",
  faultStatus: "APPROVED" | "CANCELLED",
  reason: string | null = null,
): Promise<MutationOutcome> {
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const fault = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM public.machine_faults WHERE company_id = $1 AND id = $2`,
      [actor.companyId, faultId],
    );
    if (!fault.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    }
    if (fault.rows[0].status !== "WAITING_APPROVAL") {
      return {
        outcome: "CONFLICT",
        code: "NOT_WAITING",
        message: "Kvar nije u stanju čekanja odobrenja.",
      };
    }
    const open = await client.query<{ id: string }>(
      `SELECT id FROM public.approval_requests
        WHERE company_id = $1 AND subject_type = 'machine_fault' AND subject_id = $2
          AND status = 'OPEN'
        LIMIT 1`,
      [actor.companyId, faultId],
    );
    if (!open.rows[0]) {
      return {
        outcome: "CONFLICT",
        code: "NO_OPEN_REQUEST",
        message: "Nema otvorenog zahtjeva za odobrenje.",
      };
    }
    await client.query(
      `UPDATE public.approval_requests
          SET status = $3, decided_by = $4, decided_at = clock_timestamp(),
              reason = $5, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, open.rows[0].id, approvalStatus, actor.userId, reason],
    );
    await client.query(
      `UPDATE public.machine_faults
          SET status = $3, version = version + 1, updated_by = $4, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, faultId, faultStatus, actor.userId],
    );
    return { outcome: "OK", id: faultId };
  });
}
