import type { PoolClient } from "pg";
import type { R4SyncPushItem } from "@gradix/domain";
import type { EquipmentActor } from "./equipment-scope";

export type MachineActivityActor = EquipmentActor;
type Kind = "machine_work_log" | "fuel_entry";
type ActivityItem = Extract<R4SyncPushItem, {entityType: Kind}>;

/** Historical rows belong to their recorded project, or to their linked operator under SELF. */
export function machineActivityScope(actor: MachineActivityActor, params: unknown[], alias: string, workerColumn: "worker_id" | "driver_worker_id"): string {
  if (actor.scope === "COMPANY") return "TRUE";
  params.push(actor.userId);
  const user = `$${params.length}`;
  if (actor.scope === "SELF") return `EXISTS (SELECT 1 FROM public.workers scope_worker
    WHERE scope_worker.company_id=${alias}.company_id AND scope_worker.id=${alias}.${workerColumn}
      AND scope_worker.user_id=${user} AND scope_worker.is_active)`;
  if (actor.scope !== "PROJECTS") return "FALSE";
  params.push(actor.projectIds ?? []);
  const projects = `$${params.length}`;
  return `(${alias}.project_id=ANY(${projects}::text[]) AND EXISTS (
    SELECT 1 FROM public.project_assignments scope_pa
    JOIN public.workers scope_w ON scope_w.company_id=scope_pa.company_id AND scope_w.id=scope_pa.worker_id
    JOIN public.companies scope_c ON scope_c.id=scope_pa.company_id
    WHERE scope_pa.company_id=${alias}.company_id AND scope_pa.project_id=${alias}.project_id
      AND scope_w.user_id=${user} AND scope_w.is_active AND scope_pa.voided_at IS NULL
      AND scope_pa.from_date <= (clock_timestamp() AT TIME ZONE scope_c.timezone)::date
      AND (scope_pa.to_date IS NULL OR scope_pa.to_date >= (clock_timestamp() AT TIME ZONE scope_c.timezone)::date)))`;
}

/** Lock the live grant so that a concurrent revocation cannot race a write or receipt replay. */
export async function machineActivityTargetAllowed(
  client: PoolClient, actor: MachineActivityActor, projectId: string | null | undefined, workerId: string,
): Promise<boolean> {
  if (actor.scope === "COMPANY") return true;
  if (actor.scope === "SELF") {
    const worker = await client.query(`SELECT id FROM public.workers WHERE company_id=$1 AND id=$2 AND user_id=$3 AND is_active FOR SHARE`,
      [actor.companyId, workerId, actor.userId]);
    return !!worker.rowCount;
  }
  if (actor.scope !== "PROJECTS" || !projectId || !(actor.projectIds ?? []).includes(projectId)) return false;
  const grant = await client.query(`SELECT a.id FROM public.project_assignments a
    JOIN public.workers w ON w.company_id=a.company_id AND w.id=a.worker_id
    JOIN public.companies c ON c.id=a.company_id
    WHERE a.company_id=$1 AND a.project_id=$2 AND w.user_id=$3 AND w.is_active AND a.voided_at IS NULL
      AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
      AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)
    ORDER BY a.id FOR SHARE OF a,w`, [actor.companyId,projectId,actor.userId]);
  return !!grant.rowCount;
}

/** Lock the row before checking the grant; denied and missing rows are indistinguishable. */
export async function machineActivityRecordAllowed(client: PoolClient, actor: MachineActivityActor, kind: Kind, id: string): Promise<boolean> {
  const table = kind === "machine_work_log" ? "machine_work_logs" : "fuel_entries";
  const workerColumn = kind === "machine_work_log" ? "worker_id" : "driver_worker_id";
  const row = await client.query<{project_id:string|null;worker_id:string}>(
    `SELECT project_id,${workerColumn} AS worker_id FROM public.${table} WHERE company_id=$1 AND id=$2 FOR UPDATE`, [actor.companyId,id]);
  return !!row.rows[0] && machineActivityTargetAllowed(client, actor, row.rows[0].project_id, row.rows[0].worker_id);
}

/** Incoming target AND existing canonical row must be authorized before every replay and write. */
export async function syncMachineActivityAllowed(client: PoolClient, actor: MachineActivityActor, workerId: string, item: ActivityItem): Promise<boolean> {
  const data = item.entityType === "machine_work_log" ? item.log : item.entry;
  if (!await machineActivityTargetAllowed(client, actor, data.projectId, workerId)) return false;
  const table = item.entityType === "machine_work_log" ? "machine_work_logs" : "fuel_entries";
  const id = item.entityType === "machine_work_log" ? item.workLogId : item.fuelEntryId;
  const workerColumn = item.entityType === "machine_work_log" ? "worker_id" : "driver_worker_id";
  const found = await client.query<{worker_id:string;project_id:string|null;machine_id:string}>(
    `SELECT ${workerColumn} AS worker_id,project_id,machine_id FROM public.${table} WHERE company_id=$1 AND id=$2 FOR UPDATE`, [actor.companyId,id]);
  const existing = found.rows[0];
  if (!existing) return true;
  return existing.worker_id === workerId && existing.project_id === data.projectId && existing.machine_id === data.machineId &&
    machineActivityTargetAllowed(client, actor, existing.project_id, existing.worker_id);
}
