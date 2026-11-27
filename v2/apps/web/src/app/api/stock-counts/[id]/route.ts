import type { NextRequest } from "next/server";
import { internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { getStockCount } from "@/server/stock-count-service";
import { warehouseResponse } from "@/server/warehouse-response";
import type { Role } from "@/server/permissions";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{id:string}> }): Promise<Response> {
  try {
    const a=await guard(request,"stock.manage"); if (!a.ok) return a.response;
    const {id}=await context.params;
    return warehouseResponse(await getStockCount(await getVerifiedPool(),{userId:a.ctx.userId,companyId:a.ctx.companyId,roles:a.ctx.roles as Role[]},id));
  } catch (error) { return internal(error,"stock.counts.detail"); }
}
