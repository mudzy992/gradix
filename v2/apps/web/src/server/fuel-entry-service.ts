/** R5.2: fuel list and create. Revise in fuel-entry-revise.ts. */
import { machineActivityScope, machineActivityTargetAllowed } from "./machine-activity-scope";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency, type Currency } from "@gradix/domain";
import { can } from "./permissions";
import { bookFuelEntryCost } from "./cost-entry-service";
import { resolveViewerWorkerId } from "./workday-review";
import { canViewFuelPrice } from "./fuel-entry-price";
import { assertUnitPriceConsistent, parseFuelMoney, resolveFuelAmount } from "./fuel-entry-money";
import {
  type DbFuelRow,
  companyCurrency,
  insertMeterFromFuel,
  mapFuelRow,
  resolveFuelActorWorkerId,
} from "./fuel-entry-db-helpers";
import { assessFuelDeviation, suggestedFuelPrice } from "./fuel-price-service";
import type {
  CreateInput,
  FuelEntryActor,
  FuelEntryRow,
  ListFilters,
  MutationOutcome,
} from "./fuel-entry-types";

export type {
  CreateInput,
  FuelEntryActor,
  FuelEntryRow,
  ListFilters,
  MutationOutcome,
} from "./fuel-entry-types";
export { reviseFuelEntry } from "./fuel-entry-revise";

export async function listFuelEntries(
  pool: Pool,
  actor: FuelEntryActor,
  filters: ListFilters,
): Promise<FuelEntryRow[]> {
  if (!can(actor.roles, "machines.fuel.view")) return [];
  const showPrice = canViewFuelPrice(actor.roles);
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, actor.companyId, actor.userId);
    const fieldRoles = ["DRIVER", "MACHINE_OPERATOR"];
    const isFieldOnly = actor.roles.some((r) => fieldRoles.includes(r))
      && !actor.roles.some((r) =>
        ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"].includes(r),
      );
    const conditions = ["fe.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    conditions.push(machineActivityScope(actor, params, "fe", "driver_worker_id"));
    let idx = params.length + 1;
    if (isFieldOnly) {
      if (viewerWorkerId) {
        conditions.push(`fe.driver_worker_id = $${idx}`);
        params.push(viewerWorkerId);
        idx += 1;
      } else conditions.push("false");
    }
    if (filters.machineId) {
      conditions.push(`fe.machine_id = $${idx}`);
      params.push(filters.machineId);
      idx += 1;
    }
    if (filters.from) {
      conditions.push(`fe.filled_at >= $${idx}::timestamptz`);
      params.push(filters.from);
      idx += 1;
    }
    if (filters.to) {
      conditions.push(`fe.filled_at <= $${idx}::timestamptz`);
      params.push(filters.to);
      idx += 1;
    }
    if (filters.untilExclusive) {
      conditions.push(`fe.filled_at < $${idx}::timestamptz`);
      params.push(filters.untilExclusive);
      idx += 1;
    }
    if (filters.projectIds != null) {
      conditions.push(`fe.project_id = ANY($${idx}::text[])`);
      params.push(filters.projectIds);
      idx += 1;
    }
    if (filters.projectId) {
      conditions.push(`fe.project_id = $${idx}`);
      params.push(filters.projectId);
      idx += 1;
    }
    if (filters.team) {
      conditions.push(`w.team = $${idx}`);
      params.push(filters.team);
      idx += 1;
    }
    const limit = Math.min(Math.max(filters.limit ?? 500, 1), 10001);
    params.push(limit);
    const result = await client.query<DbFuelRow>(
      `SELECT fe.id, fe.machine_id, m.code AS machine_code, m.name AS machine_name,
              fe.driver_worker_id, w.first_name || ' ' || w.last_name AS driver_name,
              fe.project_id, p.code AS project_code, p.name AS project_name,
              fe.filled_at::text, fe.liters::text,
              fe.amount_cents::text, fe.currency_code,
              fe.unit_price_cents::text, fe.meter_reading::text,
              fe.note, fe.version, fe.created_at::text,
              fe.price_source, fe.tank_id, fe.deviation_pct::text, fe.deviation_status
         FROM public.fuel_entries fe
         JOIN public.machines m ON m.company_id = fe.company_id AND m.id = fe.machine_id
         JOIN public.workers w ON w.company_id = fe.company_id AND w.id = fe.driver_worker_id
         LEFT JOIN public.projects p ON p.company_id = fe.company_id AND p.id = fe.project_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY fe.filled_at DESC, fe.id
        LIMIT $${idx}`,
      params,
    );
    return result.rows.map((row) => mapFuelRow(row, showPrice));
  });
}

