import type { PoolClient } from "pg";
import { isScope, type ReportKey } from "@gradix/domain";
import { ROLES, type Role } from "./permissions";
import { canRunReport, intersectReportAccess, type ReportJobAccess } from "./report-job-permissions";

type Actor = ReportJobAccess & {userId:string; companyId:string};

/** Parse persisted request data as untrusted; old/incomplete rows are not eligible. */
function requestedAccess(params: unknown): ReportJobAccess | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const p=params as Record<string,unknown>;
  if (!isScope(p.requestedScope) || !Array.isArray(p.requestedRoles) || p.requestedRoles.length === 0 ||
      !p.requestedRoles.every(role => typeof role === "string" && ROLES.includes(role as Role))) return null;
  const ids=p.requestedProjectIds;
  if (p.requestedScope === "COMPANY" ? ids !== null :
    !Array.isArray(ids) || !ids.every(id=>typeof id === "string" && id.length > 0 && id.length <= 128)) return null;
  if (p.requestedScope === "SELF" && (ids as string[]).length !== 0) return null;
  return {roles:p.requestedRoles as Role[],scope:p.requestedScope,projectIds:ids as string[] | null};
}

/** Caller must run in the job's tenant transaction. Never use only the saved role snapshot. */
export async function resolveReportJobActor(client: PoolClient, companyId: string, userId: string,
  key: ReportKey, params: unknown): Promise<Actor | null> {
  const requested=requestedAccess(params);
  if (!requested) return null;
  const membership=await client.query<{roles:string[];scope:string}>(
    `SELECT m.roles::text[] AS roles,m.scope FROM public.memberships m
       JOIN public.users u ON u.id=m.user_id JOIN public.companies c ON c.id=m.company_id
      WHERE m.company_id=$1 AND m.user_id=$2 AND m.is_active AND u.is_active AND c.is_active
        AND NOT u.must_change_password`,[companyId,userId]);
  const row=membership.rows[0];
  if (!row || !isScope(row.scope) || !row.roles.every(role=>ROLES.includes(role as Role))) return null;
  let projectIds:string[] | null = row.scope === "COMPANY" ? null : [];
  if (row.scope === "PROJECTS") {
    const assignments=await client.query<{project_id:string}>(`SELECT DISTINCT a.project_id
       FROM public.project_assignments a
       JOIN public.workers w ON w.company_id=a.company_id AND w.id=a.worker_id
       JOIN public.companies c ON c.id=a.company_id
      WHERE a.company_id=$1 AND w.user_id=$2 AND a.voided_at IS NULL
        AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
        AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)`,[companyId,userId]);
    projectIds=assignments.rows.map(a=>a.project_id);
  }
  const effective=intersectReportAccess(requested,{roles:row.roles as Role[],scope:row.scope,projectIds});
  const project=(params as Record<string,unknown>).projectId;
  if (project !== null && project !== undefined && (typeof project !== "string" ||
      (effective.scope !== "COMPANY" && !effective.projectIds?.includes(project)))) return null;
  if (!canRunReport(effective,key)) return null;
  return {...effective,userId,companyId};
}
