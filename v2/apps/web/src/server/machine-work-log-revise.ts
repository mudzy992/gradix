/** R5.1: append-only revision of machine work logs (original row untouched). */
import { randomUUID } from "node:crypto";
import { machineActivityRecordAllowed } from "./machine-activity-scope";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import { reverseSourceCost } from "./cost-entry-service";
import type { MachineWorkLogActor, MutationOutcome } from "./machine-work-log-types";

export type ReviseInput = { reason: string; payload: Record<string, unknown> };

export async function reviseMachineWorkLog(
  pool: Pool,
  actor: MachineWorkLogActor,
  workLogId: string,
  input: ReviseInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.work_log.revise")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.reason.trim().length < 10) {
    return { outcome: "VALIDATION_FAILED", code: "REASON_TOO_SHORT", message: "Razlog ≥10 znakova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await machineActivityRecordAllowed(client, actor, "machine_work_log", workLogId)) return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    const log = await client.query<{ id: string; version: number; machine_id: string; meter_end: string | null }>(
      `SELECT id, version, machine_id, meter_end::text
         FROM public.machine_work_logs WHERE company_id = $1 AND id = $2`,
      [actor.companyId, workLogId],
    );
    if (!log.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    }
    const row = log.rows[0];
    await client.query(
      `INSERT INTO public.machine_work_log_revisions
         (id, company_id, work_log_id, base_version, reason, author_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        `mwlr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        actor.companyId,
        row.id,
        row.version,
        input.reason.trim(),
        actor.userId,
        JSON.stringify(input.payload),
      ],
    );
    const newMeterEnd = typeof input.payload.meterEnd === "number" ? input.payload.meterEnd : null;
    const previousMeter = row.meter_end === null ? null : Number(row.meter_end);
    if (newMeterEnd != null && previousMeter != null && newMeterEnd < previousMeter) {
      await client.query("SELECT set_config('app.meter_amendment', '1', true)");
      await client.query(
        `INSERT INTO public.machine_meter_readings
           (id, company_id, machine_id, reading_value, recorded_at, source, work_log_id, actor_id)
         VALUES ($1, $2, $3, $4, clock_timestamp(), 'MANUAL', $5, $6)`,
        [
          `mmr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          actor.companyId,
          row.machine_id,
          newMeterEnd,
          row.id,
          actor.userId,
        ],
      );
    }
    await reverseSourceCost(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      sourceType: "MACHINE_WORK_LOG",
      sourceId: row.id,
      reason: input.reason,
    });
    return { outcome: "OK", id: row.id };
  });
}
