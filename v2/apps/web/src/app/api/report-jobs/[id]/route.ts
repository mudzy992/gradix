import type { NextRequest } from "next/server";
import { hasControlChars } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { getReportJob } from "@/server/report-job-read";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{id:string}> }): Promise<Response> {
  try {
    const auth = await guard(request, "reports.view");
    if (!auth.ok) return auth.response;
    const {id} = await context.params;
    if (!id || id.length > 128 || hasControlChars(id)) return fail("VALIDATION_FAILED", "Neispravan identifikator.");
    const job = await getReportJob(await getVerifiedPool(), auth.ctx.companyId, auth.ctx.userId, id);
    return job ? ok(job) : fail("NOT_FOUND", "Izvještaj nije pronađen.");
  } catch (error) { return internal(error, "report-jobs.get"); }
}
