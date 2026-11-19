/** R5.4 DB row mapping and helpers for machine daily checks. */
import type { PoolClient } from "pg";
import type { DailyCheckActor, DailyCheckResult, DailyCheckRow } from "./daily-check-types";

export type DbDailyCheckRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  worker_id: string;
  worker_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  checked_at: string;
  result: string;
  checklist_json: Record<string, unknown> | string;
  note: string | null;
  version: number;
  created_at: string;
};

export function mapDailyCheckRow(row: DbDailyCheckRow): DailyCheckRow {
  const checklist = typeof row.checklist_json === "string"
    ? (JSON.parse(row.checklist_json) as Record<string, unknown>)
    : row.checklist_json;
  return {
    id: row.id,
    machine_id: row.machine_id,
    machine_code: row.machine_code,
    machine_name: row.machine_name,
    worker_id: row.worker_id,
    worker_name: row.worker_name,
    project_id: row.project_id,
    project_code: row.project_code,
    project_name: row.project_name,
    checked_at: row.checked_at,
    result: row.result as DailyCheckResult,
    checklist_json: checklist ?? {},
    note: row.note,
    version: row.version,
    created_at: row.created_at,
  };
}

export async function resolveDailyCheckActorWorkerId(
  client: PoolClient,
  actor: DailyCheckActor,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT w.id FROM public.workers w
      WHERE w.company_id = $1 AND w.user_id = $2 AND w.is_active LIMIT 1`,
    [actor.companyId, actor.userId],
  );
  return result.rows[0]?.id ?? null;
}

export function isDailyCheckResult(value: string): value is DailyCheckResult {
  return value === "PASS" || value === "FAIL" || value === "CONDITIONAL";
}
