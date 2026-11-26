import type { NextRequest } from "next/server";
import { ReportQuery } from "@gradix/contracts";
import { isReportKey } from "@gradix/domain";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { guard } from "@/server/guard";
import { getVerifiedPool } from "@/server/db";
import { loadReport } from "@/server/report-service";
import { renderReportPdf, renderReportXlsx } from "@/server/report-render";
import { writeAudit } from "@/server/audit";
import { can, type Role } from "@/server/permissions";

export const dynamic = "force-dynamic";

function day(value: string): number | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value ? date.getTime() : null;
}

/** Small synchronous reports only; no background job is silently simulated. */
export async function GET(request: NextRequest, {params}: {params: Promise<{key:string}>}): Promise<Response> {
  try {
    const auth = await guard(request, "reports.view");
    if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles,"export.data")) return fail("FORBIDDEN", "Nemate pravo izvoza podataka.");
    const {key} = await params;
    if (!isReportKey(key)) return fail("VALIDATION_FAILED", "Nepoznat izvještaj.");
    const search=request.nextUrl.searchParams;
    const parsed=ReportQuery.safeParse({from:search.get("from"),to:search.get("to"),format:search.get("format"),
      projectId:search.get("projectId") ?? undefined,team:search.get("team") ?? undefined});
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravni filteri izvještaja.");
    const from=day(parsed.data.from), to=day(parsed.data.to);
    if (from === null || to === null || to < from || to-from > 366*86400000)
      return fail("VALIDATION_FAILED", "Izaberite ispravan period od najviše 367 dana.");
    const pool=await getVerifiedPool();
    const document=await loadReport(pool,{userId:auth.ctx.userId,companyId:auth.ctx.companyId,
      roles:auth.ctx.roles as Role[],scope:auth.ctx.scope,projectIds:auth.ctx.projectIds},key,parsed.data);
    if (document.rows.length > 1000) return fail("CONFLICT", "Izvještaj je prevelik za sinhroni izvoz.");
    const bytes=parsed.data.format === "pdf" ? renderReportPdf(document) : await renderReportXlsx(document);
    await withCompany(pool,auth.ctx.companyId,async client=>writeAudit(client,{
      companyId:auth.ctx.companyId,actorId:auth.ctx.userId,actorEmail:null,action:"report.exported",
      entityType:"report",entityId:key,retentionClass:"ACCESS",
      metadata:{from:parsed.data.from,to:parsed.data.to,format:parsed.data.format,rowCount:document.rows.length},
    }));
    return new Response(new Uint8Array(bytes),{headers:{
      "Content-Type":parsed.data.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":`attachment; filename="${key.toLowerCase()}.${parsed.data.format}"`,"Cache-Control":"no-store",
    }});
  } catch(error) {
    const message=error instanceof Error ? error.message : "";
    if (message === "REPORT_FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo pregleda izvora izvještaja.");
    if (message === "REPORT_UNSUPPORTED_FILTER") return fail("VALIDATION_FAILED", "Filter tima nije podržan za ovaj izvještaj.");
    if (message === "REPORT_TOO_LARGE") return fail("CONFLICT", "Izvještaj je prevelik za sinhroni izvoz.");
    if (message === "REPORT_MIXED_CURRENCY") return fail("CONFLICT", "Troškovi sadrže neusaglašene valute.");
    return internal(error,"reports.get");
  }
}
