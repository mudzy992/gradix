/** CSV of the same bounded list used by table and kanban. */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { guard } from "@/server/guard";
import { can, type Role } from "@/server/permissions";
import { getVerifiedPool } from "@/server/db";
import { listTenders } from "@/server/tender-service";
import { isTenderStatus } from "@/server/tender-status";
import { escapeCsvCell } from "@/server/hours-csv";
import { writeAudit } from "@/server/audit";
import { filterTenderList } from "@/app/ured/tenderi/tenders-shared";

export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try {
    const auth=await guard(request,"export.data"); if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles,"tenders.view") || auth.ctx.scope !== "COMPANY") return fail("FORBIDDEN","Izvoz ove liste dostupan je samo u opsegu firme.");
    const status=request.nextUrl.searchParams.get("status") ?? "";
    const urgent=request.nextUrl.searchParams.get("urgent") ?? "0";
    if ((status && !isTenderStatus(status)) || !["0","1"].includes(urgent)) return fail("VALIDATION_FAILED","Neispravni filteri tendera.");
    const pool=await getVerifiedPool();
    const all=await listTenders(pool,{userId:auth.ctx.userId,companyId:auth.ctx.companyId,roles:auth.ctx.roles as Role[],scope:auth.ctx.scope,projectIds:auth.ctx.projectIds});
    const rows=filterTenderList(all,status,urgent === "1");
    const margin=can(auth.ctx.roles,"tenders.price.manage");
    const header=["Predmet","Naručilac","Rok","Vrijednost","Valuta",...(margin ? ["Marža %"] : []),"Status"];
    const lines=rows.map(row=>[row.title,row.partnerName,row.deadlineAt ?? "",row.submittedValueAmount,row.currencyCode,
      ...(margin ? [row.markupPct ?? ""] : []),row.status].map(escapeCsvCell).join(","));
    await withCompany(pool,auth.ctx.companyId,client=>writeAudit(client,{companyId:auth.ctx.companyId,actorId:auth.ctx.userId,
      actorEmail:null,action:"report.exported",entityType:"tender_list",entityId:"tenders",retentionClass:"ACCESS",
      metadata:{status,urgent:urgent === "1",rowCount:rows.length,format:"csv",snapshotLimit:500}}));
    return new Response(`\uFEFF${header.map(escapeCsvCell).join(",")}\r\n${lines.join("\r\n")}\r\n`,{headers:{
      "Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="tenderi-prikaz.csv"',"Cache-Control":"no-store"}});
  } catch(error) {return internal(error,"tenders.export");}
}
