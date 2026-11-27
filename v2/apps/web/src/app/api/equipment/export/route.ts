import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { getVerifiedPool } from "@/server/db";
import { listMachines } from "@/server/equipment-service";
import { escapeCsvCell } from "@/server/hours-csv";
import { writeAudit } from "@/server/audit";
import { filterEquipment } from "@/app/ured/masine/equipment-filter";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try {
    const auth=await guard(request,"export.data"); if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles,"equipment.view") || auth.ctx.scope !== "COMPANY") return fail("FORBIDDEN","Izvoz ove liste dostupan je samo u opsegu firme.");
    const params=request.nextUrl.searchParams, q=params.get("q") ?? "", category=params.get("categoryId") ?? "", inactive=params.get("inactive") ?? "0";
    if (q.length>128 || category.length>128 || !["0","1"].includes(inactive)) return fail("VALIDATION_FAILED","Neispravni filteri mašina.");
    const pool=await getVerifiedPool();
    const rows=filterEquipment(await listMachines(pool,auth.ctx.companyId),q,category,inactive === "1");
    if (rows.length>1000) return fail("CONFLICT","Izvoz je prevelik; suzite filtere na najviše 1000 redova.");
    const header=["Oznaka","Naziv","Proizvođač","Model","Tablice","Kategorija","Brojilo","Jedinica","Vlasništvo","Aktivna"];
    const lines=rows.map(row=>[row.code,row.name,row.make ?? "",row.model ?? "",row.plate ?? "",row.categoryName,
      row.meterValue === null ? "" : String(row.meterValue),row.meter,row.ownership,row.isActive ? "DA" : "NE"].map(escapeCsvCell).join(","));
    await withCompany(pool,auth.ctx.companyId,client=>writeAudit(client,{companyId:auth.ctx.companyId,actorId:auth.ctx.userId,
      actorEmail:null,action:"report.exported",entityType:"equipment_list",entityId:"equipment",retentionClass:"ACCESS",
      metadata:{categoryId:category || null,inactive:inactive === "1",filtered:Boolean(q),rowCount:rows.length,format:"csv"}}));
    return new Response(`\uFEFF${header.map(escapeCsvCell).join(",")}\r\n${lines.join("\r\n")}\r\n`,{headers:{
      "Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="masine-prikaz.csv"',"Cache-Control":"no-store"}});
  } catch(error) {return internal(error,"equipment.export");}
}
