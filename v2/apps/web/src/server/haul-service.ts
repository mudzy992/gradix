/** R5.3: haul list and create. Revise in haul-revise.ts. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import { resolveViewerWorkerId } from "./workday-review";
import { isQuantityUnit, mapHaulRow, resolveHaulActorWorkerId, type DbHaulRow } from "./haul-db-helpers";
import type { CreateInput, HaulActor, HaulRow, ListFilters, MutationOutcome } from "./haul-types";

export type { CreateInput, HaulActor, HaulRow, ListFilters, MutationOutcome } from "./haul-types";
export { reviseHaul } from "./haul-revise";

export async function listHauls(
  pool: Pool,
  actor: HaulActor,
  filters: ListFilters,
): Promise<HaulRow[]> {
  if (!can(actor.roles, "machines.haul.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, actor.companyId, actor.userId);
    const isFieldOnly = actor.roles.includes("DRIVER")
      && !actor.roles.some((r) =>
        ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"].includes(r),
      );
    const conditions = ["h.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    let idx = 2;
    if (isFieldOnly && viewerWorkerId) {
      conditions.push(`h.driver_worker_id = $${idx}`);
      params.push(viewerWorkerId);
      idx += 1;
    }
    if (filters.machineId) {
      conditions.push(`h.machine_id = $${idx}`);
      params.push(filters.machineId);
      idx += 1;
    }
    if (filters.from) {
      conditions.push(`h.hauled_at >= $${idx}::timestamptz`);
      params.push(filters.from);
      idx += 1;
    }
    if (filters.to) {
      conditions.push(`h.hauled_at <= $${idx}::timestamptz`);
      params.push(filters.to);
      idx += 1;
    }
    const result = await client.query<DbHaulRow>(
      `SELECT h.id, h.machine_id, m.code AS machine_code, m.name AS machine_name,
              h.driver_worker_id, w.first_name || ' ' || w.last_name AS driver_name,
              h.project_id, p.code AS project_code, p.name AS project_name,
              h.segment_id, rs.code AS segment_code, rs.name AS segment_name,
              h.hauled_at::text, h.origin_text, h.destination_text, h.material_text,
              h.quantity::text, h.quantity_unit, h.scale_ticket_text, h.trip_count,
              h.note, h.version, h.created_at::text
         FROM public.hauls h
         JOIN public.machines m ON m.company_id = h.company_id AND m.id = h.machine_id
         JOIN public.workers w ON w.company_id = h.company_id AND w.id = h.driver_worker_id
         LEFT JOIN public.projects p ON p.company_id = h.company_id AND p.id = h.project_id
         LEFT JOIN public.route_segments rs ON rs.company_id = h.company_id AND rs.id = h.segment_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY h.hauled_at DESC, h.id
        LIMIT 500`,
      params,
    );
    return result.rows.map(mapHaulRow);
  });
}

export async function createHaul(
  pool: Pool,
  actor: HaulActor,
  input: CreateInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.haul.create")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!(input.quantity > 0)) {
    return { outcome: "VALIDATION_FAILED", code: "QUANTITY", message: "Količina mora biti veća od nule." };
  }
  if (!isQuantityUnit(input.quantityUnit)) {
    return { outcome: "VALIDATION_FAILED", code: "UNIT", message: "Jedinica mora biti M3 ili T." };
  }
  const tripCount = input.tripCount ?? 1;
  if (!Number.isInteger(tripCount) || tripCount < 1) {
    return { outcome: "VALIDATION_FAILED", code: "TRIP_COUNT", message: "Broj tura mora biti ≥ 1." };
  }
  const origin = input.originText.trim();
  const destination = input.destinationText.trim();
  const material = input.materialText.trim();
  if (!origin || !destination || !material) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "ROUTE",
      message: "Polazište, odredište i materijal su obavezni.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const officeRoles = ["OWNER", "ADMIN", "PROJECT_MANAGER"];
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
      driverId = await resolveHaulActorWorkerId(client, actor);
    }
    if (!driverId) {
      return {
        outcome: "FORBIDDEN",
        code: "NO_WORKER",
        message: isOffice ? "Izaberi vozača za unos." : "Nalog nije povezan s radnikom.",
      };
    }
    if (input.segmentId) {
      const segment = await client.query<{ id: string }>(
        `SELECT id FROM public.route_segments WHERE company_id = $1 AND id = $2`,
        [actor.companyId, input.segmentId],
      );
      if (!segment.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "SEGMENT", message: "Dionica nije pronađena." };
      }
    }
    const id = `haul_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.hauls
         (id, company_id, machine_id, driver_worker_id, project_id, segment_id, hauled_at,
          origin_text, destination_text, material_text, quantity, quantity_unit,
          scale_ticket_text, trip_count, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
      [
        id, actor.companyId, input.machineId, driverId, input.projectId ?? null,
        input.segmentId ?? null, input.hauledAt, origin, destination, material,
        input.quantity, input.quantityUnit, input.scaleTicketText ?? null,
        tripCount, input.note ?? null, actor.userId,
      ],
    );
    return { outcome: "OK", id };
  });
}
