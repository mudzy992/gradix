/** R5.3 DB row mapping and helpers for hauls. */
import type { PoolClient } from "pg";
import type { HaulActor, HaulRow, QuantityUnit } from "./haul-types";

export type DbHaulRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  driver_worker_id: string;
  driver_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  segment_id: string | null;
  segment_code: string | null;
  segment_name: string | null;
  hauled_at: string;
  origin_text: string;
  destination_text: string;
  material_text: string;
  quantity: string;
  quantity_unit: string;
  scale_ticket_text: string | null;
  trip_count: number;
  note: string | null;
  version: number;
  created_at: string;
};

export function mapHaulRow(row: DbHaulRow): HaulRow {
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
    segment_id: row.segment_id,
    segment_code: row.segment_code,
    segment_name: row.segment_name,
    hauled_at: row.hauled_at,
    origin_text: row.origin_text,
    destination_text: row.destination_text,
    material_text: row.material_text,
    quantity: Number(row.quantity),
    quantity_unit: row.quantity_unit as QuantityUnit,
    scale_ticket_text: row.scale_ticket_text,
    trip_count: row.trip_count,
    note: row.note,
    version: row.version,
    created_at: row.created_at,
  };
}

export async function resolveHaulActorWorkerId(
  client: PoolClient,
  actor: HaulActor,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT w.id FROM public.workers w
      WHERE w.company_id = $1 AND w.user_id = $2 AND w.is_active LIMIT 1`,
    [actor.companyId, actor.userId],
  );
  return result.rows[0]?.id ?? null;
}

export function isQuantityUnit(value: string): value is QuantityUnit {
  return value === "M3" || value === "T";
}
