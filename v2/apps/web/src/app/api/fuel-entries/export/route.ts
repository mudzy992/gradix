/** Export the same bounded 500-row snapshot as the fuel screen, then apply its machine filter. */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { getVerifiedPool } from "@/server/db";
import { listFuelEntries } from "@/server/fuel-entry-service";
import { canViewFuelPrice } from "@/server/fuel-entry-price";
import { escapeCsvCell } from "@/server/hours-csv";
import { writeAudit } from "@/server/audit";

export const dynamic = "force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try {
    const auth=await guard(request,"export.data");
    if (!auth.ok) return auth.response;
    if (!can(auth.ctx.roles,"machines.fuel.view") || auth.ctx.scope !== "COMPANY")
      return fail("FORBIDDEN","Izvoz ove liste dostupan je samo u opsegu firme.");
    const machineId=request.nextUrl.searchParams.get("machineId") ?? "";
    if (machineId.length > 128) return fail("VALIDATION_FAILED","Neispravan filter mašine.");
    const pool=await getVerifiedPool();
    const actor={userId:auth.ctx.userId,companyId:auth.ctx.companyId,roles:auth.ctx.roles,scope:auth.ctx.scope,projectIds:auth.ctx.projectIds};
    const all=await listFuelEntries(pool,actor,{});
    const rows=machineId ? all.filter(row=>row.machine_id===machineId) : all;
    const price=canViewFuelPrice(auth.ctx.roles);
    const header=["Mašina","Vozač","Točenje","Litara",...(price ? ["Iznos","Valuta"] : []),"Brojilo","Projekat"];
    const lines=rows.map(row=>[`${row.machine_code} — ${row.machine_name}`,row.driver_name,row.filled_at,String(row.liters),
      ...(price ? [row.amount ?? "",row.currency_code ?? ""] : []),row.meter_reading === null ? "" : String(row.meter_reading),
      row.project_name ?? ""].map(escapeCsvCell).join(","));
    await withCompany(pool,auth.ctx.companyId,client=>writeAudit(client,{companyId:auth.ctx.companyId,
      actorId:auth.ctx.userId,actorEmail:null,action:"report.exported",entityType:"fuel_list",entityId:"fuel",
      retentionClass:"ACCESS",metadata:{machineId:machineId || null,rowCount:rows.length,format:"csv",snapshotLimit:500}}));
    return new Response(`\uFEFF${header.map(escapeCsvCell).join(",")}\r\n${lines.join("\r\n")}\r\n`,{headers:{
      "Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="gorivo-prikaz.csv"',"Cache-Control":"no-store",
    }});
  } catch(error) {return internal(error,"fuel-entries.export");}
}
