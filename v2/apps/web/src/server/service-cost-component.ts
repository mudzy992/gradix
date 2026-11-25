/**
 * F8 — stvarni mjesečni trošak servisa u komponentu `SERVICE` stope mašine (spec 09 §1.4/22).
 *
 * Zašto ovo postoji: `SERVICE` komponenta je do sada bila PROCJENA koju je firma unijela ručno
 * („servis nas izađe 300 KM mjesečno“). Kad se pojave stvarni nalozi, procjena ostaje na snazi za
 * budućnost, ali TEKUĆI mjesec dobija STVARNI iznos — pa stopa sata prestaje biti nagađanje.
 *
 * Tri granice koje se ne prelaze:
 *  1. **Historijski snapshot ostaje.** Stari obračuni koriste stopu koja je važila tada; mijenjanje
 *     unazad bi prepisalo cijenu rada koji je već naplaćen.
 *  2. **Samo komponenta `SERVICE`.** Ostale komponente (gorivo, amortizacija) imaju svoje izvore.
 *  3. **Samo kad je iznos veći od nule.** Nula bi izbrisala procjenu firme i stopa bi pala na
 *     iznos bez servisa — što nije istina, nego nedostatak podataka.
 */
import type { PoolClient } from "pg";
import { computedRatePerHour } from "@gradix/domain";

export type ServiceComponentSync = {
  updated: boolean;
  amountCents: string | null;
  reason?: string;
};

export async function syncServiceComponentFromActuals(
  client: PoolClient,
  params: { companyId: string; machineId: string; month: string; actorId: string },
): Promise<ServiceComponentSync> {
  const total = await client.query<{ cents: string }>(
    `SELECT COALESCE(SUM(amount_cents), 0)::text AS cents
       FROM public.cost_entries
      WHERE company_id = $1 AND machine_id = $2 AND source_type = 'SERVICE_ORDER'
        AND status = 'POSTED'
        AND date_trunc('month', occurred_on) = date_trunc('month', $3::date)`,
    [params.companyId, params.machineId, `${params.month}-01`],
  );
  const cents = BigInt(total.rows[0]?.cents ?? "0");
  if (cents <= 0n) {
    return { updated: false, amountCents: null, reason: "NO_ACTUAL_COST" };
  }

  /* Komponenta važi od prvog dana mjeseca — mjesec je period obračuna, a ne dan kad je nalog
     završen. Tako stopa za taj mjesec važi cijeli mjesec, bez miješanja dvije vrijednosti. */
  const validFrom = `${params.month}-01`;
  const existing = await client.query<{ id: string; amount_cents: string; currency_code: string }>(
    `SELECT id, amount_cents::text, currency_code FROM public.machine_cost_components
      WHERE company_id = $1 AND machine_id = $2 AND component = 'SERVICE'
        AND valid_from = $3::date
      LIMIT 1`,
    [params.companyId, params.machineId, validFrom],
  );
  const currency = await client.query<{ currency: string }>(
    "SELECT currency FROM public.companies WHERE id = $1",
    [params.companyId],
  );
  const currencyCode = currency.rows[0]?.currency ?? "BAM";

  if (existing.rows[0]) {
    if (BigInt(existing.rows[0].amount_cents) === cents) {
      return { updated: false, amountCents: cents.toString(), reason: "ALREADY_CURRENT" };
    }
    await client.query(
      `UPDATE public.machine_cost_components
          SET amount_cents = $3, note = $4 WHERE company_id = $1 AND id = $2`,
      [
        params.companyId,
        existing.rows[0].id,
        cents.toString(),
        `Stvarni trošak servisa za ${params.month}`,
      ],
    );
    return { updated: true, amountCents: cents.toString() };
  }

  await client.query(
    `INSERT INTO public.machine_cost_components
       (id, company_id, machine_id, component, amount_cents, currency_code, basis, valid_from,
        note, created_by)
     VALUES ($1,$2,$3,'SERVICE',$4,$5,'PER_MONTH',$6::date,$7,$8)`,
    [
      `mcc_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`,
      params.companyId,
      params.machineId,
      cents.toString(),
      currencyCode,
      validFrom,
      `Stvarni trošak servisa za ${params.month}`,
      params.actorId,
    ],
  );
  return { updated: true, amountCents: cents.toString() };
}

/**
 * Stopa po satu SA stvarnim servisom, za prikaz na kartici mašine. Snapshot se NE piše ovdje —
 * snapshot nastaje pri knjiženju rada, pa prikaz ne smije mijenjati istoriju.
 */
export async function ratePreview(
  client: PoolClient,
  params: { companyId: string; machineId: string; onDate: string },
): Promise<{ rateCents: bigint; components: { component: string; centsPerHour: string }[] } | null> {
  const rows = await client.query<{
    component: string;
    basis: "PER_HOUR" | "PER_MONTH" | "PER_KM";
    amount_cents: string;
    currency_code: string;
  }>(
    `SELECT component, basis, amount_cents::text, currency_code
       FROM public.machine_cost_components
      WHERE company_id = $1 AND machine_id = $2
        AND valid_from <= $3::date AND (valid_to IS NULL OR valid_to >= $3::date)
      ORDER BY component`,
    [params.companyId, params.machineId, params.onDate],
  );
  if (rows.rows.length === 0) return null;
  const hours = await client.query<{ planned_hours_per_month: number }>(
    "SELECT planned_hours_per_month FROM public.companies WHERE id = $1",
    [params.companyId],
  );
  const plannedHours = Number(hours.rows[0]?.planned_hours_per_month ?? 160) || 160;
  const computed = computedRatePerHour(
    rows.rows.map((row) => ({
      component: row.component as never,
      basis: row.basis,
      amountCents: BigInt(row.amount_cents),
      currencyCode: row.currency_code,
    })),
    plannedHours,
  );
  return {
    rateCents: computed.rateCents,
    components: computed.breakdown.map((entry) => ({
      component: entry.component,
      centsPerHour: entry.centsPerHour.toString(),
    })),
  };
}
