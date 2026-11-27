/** CSV of the same bounded incident list shown by the HSE screen. */
import type { NextRequest } from "next/server";
import { HseIncidentKind, HseIncidentStatus } from "@gradix/contracts";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { getVerifiedPool } from "@/server/db";
import { listIncidents } from "@/server/hse-service";
import { escapeCsvCell } from "@/server/hours-csv";
import { writeAudit } from "@/server/audit";
import { filterIncidents } from "@/app/ured/hse/hse-filter";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try {
    const auth=await guard(request,"export.data"); if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles,"hse.view") || auth.ctx.scope !== "COMPANY") return fail("FORBIDDEN","Izvoz ove liste dostupan je samo u opsegu firme.");
    const kind=request.nextUrl.searchParams.get("kind") ?? "",status=request.nextUrl.searchParams.get("status") ?? "";
    if ((kind && !HseIncidentKind.safeParse(kind).success) || (status && !HseIncidentStatus.safeParse(status).success)) return fail("VALIDATION_FAILED","Neispravni filteri incidenata.");
    const pool=await getVerifiedPool();
    const all=await listIncidents(pool,{userId:auth.ctx.userId,companyId:auth.ctx.companyId,roles:auth.ctx.roles,scope:auth.ctx.scope,projectIds:auth.ctx.projectIds},{});
    const rows=filterIncidents(all,kind,status);
    const header=["Vrsta","Kada","Težina","Stanje","Projekat","Otvorene mjere","Mjere kasne","Prijava inspekciji"];
    const lines=rows.map(row=>[row.kind,row.occurredAt,row.severity,row.status,row.projectName ?? "",String(row.openActions),String(row.overdueActions),
      row.reportableToAuthority ? (row.reportObligationId ? "obaveza otvorena" : "bez obaveze") : ""].map(escapeCsvCell).join(","));
    await withCompany(pool,auth.ctx.companyId,client=>writeAudit(client,{companyId:auth.ctx.companyId,actorId:auth.ctx.userId,
      actorEmail:null,action:"report.exported",entityType:"incident_list",entityId:"hse",retentionClass:"ACCESS",
      metadata:{kind,status,rowCount:rows.length,format:"csv",snapshotLimit:200}}));
    return new Response(`\uFEFF${header.map(escapeCsvCell).join(",")}\r\n${lines.join("\r\n")}\r\n`,{headers:{
      "Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="incidenti-prikaz.csv"',"Cache-Control":"no-store"}});
  } catch(error) {return internal(error,"hse.incidents.export");}
}
