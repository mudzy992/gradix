import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { getVerifiedPool } from "@/server/db";
import { listObligations } from "@/server/obligation-service";
import { escapeCsvCell } from "@/server/hours-csv";
import { writeAudit } from "@/server/audit";
import { filterObligations } from "@/app/ured/rokovi/obligations-filter";
import { targetLabel } from "@/app/ured/rokovi/obligations-shared";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try {
    const auth=await guard(request,"export.data"); if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles,"obligations.view") || !can(auth.ctx.roles,"workers.view"))
      return fail("FORBIDDEN","Izvoz ove liste zahtijeva pristup radnicima.");
    const p=request.nextUrl.searchParams, state=p.get("state") ?? "",entity=p.get("entityKind") ?? "",type=p.get("typeId") ?? "",q=p.get("q") ?? "";
    const states=["","expired","rejected","pending_review","expiring","review_due","31-90","valid","no_expiry"];
    if (!states.includes(state) || !["","WORKER","MACHINE","PROJECT","TENDER","COMPANY"].includes(entity) || type.length>128 || q.length>128)
      return fail("VALIDATION_FAILED","Neispravni filteri obaveza.");
    const pool=await getVerifiedPool();
    const source=await listObligations(pool,auth.ctx.companyId,{entityKind:entity || undefined},{userId:auth.ctx.userId,scope:auth.ctx.scope,projectIds:auth.ctx.projectIds,includeAttachments:false});
    const rows=filterObligations(source.obligations,state,type,q);
    if (rows.length>1000) return fail("CONFLICT","Izvoz je prevelik; suzite filtere na najviše 1000 redova.");
    const header=["Obaveza","Izdavalac","Broj","Nosilac","Rok","Stanje"];
    const lines=rows.map(row=>[row.typeLabel,row.issuer ?? "",row.number ?? "",targetLabel(row),row.expiresAt ?? "",row.state].map(escapeCsvCell).join(","));
    await withCompany(pool,auth.ctx.companyId,client=>writeAudit(client,{companyId:auth.ctx.companyId,actorId:auth.ctx.userId,
      actorEmail:null,action:"report.exported",entityType:"obligation_list",entityId:"obligations",retentionClass:"ACCESS",
      metadata:{state,entityKind:entity || null,typeId:type || null,filtered:Boolean(q),rowCount:rows.length,format:"csv"}}));
    return new Response(`\uFEFF${header.map(escapeCsvCell).join(",")}\r\n${lines.join("\r\n")}\r\n`,{headers:{
      "Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="rokovi-prikaz.csv"',"Cache-Control":"no-store"}});
  } catch(error) {return internal(error,"obligations.export");}
}
