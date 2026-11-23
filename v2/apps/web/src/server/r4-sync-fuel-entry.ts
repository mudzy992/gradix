/** R5.2: sync push handler for fuel_entry. */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isCurrency, toAmountString, type R4FuelEntryPushItem, type R4SyncPushItemResult } from "@gradix/domain";
import { assertUnitPriceConsistent, parseFuelMoney, resolveFuelAmount } from "./fuel-entry-money";
import { canViewFuelPrice } from "./fuel-entry-price";
import { encodeSyncCursor } from "./sync-cursor";
import type { SyncFuelEntryApplyDeps } from "./r4-sync-fuel-entry-types";

export type { SyncFuelEntryApplyDeps } from "./r4-sync-fuel-entry-types";

export async function applyFuelEntrySyncItem(
  client: PoolClient,
  deps: SyncFuelEntryApplyDeps,
  item: R4FuelEntryPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  const machine = await client.query<{ id: string }>(
    "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2 AND is_active",
    [actor.companyId, item.entry.machineId],
  );
  if (!machine.rows[0]) return reject();
  if (item.entry.projectId) {
    const project = await client.query<{ id: string }>(
      "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, item.entry.projectId],
    );
    if (!project.rows[0]) return reject();
  }
  const currency = isCurrency(item.entry.currencyCode) ? item.entry.currencyCode : null;
  if (!currency) return reject();
  const priced = resolveFuelAmount({
    canPrice: canViewFuelPrice(actor.roles),
    totalAmount: item.entry.totalAmount,
    currency,
  });
  if (!priced.ok) return reject();
  let unitPriceCents: bigint | null = null;
  if (item.entry.unitPriceAmount) {
    if (priced.cents === null) return reject();
    try {
      unitPriceCents = parseFuelMoney(item.entry.unitPriceAmount, currency).cents;
    } catch {
      return reject();
    }
  }
  if (priced.cents !== null && !assertUnitPriceConsistent(
    { cents: priced.cents, currency: priced.currency },
    item.entry.liters,
    unitPriceCents,
  )) return reject();

  const duplicate = await client.query<{ id: string; version: number }>(
    `SELECT id, version FROM public.fuel_entries WHERE company_id = $1 AND id = $2`,
    [actor.companyId, item.fuelEntryId],
  );
  if (duplicate.rows[0]) {
    return reject({
      ...helpers.invalidItem(item),
      entityId: duplicate.rows[0].id,
      version: duplicate.rows[0].version,
    });
  }
  const workDate = await helpers.businessDate(client, item.entry.filledAt);
  if (!workDate) return reject();
  try {
    const inserted = await client.query<{ id: string; version: number }>(
      `INSERT INTO public.fuel_entries
         (id, company_id, machine_id, driver_worker_id, project_id, filled_at,
          liters, amount_cents, currency_code, unit_price_cents, meter_reading, note,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, $11, $12, $13, $13)
       RETURNING id, version`,
      [
        item.fuelEntryId, actor.companyId, item.entry.machineId, worker.id, item.entry.projectId,
        item.entry.filledAt, item.entry.liters, priced.cents?.toString() ?? null, priced.currency,
        unitPriceCents?.toString() ?? null, item.entry.meterReading, item.entry.note, actor.userId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) return reject();
    if (item.entry.meterReading != null) {
      await client.query(
        `INSERT INTO public.machine_meter_readings
           (id, company_id, machine_id, reading_value, recorded_at, source, fuel_entry_id, actor_id)
         VALUES ($1, $2, $3, $4, clock_timestamp(), 'FUEL', $5, $6)`,
        [
          `mmr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          actor.companyId,
          item.entry.machineId,
          item.entry.meterReading,
          row.id,
          actor.userId,
        ],
      );
    }
    const showPrice = canViewFuelPrice(actor.roles);
    const payload = {
      id: row.id,
      machineId: item.entry.machineId,
      driverWorkerId: worker.id,
      driverName: `${worker.first_name} ${worker.last_name}`.trim(),
      workDate,
      filledAt: item.entry.filledAt,
      liters: item.entry.liters,
      amount: showPrice && priced.cents !== null
        ? toAmountString({ cents: priced.cents, currency: priced.currency })
        : null,
      currencyCode: showPrice ? priced.currency : null,
      meterReading: item.entry.meterReading,
      note: item.entry.note,
      projectId: item.entry.projectId,
      version: row.version,
      clientLocalId: item.localId,
    };
    await helpers.publishEvent(client, actor, reservation, requestHash, "fuel_entry", row.id, row.version, payload);
    const result: R4SyncPushItemResult = {
      localId: item.localId,
      status: "APPLIED",
      entityId: row.id,
      version: row.version,
      cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
    };
    await helpers.saveReceipt(client, actor, item, requestHash, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("METER_READING_REGRESSION")) {
      return helpers.createConflict(
        client, actor, worker, item, workDate, requestHash, reservation,
        null, null, "METER_READING_REGRESSION",
      );
    }
    throw error;
  }
}