import type { NextRequest } from "next/server";
import { ReportJobRequest } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { listReportJobs } from "@/server/report-job-read";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "reports.view");
    if (!auth.ok) return auth.response;
    return ok({jobs: await listReportJobs(await getVerifiedPool(), auth.ctx.companyId, auth.ctx.userId)});
  } catch (error) { return internal(error, "report-jobs.list"); }
}

/** Fail closed until queue delivery, worker and secure download are available together. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "reports.view");
    if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles, "export.data")) return fail("FORBIDDEN", "Nemate pravo izvoza.");
    const parsed = ReportJobRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravni parametri izvještaja.");
    return fail("CONFLICT", "Asinhroni izvoz trenutno nije dostupan.");
  } catch (error) { return internal(error, "report-jobs.create"); }
}
