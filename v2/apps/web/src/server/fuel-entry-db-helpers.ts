/** R5.2 DB row mapping and small helpers for fuel entries. */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isCurrency, toAmountString, type Currency } from "@gradix/domain";
import type { FuelEntryActor, FuelEntryRow } from "./fuel-entry-types";

export type DbFuelRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  driver_worker_id: string;
  driver_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  filled_at: string;
  liters: string;
  amount_cents: string | null;
  currency_code: string | null;
  unit_price_cents: string | null;
  meter_reading: string | null;
  note: string | null;
  version: number;
  created_at: string;
  price_source?: string | null;
  tank_id?: string | null;
  deviation_pct?: string | null;
  deviation_status?: string | null;
};

export function mapFuelRow(row: DbFuelRow, showPrice: boolean): FuelEntryRow {
  const liters = Number(row.liters);
  const unitCents = row.unit_price_cents === null ? null : BigInt(row.unit_price_cents);
  return {
    id: row.id,
    machine_id: row.machine_id,
    machine_code: row.machine_code,
    machine_name: row.machine_name,
    driver_worker_id: row.driver_worker_id,
    driver_name: row.driver_name,
    project_id: row.project_id,
    project_code: row.project_code,
    project_name: row.project_name,
    filled_at: row.filled_at,
    liters,
    amount: showPrice && row.amount_cents !== null && row.currency_code
      ? toAmountString({ cents: BigInt(row.amount_cents), currency: row.currency_code as Currency })
      : null,
    currency_code: showPrice ? row.currency_code : null,
    unit_price: showPrice && unitCents !== null && row.currency_code
      ? toAmountString({ cents: unitCents, currency: row.currency_code as Currency })
      : null,
    meter_reading: row.meter_reading === null ? null : Number(row.meter_reading),
    note: row.note,
    version: row.version,
    created_at: row.created_at,
    /*
     * F4 polja su opciona u DB tipu jer ih stari upiti (prije F4) ne selektuju; izostanak
     * znači „nije primjenjivo", ne „MANUAL". Zato default `MANUAL` — stari zapisi su svi bili
     * ručni, jer šifarnik cijena nije postojao.
     */
    price_source: row.price_source === "PRICE_LIST" ? "PRICE_LIST" : "MANUAL",
    tank_id: row.tank_id ?? null,
    deviation_pct: row.deviation_pct == null ? null : Number(row.deviation_pct),
    deviation_status:
      row.deviation_status === "OPEN" || row.deviation_status === "EXPLAINED" || row.deviation_status === "DISMISSED"
        ? row.deviation_status
        : null,
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

export async function resolveFuelActorWorkerId(client: PoolClient, actor: FuelEntryActor): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT w.id FROM public.workers w
      WHERE w.company_id = $1 AND w.user_id = $2 AND w.is_active LIMIT 1`,
    [actor.companyId, actor.userId],
  );
  return result.rows[0]?.id ?? null;
}

export async function insertMeterFromFuel(
  client: PoolClient,
  actor: FuelEntryActor,
  machineId: string,
  value: number,
  fuelEntryId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO public.machine_meter_readings
       (id, company_id, machine_id, reading_value, recorded_at, source, fuel_entry_id, actor_id)
     VALUES ($1, $2, $3, $4, clock_timestamp(), 'FUEL', $5, $6)`,
    [
      `mmr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      actor.companyId,
      machineId,
      value,
      fuelEntryId,
      actor.userId,
    ],
  );
}