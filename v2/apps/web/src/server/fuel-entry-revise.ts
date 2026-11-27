/** R5.2: append-only revision of fuel entries. */
import { randomUUID } from "node:crypto";
import { machineActivityRecordAllowed } from "./machine-activity-scope";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import { reverseSourceCost } from "./cost-entry-service";
import type { FuelEntryActor, MutationOutcome } from "./fuel-entry-types";

export type ReviseInput = { reason: string; payload: Record<string, unknown> };

export async function reviseFuelEntry(
  pool: Pool,
  actor: FuelEntryActor,
  fuelEntryId: string,
  input: ReviseInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.fuel.revise")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.reason.trim().length < 10) {
    return { outcome: "VALIDATION_FAILED", code: "REASON_TOO_SHORT", message: "Razlog ≥10 znakova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await machineActivityRecordAllowed(client, actor, "fuel_entry", fuelEntryId)) return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    const entry = await client.query<{ id: string; version: number; machine_id: string; meter_reading: string | null }>(
      `SELECT id, version, machine_id, meter_reading::text
         FROM public.fuel_entries WHERE company_id = $1 AND id = $2`,
      [actor.companyId, fuelEntryId],
    );
    if (!entry.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    }
    const row = entry.rows[0];
    await client.query(
      `INSERT INTO public.fuel_entry_revisions
         (id, company_id, fuel_entry_id, base_version, reason, author_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        `fer_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        actor.companyId,
        row.id,
        row.version,
        input.reason.trim(),
        actor.userId,
        JSON.stringify(input.payload),
      ],
    );
    const newMeter = typeof input.payload.meterReading === "number" ? input.payload.meterReading : null;
    const previousMeter = row.meter_reading === null ? null : Number(row.meter_reading);
    if (newMeter != null && previousMeter != null && newMeter < previousMeter) {
      await client.query("SELECT set_config('app.meter_amendment', '1', true)");
      await client.query(
        `INSERT INTO public.machine_meter_readings
           (id, company_id, machine_id, reading_value, recorded_at, source, fuel_entry_id, actor_id)
         VALUES ($1, $2, $3, $4, clock_timestamp(), 'FUEL', $5, $6)`,
        [
          `mmr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          actor.companyId,
          row.machine_id,
          newMeter,
          row.id,
          actor.userId,
        ],
      );
    }
    /*
     * Ispravka izvornog zapisa gasi trošak koji je od njega nastao (§1.3.16). Bez ovoga bi ledger
     * i dalje nosio stari iznos i marža projekta bi bila pogrešna — i to bez traga da je izvor
     * promijenjen.
     */
    await reverseSourceCost(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      sourceType: "FUEL_ENTRY",
      sourceId: row.id,
      reason: input.reason,
    });
    return { outcome: "OK", id: row.id };
  });
}