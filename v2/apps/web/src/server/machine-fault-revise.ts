import { equipmentRecordAllowed, type EquipmentActor } from "./equipment-scope";
/** R5.5: append-only revision + optional status progress with approval gate. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import { canProgressWithCost } from "./machine-fault-approval";
import { faultApprovalThreshold } from "./machine-availability-service";
import { isFaultStatus } from "./machine-fault-db-helpers";
import type { FaultStatus, MutationOutcome } from "./machine-fault-types";

export type ReviseInput = { reason: string; payload: Record<string, unknown> };

export async function reviseMachineFault(
  pool: Pool,
  actor: EquipmentActor,
  faultId: string,
  input: ReviseInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.fault.revise")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.reason.trim().length < 10) {
    return { outcome: "VALIDATION_FAILED", code: "REASON_TOO_SHORT", message: "Razlog ≥10 znakova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentRecordAllowed(client, actor, "fault", faultId)) return { outcome: "FORBIDDEN", code: "SCOPE", message: "Nije dozvoljeno." };
    const fault = await client.query<{
      id: string;
      version: number;
      status: string;
      estimated_cost_cents: string | null;
      title: string;
      description: string | null;
      priority: string;
    }>(
      `SELECT id, version, status, estimated_cost_cents::text, title, description, priority
         FROM public.machine_faults WHERE company_id = $1 AND id = $2`,
      [actor.companyId, faultId],
    );
    if (!fault.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    }
    const row = fault.rows[0];
    const nextStatusRaw = typeof input.payload.status === "string" ? input.payload.status : null;
    if (nextStatusRaw !== null) {
      if (!isFaultStatus(nextStatusRaw)) {
        return { outcome: "VALIDATION_FAILED", code: "STATUS", message: "Status nije validan." };
      }
      const nextStatus = nextStatusRaw as FaultStatus;
      if (nextStatus === "IN_PROGRESS" || nextStatus === "DONE") {
        const cost = row.estimated_cost_cents === null ? null : BigInt(row.estimated_cost_cents);
        const allowed = await canProgressWithCost(
          client, actor.companyId, row.id, row.status as FaultStatus, cost,
          await faultApprovalThreshold(client, actor.companyId),
        );
        if (!allowed) {
          return {
            outcome: "FORBIDDEN",
            code: "NEEDS_APPROVAL",
            message: "Trošak iznad praga traži odobrenje prije nastavka.",
          };
        }
      }
      await client.query(
        `UPDATE public.machine_faults
            SET status = $3, version = version + 1, updated_by = $4, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, row.id, nextStatus, actor.userId],
      );
    }
    await client.query(
      `INSERT INTO public.machine_fault_revisions
         (id, company_id, fault_id, base_version, reason, author_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        `mfr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        actor.companyId,
        row.id,
        row.version,
        input.reason.trim(),
        actor.userId,
        JSON.stringify({
          original: {
            status: row.status,
            title: row.title,
            description: row.description,
            priority: row.priority,
          },
          ...input.payload,
        }),
      ],
    );
    return { outcome: "OK", id: row.id };
  });
}
