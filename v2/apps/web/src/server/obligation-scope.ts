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
    params.push(actor.userId);
    const user = `$${params.length}`;
    const activeProjects = `(SELECT own_pa.project_id FROM public.project_assignments own_pa
      JOIN public.workers own_w ON own_w.company_id=own_pa.company_id AND own_w.id=own_pa.worker_id
      JOIN public.companies own_c ON own_c.id=own_pa.company_id
      WHERE own_pa.company_id=${alias}.company_id AND own_w.user_id=${user}
        AND own_pa.project_id=ANY(${projects}::text[]) AND own_w.is_active AND own_pa.voided_at IS NULL
        AND own_pa.from_date <= (clock_timestamp() AT TIME ZONE own_c.timezone)::date
        AND (own_pa.to_date IS NULL OR own_pa.to_date >= (clock_timestamp() AT TIME ZONE own_c.timezone)::date))`;
    return `(${alias}.project_id IN ${activeProjects} OR EXISTS (
      SELECT 1 FROM public.project_assignments opa JOIN public.companies oc ON oc.id=opa.company_id
       WHERE opa.company_id=${alias}.company_id AND opa.project_id IN ${activeProjects}
         AND opa.voided_at IS NULL AND opa.from_date <= (clock_timestamp() AT TIME ZONE oc.timezone)::date
         AND (opa.to_date IS NULL OR opa.to_date >= (clock_timestamp() AT TIME ZONE oc.timezone)::date)
         AND ((opa.worker_id IS NOT NULL AND opa.worker_id=${alias}.worker_id) OR (opa.machine_id IS NOT NULL AND opa.machine_id=${alias}.machine_id))))`;
  }
  return "FALSE";
}

type ObligationTarget = {workerId?: string | null; machineId?: string | null; projectId?: string | null; tenderId?: string | null; scopeCompany?: boolean};

/** Lock the subject assignment until the mutation commits: a revocation must wait, or be
 * observed after waiting for the revoker. The obligation row is locked before calling this. */
export async function obligationTargetAllowed(client: PoolClient, companyId: string, actor: ObligationViewer, target: ObligationTarget): Promise<boolean> {
  if (actor.scope === "COMPANY") return true;
  if (actor.scope === "SELF") {
    if (!target.workerId) return false;
    const worker = await client.query(`SELECT id FROM public.workers WHERE company_id=$1 AND id=$2 AND user_id=$3 AND is_active FOR SHARE`, [companyId, target.workerId, actor.userId]);
    return Boolean(worker.rowCount);
  }
  if (actor.scope !== "PROJECTS") return false;
  // Session projectIds are an upper bound, not proof that the assignment still exists.
  const mine = await client.query<{project_id:string}>(`SELECT pa.project_id FROM public.project_assignments pa
    JOIN public.workers w ON w.company_id=pa.company_id AND w.id=pa.worker_id
    JOIN public.companies c ON c.id=pa.company_id
    WHERE pa.company_id=$1 AND w.user_id=$2 AND w.is_active AND pa.project_id=ANY($3::text[]) AND pa.voided_at IS NULL
      AND pa.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
      AND (pa.to_date IS NULL OR pa.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)
    ORDER BY pa.id FOR SHARE OF pa,w`, [companyId, actor.userId, actor.projectIds ?? []]);
  const projects = mine.rows.map(row => row.project_id);
  if (target.projectId) return projects.includes(target.projectId);
  if (!projects.length || (!target.workerId && !target.machineId)) return false;
  const result = await client.query(`SELECT pa.id FROM public.project_assignments pa JOIN public.companies c ON c.id=pa.company_id
    WHERE pa.company_id=$1 AND pa.project_id=ANY($2::text[]) AND pa.voided_at IS NULL
      AND pa.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
      AND (pa.to_date IS NULL OR pa.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)
      AND ((pa.worker_id IS NOT NULL AND pa.worker_id=$3) OR (pa.machine_id IS NOT NULL AND pa.machine_id=$4))
    ORDER BY pa.id FOR SHARE OF pa`, [companyId, projects, target.workerId ?? null, target.machineId ?? null]);
  return Boolean(result.rowCount);
}

export async function obligationRecordAllowed(client: PoolClient, companyId: string, actor: ObligationViewer, id: string): Promise<boolean> {
  const result = await client.query<{worker_id:string|null;machine_id:string|null;project_id:string|null}>(
    `SELECT worker_id,machine_id,project_id FROM public.obligations WHERE company_id=$1 AND id=$2 FOR UPDATE`, [companyId,id]);
  const row = result.rows[0];
  return !!row && obligationTargetAllowed(client, companyId, actor, {workerId:row.worker_id,machineId:row.machine_id,projectId:row.project_id});
}
