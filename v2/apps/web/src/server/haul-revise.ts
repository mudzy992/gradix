/** R5.3: append-only revision of hauls (original row untouched). */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import { reverseSourceCost } from "./cost-entry-service";
import type { HaulActor, MutationOutcome } from "./haul-types";

export type ReviseInput = { reason: string; payload: Record<string, unknown> };

export async function reviseHaul(
  pool: Pool,
  actor: HaulActor,
  haulId: string,
  input: ReviseInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.haul.revise")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.reason.trim().length < 10) {
    return { outcome: "VALIDATION_FAILED", code: "REASON_TOO_SHORT", message: "Razlog ≥10 znakova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const haul = await client.query<{
      id: string;
      version: number;
      origin_text: string;
      destination_text: string;
      material_text: string;
      quantity: string;
      quantity_unit: string;
      scale_ticket_text: string | null;
      trip_count: number;
      note: string | null;
      segment_id: string | null;
    }>(
      `SELECT id, version, origin_text, destination_text, material_text,
              quantity::text, quantity_unit, scale_ticket_text, trip_count, note, segment_id
         FROM public.hauls WHERE company_id = $1 AND id = $2`,
      [actor.companyId, haulId],
    );
    if (!haul.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    }
    const row = haul.rows[0];
    const original = {
      originText: row.origin_text,
      destinationText: row.destination_text,
      materialText: row.material_text,
      quantity: Number(row.quantity),
      quantityUnit: row.quantity_unit,
      scaleTicketText: row.scale_ticket_text,
      tripCount: row.trip_count,
      note: row.note,
      segmentId: row.segment_id,
    };
    await client.query(
      `INSERT INTO public.haul_revisions
         (id, company_id, haul_id, base_version, reason, author_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        `hrv_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        actor.companyId,
        row.id,
        row.version,
        input.reason.trim(),
        actor.userId,
        JSON.stringify({ original, ...input.payload }),
      ],
    );
    // Tura se knjiži kao `PENDING` (cijena dolazi iz dionice), pa storno skida i taj red.
    await reverseSourceCost(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      sourceType: "HAUL",
      sourceId: row.id,
      reason: input.reason,
    });
    return { outcome: "OK", id: row.id };
  });
}
