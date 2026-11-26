import type { NextRequest } from "next/server";
import { hasControlChars } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { isAttachmentServiceError } from "@/server/attachment-service";
import { reportJobDownload } from "@/server/report-job-download";

export const dynamic="force-dynamic";
export async function GET(request:NextRequest, context:{params:Promise<{id:string}>}):Promise<Response> {
  try {
    const auth=await guard(request,"reports.view"); if (!auth.ok) return auth.response;
    const {id}=await context.params;
    if (!id || id.length>128 || hasControlChars(id)) return fail("VALIDATION_FAILED","Neispravan identifikator.");
    const result=await reportJobDownload(await getVerifiedPool(),auth.ctx.companyId,auth.ctx.userId,id);
    if (isAttachmentServiceError(result)) return fail(result.code,result.message);
    const response=ok(result);
    response.headers.set("Cache-Control","no-store");
    return response;
  } catch(error) {return internal(error,"report-jobs.download");}
}
