import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { getVerifiedPool } from "@/server/db";
import { isProjectStatus, listProjects } from "@/server/project-service";
import { escapeCsvCell } from "@/server/hours-csv";
import { writeAudit } from "@/server/audit";
import { filterProjects } from "@/app/ured/projekti/projects-filter";
import { projectFinancialSummaries } from "@/app/ured/projekti/projects-summary";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try {
    const auth=await guard(request,"export.data"); if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles,"projects.view")) return fail("FORBIDDEN","Nemate pravo pregleda projekata.");
    const status=request.nextUrl.searchParams.get("status") ?? "",risk=request.nextUrl.searchParams.get("risky") ?? "0";
    if ((status && !isProjectStatus(status)) || !["0","1"].includes(risk)) return fail("VALIDATION_FAILED","Neispravni filteri projekata.");
    const money=can(auth.ctx.roles,"projects.costs.view");
    if (risk === "1" && !money) return fail("FORBIDDEN","Nemate pravo pregleda finansijskih pokazatelja.");
    const pool=await getVerifiedPool();
    const projects=await listProjects(pool,auth.ctx.companyId,{userId:auth.ctx.userId,roles:auth.ctx.roles,scope:auth.ctx.scope,projectIds:auth.ctx.projectIds},{includeInactive:true});
    const summaries=await projectFinancialSummaries(pool,auth.ctx.companyId,projects.map(row=>row.id));
    const rows=filterProjects(projects,status,risk === "1",Object.fromEntries(summaries));
    if (rows.length>1000) return fail("CONFLICT","Izvoz je prevelik; suzite filtere na najviše 1000 redova.");
    const header=["Kod","Projekat","Stanje","Napredak %",...(money ? ["Marža"] : []),"Lokacija","Radnici","Mašine","Isteklo","Uskoro ističe"];
    const lines=rows.map(row=>[row.code,row.name,row.status,String(summaries.get(row.id)?.progress_pct ?? ""),
      ...(money ? [summaries.get(row.id)?.margin ?? ""] : []),row.sitePlace ?? "",String(row.workerCount),String(row.machineCount),
      String(row.overdueObligations),String(row.expiringObligations)].map(escapeCsvCell).join(","));
    await withCompany(pool,auth.ctx.companyId,client=>writeAudit(client,{companyId:auth.ctx.companyId,actorId:auth.ctx.userId,
      actorEmail:null,action:"report.exported",entityType:"project_list",entityId:"projects",retentionClass:"ACCESS",
      metadata:{status,risky:risk === "1",rowCount:rows.length,format:"csv"}}));
    return new Response(`\uFEFF${header.map(escapeCsvCell).join(",")}\r\n${lines.join("\r\n")}\r\n`,{headers:{
      "Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="projekti-prikaz.csv"',"Cache-Control":"no-store"}});
  } catch(error) {return internal(error,"projects.export");}
}
