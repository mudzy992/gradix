import type { NextRequest } from "next/server";
import { StockCountApplyInput } from "@gradix/contracts";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { applyStockCount } from "@/server/stock-count-service";
import { warehouseResponse } from "@/server/warehouse-response";
import type { Role } from "@/server/permissions";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{id:string}> }): Promise<Response> {
  try {
    const a=await guard(request,"stock.manage"); if (!a.ok) return a.response;
    const parsed=StockCountApplyInput.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) return fail("VALIDATION_FAILED","Popis nije validan.");
    const {id}=await context.params;
    return warehouseResponse(await applyStockCount(await getVerifiedPool(),{userId:a.ctx.userId,companyId:a.ctx.companyId,roles:a.ctx.roles as Role[]},id,parsed.data.reason));
  } catch (error) { return internal(error,"stock.counts.apply"); }
}
