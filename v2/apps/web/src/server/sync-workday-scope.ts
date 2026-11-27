import type { PoolClient } from "pg";
import type { R4SyncPushItem } from "@gradix/domain";
import type { EquipmentActor } from "./equipment-scope";

type WorkItem = Extract<R4SyncPushItem, { entityType: "workday" | "work_entry" }>;

/** Authorize both the target and any existing canonical rows before exposing a receipt. */
export async function syncWorkdayAllowed(client: PoolClient, actor: EquipmentActor, workerId: string, item: WorkItem): Promise<boolean> {
  if (actor.scope === "COMPANY") return true;
  if (actor.scope === "SELF") {
    const own = await client.query("SELECT 1 FROM public.workers WHERE company_id=$1 AND id=$2 AND user_id=$3 AND is_active", [actor.companyId, workerId, actor.userId]);
    if (!own.rowCount) return false;
  } else if (actor.scope === "PROJECTS") {
    const ids = actor.projectIds ?? [];
    if (item.entityType === "work_entry") {
      if (item.entry.kind === "WORK" && (!item.entry.projectId || !ids.includes(item.entry.projectId))) return false;
      // Breaks have no project; an existing wholly in-scope day is required below.
    }
    const assigned = await client.query(`SELECT 1 FROM public.project_assignments a JOIN public.companies c ON c.id=a.company_id
      WHERE a.company_id=$1 AND a.worker_id=$2 AND a.project_id=ANY($3::text[]) AND a.voided_at IS NULL
        AND a.from_date<=(clock_timestamp() AT TIME ZONE c.timezone)::date
        AND (a.to_date IS NULL OR a.to_date>=(clock_timestamp() AT TIME ZONE c.timezone)::date)`, [actor.companyId, workerId, ids]);
    if (!assigned.rowCount) return false;
  } else return false;

  const day = await client.query<{worker_id: string; any_entry: boolean; outside: boolean}>(`SELECT d.worker_id,
    EXISTS (SELECT 1 FROM public.work_entries e WHERE e.company_id=d.company_id AND e.workday_id=d.id) AS any_entry,
    EXISTS (SELECT 1 FROM public.work_entries e WHERE e.company_id=d.company_id AND e.workday_id=d.id
      AND (e.project_id IS NULL OR NOT e.project_id=ANY($3::text[]))) AS outside
    FROM public.workdays d JOIN public.companies c ON c.id=d.company_id
    WHERE d.company_id=$1 AND (d.id=$2 OR (d.worker_id=$4 AND $5::timestamptz IS NOT NULL
      AND d.work_date=($5::timestamptz AT TIME ZONE c.timezone)::date)) FOR UPDATE OF d`,
    [actor.companyId,item.workdayId,actor.projectIds ?? [],workerId,item.entityType === "work_entry" ? item.entry.startedAt : null]);
  if (day.rows.some(row => row.worker_id !== workerId)) return false;
  if (actor.scope === "PROJECTS") {
    if (day.rows.some(row => row.outside)) return false;
    if ((item.entityType === "workday" || item.entry.kind === "BREAK") && !day.rows.some(row => row.any_entry)) return false;
  }
  if (item.entityType === "work_entry") {
    const found = await client.query<{worker_id:string;project_id:string|null}>(
      "SELECT worker_id,project_id FROM public.work_entries WHERE company_id=$1 AND id=$2 FOR UPDATE", [actor.companyId,item.workEntryId]);
    if (found.rows[0] && (found.rows[0].worker_id !== workerId || (actor.scope === "PROJECTS" &&
      (!found.rows[0].project_id || !(actor.projectIds ?? []).includes(found.rows[0].project_id))))) return false;
  }
  return true;
}
