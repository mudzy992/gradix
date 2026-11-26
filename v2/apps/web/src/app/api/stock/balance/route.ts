import type { NextRequest } from "next/server";
import { internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { stockBalance } from "@/server/warehouse-service";
import { warehouseResponse } from "@/server/warehouse-response";
import type { Role } from "@/server/permissions";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const a=await guard(request,"stock.view"); if (!a.ok) return a.response;
    const p=request.nextUrl.searchParams;
    const result=await stockBalance(await getVerifiedPool(),{userId:a.ctx.userId,companyId:a.ctx.companyId,roles:a.ctx.roles as Role[]},
      { warehouseId:p.get("warehouse") ?? undefined,itemId:p.get("item") ?? undefined,belowMinimum:p.get("belowMinimum") === "1" });
    return warehouseResponse(result.outcome === "OK" ? {outcome:"OK",data:{balances:result.data}} : result);
  } catch (error) { return internal(error,"stock.balance"); }
}
