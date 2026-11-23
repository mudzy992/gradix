/** R5.2: fuel list and create. Revise in fuel-entry-revise.ts. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency } from "@gradix/domain";
import { can } from "./permissions";
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
    let idx = 2;
    if (isFieldOnly && viewerWorkerId) {
      conditions.push(`fe.driver_worker_id = $${idx}`);
      params.push(viewerWorkerId);
      idx += 1;
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
    const result = await client.query<DbFuelRow>(
      `SELECT fe.id, fe.machine_id, m.code AS machine_code, m.name AS machine_name,
              fe.driver_worker_id, w.first_name || ' ' || w.last_name AS driver_name,
              fe.project_id, p.code AS project_code, p.name AS project_name,
              fe.filled_at::text, fe.liters::text,
              fe.amount_cents::text, fe.currency_code,
              fe.unit_price_cents::text, fe.meter_reading::text,
              fe.note, fe.version, fe.created_at::text
         FROM public.fuel_entries fe
         JOIN public.machines m ON m.company_id = fe.company_id AND m.id = fe.machine_id
         JOIN public.workers w ON w.company_id = fe.company_id AND w.id = fe.driver_worker_id
         LEFT JOIN public.projects p ON p.company_id = fe.company_id AND p.id = fe.project_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY fe.filled_at DESC, fe.id
        LIMIT 500`,
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
    const id = `fuel_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.fuel_entries
           (id, company_id, machine_id, driver_worker_id, project_id, filled_at,
            liters, amount_cents, currency_code, unit_price_cents, meter_reading, note,
            created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          id, actor.companyId, input.machineId, driverId, input.projectId ?? null, input.filledAt,
          input.liters, priced.cents?.toString() ?? null, priced.currency, unitPriceCents?.toString() ?? null,
          input.meterReading ?? null, input.note ?? null, actor.userId,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("METER_READING_REGRESSION")) {
        return { outcome: "CONFLICT", code: "METER", message: "Brojilo ne smije ići unazad bez ispravke." };
      }
      throw error;
    }
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