import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { visibleProjectIds, type Scope } from "@gradix/domain";
import type { ReportJobRequest } from "@gradix/contracts";
import { can } from "./permissions";
import { SOURCE_PERMISSION } from "./report-job-permissions";

type Input = typeof ReportJobRequest._output;
type Actor = { companyId: string; userId: string; roles: readonly string[]; scope: Scope; projectIds: readonly string[] | null };
export type ReportJobCreateResult =
  | { ok: true; id: string }
  | { ok: false; code: "FORBIDDEN" | "VALIDATION_FAILED"; message: string };

function day(value: string): number | null {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value ? parsed.getTime() : null;
}

/**
 * Write the durable request only. It is the transactional outbox for a dispatcher: sending a
 * pg-boss message inside this transaction would race commit and could lose or orphan the job.
 * Do not expose this function through POST until a recovering dispatcher and worker are active.
 */
export async function createReportJob(pool: Pool, actor: Actor, input: Input): Promise<ReportJobCreateResult> {
  if (!can(actor.roles,"reports.view") || !can(actor.roles,"export.data") || !can(actor.roles,SOURCE_PERMISSION[input.key]))
    return {ok:false,code:"FORBIDDEN",message:"Nemate pravo izvoza ovog izvještaja."};
  const from=day(input.from), to=day(input.to);
  if (from === null || to === null || to < from || to - from > 366 * 86400000)
    return {ok:false,code:"VALIDATION_FAILED",message:"Izaberite ispravan period od najviše 367 dana."};
  if (input.team && (input.key === "PROJECT_COSTS" || input.key === "DEADLINES" || input.key === "HSE"))
    return {ok:false,code:"VALIDATION_FAILED",message:"Filter tima nije podržan za ovaj izvještaj."};
  const ids=visibleProjectIds({userId:actor.userId,scope:actor.scope,projectIds:actor.projectIds ?? []});
  if (input.projectId && ids !== null && !ids.includes(input.projectId))
    return {ok:false,code:"FORBIDDEN",message:"Projekat nije u vašem opsegu."};
  return withCompany(pool,companyId(actor.companyId),async client => {
    if (input.projectId) {
      const project=await client.query("SELECT 1 FROM public.projects WHERE company_id=$1 AND id=$2",[actor.companyId,input.projectId]);
      if (!project.rowCount) return {ok:false,code:"VALIDATION_FAILED",message:"Projekat ne postoji."};
    }
    const id=`rpt_${randomUUID()}`;
    // Snapshot limits the maximum rights of a subsequently executed job. The worker must
    // intersect it with a freshly resolved membership and assignments; never trust it alone.
    const params={projectId:input.projectId ?? null,team:input.team ?? null,
      requestedScope:actor.scope,requestedProjectIds:ids,requestedRoles:[...new Set(actor.roles)].sort()};
    await client.query(`INSERT INTO public.report_jobs
      (id,company_id,kind,report_key,format,period_from,period_to,params,requested_by,status)
      VALUES ($1,$2,'REPORT',$3,$4,$5::date,$6::date,$7::jsonb,$8,'QUEUED')`,
    [id,actor.companyId,input.key,input.format.toUpperCase(),input.from,input.to,JSON.stringify(params),actor.userId]);
    return {ok:true,id};
  });
}
