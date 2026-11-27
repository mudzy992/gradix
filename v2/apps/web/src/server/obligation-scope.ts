import type { PoolClient } from "pg";
import type { Scope } from "@gradix/domain";

/** Session-derived scope; never accept these values from request bodies. */
export type ObligationActor = { userId: string; roles: readonly string[]; scope: Scope; projectIds: readonly string[] | null };
export type ObligationViewer = Pick<ObligationActor, "userId" | "scope" | "projectIds">;

/** PROJECTS includes project records and currently assigned workers/machines. SELF means linked worker only. */
export function obligationScope(actor: ObligationViewer, params: unknown[], alias: string): string {
  if (actor.scope === "COMPANY") return "TRUE";
  if (actor.scope === "SELF") {
    params.push(actor.userId);
    return `EXISTS (SELECT 1 FROM public.workers ow WHERE ow.company_id=${alias}.company_id AND ow.id=${alias}.worker_id AND ow.user_id=$${params.length} AND ow.is_active)`;
  }
  if (actor.scope === "PROJECTS") {
    params.push(actor.projectIds ?? []);
    const projects = `$${params.length}`;
    return `(${alias}.project_id=ANY(${projects}::text[]) OR EXISTS (
      SELECT 1 FROM public.project_assignments opa JOIN public.companies oc ON oc.id=opa.company_id
       WHERE opa.company_id=${alias}.company_id AND opa.project_id=ANY(${projects}::text[])
         AND opa.voided_at IS NULL AND opa.from_date <= (clock_timestamp() AT TIME ZONE oc.timezone)::date
         AND (opa.to_date IS NULL OR opa.to_date >= (clock_timestamp() AT TIME ZONE oc.timezone)::date)
         AND ((opa.worker_id IS NOT NULL AND opa.worker_id=${alias}.worker_id) OR (opa.machine_id IS NOT NULL AND opa.machine_id=${alias}.machine_id))))`;
  }
  return "FALSE";
}

export async function obligationRecordAllowed(client: PoolClient, companyId: string, actor: ObligationViewer, id: string): Promise<boolean> {
  const params: unknown[] = [companyId, id];
  const scope = obligationScope(actor, params, "o");
  const result = await client.query(`SELECT o.id FROM public.obligations o WHERE o.company_id=$1 AND o.id=$2 AND ${scope} FOR UPDATE OF o`, params);
  return Boolean(result.rowCount);
}

export async function obligationTargetAllowed(client: PoolClient, companyId: string, actor: ObligationViewer, target: {workerId?: string | null; machineId?: string | null; projectId?: string | null; tenderId?: string | null; scopeCompany?: boolean}): Promise<boolean> {
  if (actor.scope === "COMPANY") return true;
  const params: unknown[] = [companyId, target.workerId ?? null, target.machineId ?? null, target.projectId ?? null];
  const scope = obligationScope(actor, params, "o");
  const row = await client.query(`SELECT 1 FROM (SELECT $1::text company_id,$2::text worker_id,$3::text machine_id,$4::text project_id) o WHERE ${scope}`, params);
  return Boolean(row.rowCount);
}
