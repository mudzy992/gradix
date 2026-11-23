/** Office writes a previously unknown fuel amount. A known amount, including zero, is not replaced. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency, type Currency } from "@gradix/domain";
import { writeAudit } from "./audit";
import { canViewFuelPrice } from "./fuel-entry-price";
import { resolveFuelAmount } from "./fuel-entry-money";
import type { FuelEntryActor, MutationOutcome } from "./fuel-entry-types";

export async function setFuelAmount(
  pool: Pool,
  actor: FuelEntryActor,
  fuelEntryId: string,
  totalAmount: string,
): Promise<MutationOutcome> {
  if (!canViewFuelPrice(actor.roles)) {
    return { outcome: "FORBIDDEN", code: "ROLE", message: "Cijenu unosi ured." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const found = await client.query<{ currency_code: string; amount_cents: string | null }>(
      `SELECT currency_code, amount_cents::text
         FROM public.fuel_entries
        WHERE company_id = $1 AND id = $2
        FOR UPDATE`,
      [actor.companyId, fuelEntryId],
    );
    const row = found.rows[0];
    if (!row) return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    if (row.amount_cents !== null) {
      return { outcome: "CONFLICT", code: "AMOUNT_SET", message: "Iznos je već unesen." };
    }
    const currency: Currency = isCurrency(row.currency_code) ? row.currency_code : "BAM";
    const priced = resolveFuelAmount({ canPrice: true, totalAmount, currency });
    if (!priced.ok || priced.cents === null) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "AMOUNT",
        message: priced.ok ? "Neispravan iznos." : priced.message,
      };
    }
    const updated = await client.query(
      `UPDATE public.fuel_entries
          SET amount_cents = $3, updated_by = $4, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2 AND amount_cents IS NULL`,
      [actor.companyId, fuelEntryId, priced.cents.toString(), actor.userId],
    );
    if (updated.rowCount !== 1) {
      return { outcome: "CONFLICT", code: "AMOUNT_SET", message: "Iznos je već unesen." };
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "fuel.priced",
      entityType: "fuel_entry",
      entityId: fuelEntryId,
      metadata: { amountCents: priced.cents.toString(), currency },
    });
    return { outcome: "OK", id: fuelEntryId };
  });
}