export async function createFuelEntry(
  pool: Pool,
  actor: FuelEntryActor,
  input: CreateInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.fuel.create")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!(input.liters > 0)) {
    return { outcome: "VALIDATION_FAILED", code: "LITERS", message: "Litara mora biti veća od nule." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const currency = input.currencyCode && isCurrency(input.currencyCode)
      ? input.currencyCode
      : await companyCurrency(client, actor.companyId);
    const priced = resolveFuelAmount({
      canPrice: canViewFuelPrice(actor.roles),
      totalAmount: input.totalAmount,
      currency,
    });
    if (!priced.ok) return { outcome: "VALIDATION_FAILED", code: "AMOUNT", message: priced.message };
    let unitPriceCents: bigint | null = null;
    if (input.unitPriceAmount) {
      if (priced.cents === null) {
        return { outcome: "VALIDATION_FAILED", code: "UNIT_PRICE", message: "Jedinična cijena traži poznat iznos." };
      }
      try {
        unitPriceCents = parseFuelMoney(input.unitPriceAmount, currency).cents;
      } catch {
        return { outcome: "VALIDATION_FAILED", code: "UNIT_PRICE", message: "Neispravna jedinična cijena." };
      }
    }
    if (priced.cents !== null && !assertUnitPriceConsistent(
      { cents: priced.cents, currency: priced.currency },
      input.liters,
      unitPriceCents,
    )) {
      return { outcome: "VALIDATION_FAILED", code: "PRICE_MATH", message: "Ukupno ne odgovara litara × cijena." };
    }
    const officeRoles = ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"];
    const isOffice = actor.roles.some((role) => officeRoles.includes(role));
    let driverId: string | null = null;
    if (isOffice && input.driverWorkerId) {
      const exists = await client.query<{ id: string }>(
        `SELECT id FROM public.workers WHERE company_id = $1 AND id = $2 AND is_active`,
        [actor.companyId, input.driverWorkerId],
      );
      driverId = exists.rows[0]?.id ?? null;
      if (!driverId) {
        return { outcome: "VALIDATION_FAILED", code: "DRIVER", message: "Vozač nije pronađen." };
      }
    } else {
      driverId = await resolveFuelActorWorkerId(client, actor);
    }
    if (!driverId) {
      return {
        outcome: "FORBIDDEN",
        code: "NO_WORKER",
        message: isOffice ? "Izaberi vozača za unos." : "Nalog nije povezan s radnikom.",
      };
    }
    if (!await machineActivityTargetAllowed(client, actor, input.projectId, driverId)) {
      return { outcome: "FORBIDDEN", code: "SCOPE", message: "Zapis nije u vašem opsegu." };
    }
    /*
     * F4 §1.3.10: cijena se PREDLAŽE iz šifarnika po datumu točenja. Predlog se koristi samo kad
     * korisnik nije poslao iznos — ako je poslao, njegov iznos je istina i zapis nosi
     * `price_source = MANUAL`. Predlog nikad ne prepisuje uneseni iznos: to bi bio sistem koji
     * „zna bolje" od računa.
     */
    let finalCents = priced.cents;
    let finalCurrency: Currency = priced.currency;
    let finalUnitPrice = unitPriceCents;
    let priceSource: "PRICE_LIST" | "MANUAL" = "MANUAL";
    if (finalCents === null) {
      const suggestion = await suggestedFuelPrice(
        client,
        actor.companyId,
        "DIESEL",
        input.filledAt.slice(0, 10),
      );
      if (suggestion) {
        const suggestionCents = BigInt(suggestion.price_cents);
        const suggestionCurrency = (isCurrency(suggestion.currency_code) ? suggestion.currency_code : "BAM") as Currency;
        // Ukupan iznos = litre × cijena, zaokruženo preko Money (isti put kao ručni unos).
        finalCents = BigInt(Math.round(input.liters * 100)) * suggestionCents / 100n;
        finalCurrency = suggestionCurrency;
        finalUnitPrice = suggestionCents;
        priceSource = "PRICE_LIST";
      }
    }

    /*
     * F4 §1.3.14: cisterna i pumpa se NIKAD ne vode paralelno. Cisterna postoji samo ako je
     * uključena PO FIRMI; bez nje točenje je na pumpi i stanja nema. Servis odbija `tankId` kad
     * je cisterna isključena, a baza odbija stanje veće od kapaciteta.
     */
    let tankId: string | null = null;
    let tankWarehouse: { warehouse_id: string; fuel_item_id: string } | null = null;
    if (input.tankId) {
      const tanksEnabled = await client.query<{ fuel_tank_enabled: boolean }>(
        "SELECT fuel_tank_enabled FROM public.companies WHERE id = $1",
        [actor.companyId],
      );
      if (!tanksEnabled.rows[0]?.fuel_tank_enabled) {
        return {
          outcome: "VALIDATION_FAILED",
          code: "TANK_DISABLED",
          message: "Cisterna nije uključena u postavkama firme — točenje ide na pumpu.",
        };
      }
      const location = await client.query<{ warehouse_id: string }>(
        "SELECT warehouse_id FROM public.fuel_tanks WHERE company_id=$1 AND id=$2 AND is_active", [actor.companyId, input.tankId],
      );
      if (!location.rows[0]) return { outcome: "VALIDATION_FAILED", code: "TANK", message: "Cisterna nije pronađena." };
      const locked = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1 || ':' || $2,0)) AS locked", [actor.companyId, location.rows[0].warehouse_id],
      );
      if (!locked.rows[0]?.locked) return { outcome: "CONFLICT", code: "STOCK_COUNT_IN_PROGRESS", message: "Popis ili kretnja su u toku." };
      const tank = await client.query<{ capacity_l: string; current_l: string; warehouse_id: string; fuel_item_id: string }>(
        `SELECT t.capacity_l::text,t.warehouse_id,t.fuel_item_id,
           COALESCE((SELECT sum(CASE WHEN sm.kind='IN' THEN sm.quantity WHEN sm.kind='OUT' THEN -sm.quantity
                   WHEN sm.kind='COUNT' AND NOT sm.legacy_ignored THEN sm.quantity ELSE 0 END)
             FROM public.stock_movements sm WHERE sm.company_id=t.company_id AND sm.warehouse_id=t.warehouse_id
              AND sm.item_id=t.fuel_item_id),0)::text AS current_l
          FROM public.fuel_tanks t WHERE t.company_id=$1 AND t.id=$2 AND t.is_active FOR UPDATE OF t`,
        [actor.companyId, input.tankId],
      );
      if (!tank.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "TANK", message: "Cisterna nije pronađena." };
      }
      const remaining = Number(tank.rows[0].current_l) - input.liters;
      if (remaining < 0) {
        return {
          outcome: "VALIDATION_FAILED",
          code: "TANK_LEVEL",
          message: `U cisterni nema dovoljno goriva (stanje ${Number(tank.rows[0].current_l)} l). Popiši stanje ili unesi točenje na pumpi.`,
        };
      }
      tankId = input.tankId;
      tankWarehouse = { warehouse_id: tank.rows[0].warehouse_id, fuel_item_id: tank.rows[0].fuel_item_id };
    }

    // F4 §1.3.13: odstupanje potrošnje. Upozorenje, NIKAD blokada — unos je uvijek dopušten.
    const deviation = await assessFuelDeviation(client, {
      companyId: actor.companyId,
      machineId: input.machineId,
      filledAt: input.filledAt,
      liters: input.liters,
      meterReading: input.meterReading ?? null,
    });

    const id = `fuel_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.fuel_entries
           (id, company_id, machine_id, driver_worker_id, project_id, filled_at,
            liters, amount_cents, currency_code, unit_price_cents, meter_reading, note,
            created_by, updated_by, price_source, tank_id, deviation_pct, deviation_status)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, $11, $12, $13, $13, $14, $15, $16, $17)`,
        [
          id, actor.companyId, input.machineId, driverId, input.projectId ?? null, input.filledAt,
          input.liters, finalCents?.toString() ?? null, finalCurrency,
          finalUnitPrice?.toString() ?? null,
          input.meterReading ?? null, input.note ?? null, actor.userId,
          priceSource, tankId,
          deviation.deviationPct === null ? null : deviation.deviationPct.toFixed(2),
          deviation.status,
        ],
      );
      if (tankWarehouse) {
        await client.query(
          `INSERT INTO public.stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,occurred_on,source_type,source_id,created_by)
           VALUES ($1,$2,$3,$4,'OUT',$5,($6::timestamptz)::date,'FUEL_ENTRY',$7,$8)`,
          [`stm_${randomUUID().replace(/-/g, "")}`, actor.companyId, tankWarehouse.fuel_item_id,
            tankWarehouse.warehouse_id, input.liters, input.filledAt, id, actor.userId],
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("METER_READING_REGRESSION")) {
        return { outcome: "CONFLICT", code: "METER", message: "Brojilo ne smije ići unazad bez ispravke." };
      }
      throw error;
    }
    /*
     * F5 (§1.3.13): točenje knjiži trošak odmah — sa iznosom ako postoji, inače `PENDING` sa
     * litrima. `setFuelAmount` kasnije prelazi `PENDING` → `POSTED` (jednom, kroz triger).
     */
    await bookFuelEntryCost(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      fuelEntryId: id,
    });
    if (input.meterReading != null) {
      try {
        await insertMeterFromFuel(client, actor, input.machineId, input.meterReading, id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("METER_READING_REGRESSION")) {
          return { outcome: "CONFLICT", code: "METER", message: "Brojilo ne smije ići unazad bez ispravke." };
        }
        throw error;
      }
    }
    return { outcome: "OK", id };
  });
}