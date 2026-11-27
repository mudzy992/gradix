import type { PoolClient } from "pg";
import type { R4SyncPushItem } from "@gradix/domain";
import type { ScopedDiaryActor } from "./diary-service";

export type HseActor = ScopedDiaryActor;
type Kind = "incident" | "inspection" | "training" | "action";

/** SELF is limited to records authored by the user; measures inherit their source scope. */
export function hseScope(actor: HseActor, params: unknown[], alias: string, kind: Kind): string {
  if (actor.scope === "COMPANY") return "TRUE";
  if (kind === "action") {
    const incident = hseScope(actor, params, "hsi_scope", "incident");
    const inspection = hseScope(actor, params, "hsp_scope", "inspection");
    return `((EXISTS (SELECT 1 FROM public.hse_incidents hsi_scope WHERE hsi_scope.company_id=${alias}.company_id AND hsi_scope.id=${alias}.incident_id AND ${incident})) OR
      (EXISTS (SELECT 1 FROM public.hse_inspections hsp_scope WHERE hsp_scope.company_id=${alias}.company_id AND hsp_scope.id=${alias}.inspection_id AND ${inspection})))`;
  }
  if (actor.scope === "PROJECTS") {
    params.push(actor.projectIds ?? []);
    return `${alias}.project_id=ANY($${params.length}::text[])`;
  }
  if (actor.scope === "SELF") {
    params.push(actor.userId);
    const column = kind === "incident" ? "reporter_user_id" : kind === "training" ? "held_by_user_id" : "created_by";
    return `${alias}.${column}=$${params.length}`;
  }
  return "FALSE";
}

export async function hseRecordAllowed(client: PoolClient, actor: HseActor, kind: Kind, id: string): Promise<boolean> {
  const table = { incident: "hse_incidents", inspection: "hse_inspections", training: "hse_trainings", action: "hse_actions" }[kind];
  const params: unknown[] = [actor.companyId, id];
  const scope = hseScope(actor, params, "h", kind);
  const result = await client.query(`SELECT h.id FROM public.${table} h WHERE h.company_id=$1 AND h.id=$2 AND ${scope} FOR UPDATE OF h`, params);
  return Boolean(result.rowCount);
}

export function hseTargetAllowed(actor: HseActor, projectId: string | null | undefined): boolean {
  return actor.scope === "COMPANY" || actor.scope === "SELF" ||
    (actor.scope === "PROJECTS" && !!projectId && (actor.projectIds ?? []).includes(projectId));
}

/** Check both incoming source and any existing record before replaying offline receipts. */
export async function hseSyncAllowed(client: PoolClient, actor: HseActor, item: Extract<R4SyncPushItem, {entityType:"hse_incident"|"hse_training"|"hse_action"}>): Promise<boolean> {
  if (actor.scope === "COMPANY") return true;
  const kind = item.entityType === "hse_incident" ? "incident" : item.entityType === "hse_training" ? "training" : "action";
  const id = item.entityType === "hse_incident" ? item.incidentId : item.entityType === "hse_training" ? item.trainingId : item.actionId;
  if (item.entityType === "hse_incident" && (!hseTargetAllowed(actor, item.incident.projectId) ||
    !await hseWorkersAllowed(client, actor, [item.incident.injuredWorkerId, ...(item.incident.involvedWorkers ?? []).map(p => p.workerId)]))) return false;
  if (item.entityType === "hse_training" && (!hseTargetAllowed(actor, item.training.projectId) ||
    !await hseWorkersAllowed(client, actor, item.training.attendees.map(a => a.workerId)))) return false;
  if (item.entityType === "hse_action") {
    if (!await hseWorkersAllowed(client, actor, [item.action.responsibleWorkerId])) return false;
    const source = item.action.incidentId ?? item.action.inspectionId;
    if (!source || !await hseRecordAllowed(client, actor, item.action.incidentId ? "incident" : "inspection", source)) return false;
  }
  const table = {incident:"hse_incidents",training:"hse_trainings",action:"hse_actions"}[kind];
  const found = await client.query(`SELECT id FROM public.${table} WHERE company_id=$1 AND id=$2`, [actor.companyId,id]);
  return !found.rowCount || hseRecordAllowed(client, actor, kind, id);
}

/** Only assigned workers may be referenced by a project-scoped HSE writer. */
export async function hseWorkersAllowed(client: PoolClient, actor: HseActor, workerIds: readonly (string | null | undefined)[]): Promise<boolean> {
  if (actor.scope !== "PROJECTS") return actor.scope === "COMPANY" || actor.scope === "SELF";
  const ids = [...new Set(workerIds.filter((id): id is string => !!id))];
  if (!ids.length) return true;
  const result = await client.query<{id:string}>(`SELECT DISTINCT w.id FROM public.workers w
    JOIN public.project_assignments pa ON pa.company_id=w.company_id AND pa.worker_id=w.id
    JOIN public.companies c ON c.id=w.company_id
    WHERE w.company_id=$1 AND w.id=ANY($2::text[]) AND w.is_active AND pa.project_id=ANY($3::text[])
      AND pa.voided_at IS NULL AND pa.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
      AND (pa.to_date IS NULL OR pa.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)`,
    [actor.companyId, ids, actor.projectIds ?? []]);
  return result.rows.length === ids.length;
}
