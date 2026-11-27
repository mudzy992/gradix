import type { NextRequest } from "next/server";
import { StockCountCreateInput } from "@gradix/contracts";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { createStockCount, listStockCounts } from "@/server/stock-count-service";
import { warehouseResponse } from "@/server/warehouse-response";
import type { Role } from "@/server/permissions";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const a=await guard(request,"stock.manage"); if (!a.ok) return a.response;
    const result=await listStockCounts(await getVerifiedPool(),{userId:a.ctx.userId,companyId:a.ctx.companyId,roles:a.ctx.roles as Role[]});
    return warehouseResponse(result.outcome === "OK" ? {outcome:"OK",data:{counts:result.data}} : result);
  } catch (error) { return internal(error,"stock.counts.list"); }
}
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const a=await guard(request,"stock.manage"); if (!a.ok) return a.response;
    const parsed=StockCountCreateInput.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) return fail("VALIDATION_FAILED","Popis nije validan.");
    return warehouseResponse(await createStockCount(await getVerifiedPool(),{userId:a.ctx.userId,companyId:a.ctx.companyId,roles:a.ctx.roles as Role[]},parsed.data));
  } catch (error) { return internal(error,"stock.counts.create"); }
}
