import type { NextRequest } from "next/server";
import { ReportJobRequest } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { getReportJob, listReportJobs } from "@/server/report-job-read";
import { createReportJob } from "@/server/report-job-create";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "reports.view");
    if (!auth.ok) return auth.response;
    return ok({jobs: await listReportJobs(await getVerifiedPool(), auth.ctx.companyId, auth.ctx.userId)});
  } catch (error) { return internal(error, "report-jobs.list"); }
}

/** The committed report_jobs row is the durable outbox for the pg-boss relay. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "reports.view");
    if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles, "export.data")) return fail("FORBIDDEN", "Nemate pravo izvoza.");
    const parsed = ReportJobRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravni parametri izvještaja.");
    const pool=await getVerifiedPool();
    const result=await createReportJob(pool,auth.ctx,parsed.data);
    if (!result.ok) return fail(result.code,result.message);
    const job=await getReportJob(pool,auth.ctx.companyId,auth.ctx.userId,result.id);
    if (!job) throw new Error("REPORT_JOB_CREATED_NOT_FOUND");
    return ok(job);
  } catch (error) { return internal(error, "report-jobs.create"); }
}
