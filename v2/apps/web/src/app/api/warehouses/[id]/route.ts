import type { NextRequest } from "next/server";
import { WarehousePatchInput } from "@gradix/contracts";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { patchWarehouse } from "@/server/warehouse-service";
import { warehouseResponse } from "@/server/warehouse-response";
import type { Role } from "@/server/permissions";
export const dynamic = "force-dynamic";
export async function PATCH(request: NextRequest, context: { params: Promise<{ id:string }> }): Promise<Response> {
  try {
    const a=await guard(request,"stock.manage"); if (!a.ok) return a.response;
    const parsed=WarehousePatchInput.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) return fail("VALIDATION_FAILED","Skladište nije validno.");
    const {id}=await context.params;
    return warehouseResponse(await patchWarehouse(await getVerifiedPool(),{userId:a.ctx.userId,companyId:a.ctx.companyId,roles:a.ctx.roles as Role[]},id,parsed.data));
  } catch (error) { return internal(error,"warehouses.patch"); }
}
