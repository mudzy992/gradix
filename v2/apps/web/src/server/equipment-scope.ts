import type { PoolClient } from "pg";
import type { Scope } from "@gradix/domain";

/** Session-derived scope, never a user-supplied filter. */
export type EquipmentActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
  scope: Scope;
  projectIds: readonly string[] | null;
};

type EquipmentKind = "order" | "fault";

/** PROJECTS requires both the record's project and a current assignment of its machine there.
 * SELF sees only its own assigned orders or reported faults. Unknown scopes fail closed. */
export function equipmentScope(actor: Omit<EquipmentActor, "scope"> & { scope: string }, params: unknown[], alias: string, kind: EquipmentKind): string {
  if (actor.scope === "COMPANY") return "TRUE";
  if (actor.scope === "PROJECTS") {
    params.push(actor.projectIds ?? []);
    const projects = `$${params.length}`;
    return `(${alias}.project_id = ANY(${projects}::text[]) AND EXISTS (
      SELECT 1 FROM public.project_assignments ea
      JOIN public.companies ec ON ec.id = ea.company_id
      WHERE ea.company_id = ${alias}.company_id AND ea.project_id = ${alias}.project_id
        AND ea.machine_id = ${alias}.machine_id AND ea.voided_at IS NULL
        AND ea.from_date <= (clock_timestamp() AT TIME ZONE ec.timezone)::date
        AND (ea.to_date IS NULL OR ea.to_date >= (clock_timestamp() AT TIME ZONE ec.timezone)::date)))`;
  }
  if (actor.scope === "SELF") {
    params.push(actor.userId);
    const workerColumn = kind === "order" ? "assigned_mechanic_worker_id" : "reporter_worker_id";
    return `${alias}.${workerColumn} IN (SELECT ew.id FROM public.workers ew
      WHERE ew.company_id = ${alias}.company_id AND ew.user_id = $${params.length} AND ew.is_active)`;
  }
  return "FALSE";
}

export async function equipmentRecordAllowed(
  client: PoolClient, actor: EquipmentActor, kind: EquipmentKind, id: string,
): Promise<boolean> {
  const table = kind === "order" ? "service_orders" : "machine_faults";
  const params: unknown[] = [actor.companyId, id];
  const predicate = equipmentScope(actor, params, "e", kind);
  const result = await client.query(`SELECT e.id FROM public.${table} e
    WHERE e.company_id = $1 AND e.id = $2 AND ${predicate} FOR UPDATE`, params);
  return (result.rowCount ?? 0) > 0;
}

/** New/moved restricted records must refer to a project where the machine is currently assigned.
 * For SELF, the worker must also currently be assigned to the same project. */
export async function equipmentTargetAllowed(
  client: PoolClient, actor: EquipmentActor, projectId: string | null | undefined, machineId: string,
): Promise<boolean> {
  if (actor.scope === "COMPANY") return true;
  if (!projectId || (actor.scope === "PROJECTS" && !(actor.projectIds ?? []).includes(projectId))) return false;
  if (actor.scope !== "PROJECTS" && actor.scope !== "SELF") return false;
  const result = await client.query(`SELECT 1 FROM public.project_assignments ma
    JOIN public.companies c ON c.id = ma.company_id
    WHERE ma.company_id = $1 AND ma.project_id = $2 AND ma.machine_id = $3
      AND ma.voided_at IS NULL AND ma.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
      AND (ma.to_date IS NULL OR ma.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)
      AND ($4::boolean OR EXISTS (SELECT 1 FROM public.project_assignments wa
        JOIN public.workers w ON w.company_id = wa.company_id AND w.id = wa.worker_id
        WHERE wa.company_id = ma.company_id AND wa.project_id = ma.project_id
          AND w.user_id = $5 AND w.is_active AND wa.voided_at IS NULL
          AND wa.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
          AND (wa.to_date IS NULL OR wa.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)))`,
    [actor.companyId, projectId, machineId, actor.scope === "PROJECTS", actor.userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function isActorWorker(client: PoolClient, actor: EquipmentActor, workerId: string | null | undefined): Promise<boolean> {
  if (!workerId) return false;
  const result = await client.query(`SELECT id FROM public.workers WHERE company_id=$1 AND id=$2 AND user_id=$3 AND is_active`,
    [actor.companyId, workerId, actor.userId]);
  return (result.rowCount ?? 0) > 0;
}

/** Finishing an order may also update its linked fault; enforce that boundary in the same transaction. */
export async function linkedFaultAllowed(client: PoolClient, actor: EquipmentActor, orderId: string): Promise<boolean> {
  const result = await client.query<{ fault_id: string | null }>(
    "SELECT fault_id FROM public.service_orders WHERE company_id=$1 AND id=$2", [actor.companyId, orderId],
  );
  const faultId = result.rows[0]?.fault_id;
  return !faultId || equipmentRecordAllowed(client, actor, "fault", faultId);
}
