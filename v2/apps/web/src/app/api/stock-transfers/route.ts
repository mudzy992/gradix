import type { NextRequest } from "next/server";
import { StockTransferInput } from "@gradix/contracts";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { transferStock } from "@/server/warehouse-service";
import { warehouseResponse } from "@/server/warehouse-response";
import type { Role } from "@/server/permissions";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const a=await guard(request,"stock.manage"); if (!a.ok) return a.response;
    const parsed=StockTransferInput.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) return fail("VALIDATION_FAILED","Transfer nije validan.");
    return warehouseResponse(await transferStock(await getVerifiedPool(),{userId:a.ctx.userId,companyId:a.ctx.companyId,roles:a.ctx.roles as Role[]},parsed.data));
  } catch (error) { return internal(error,"stock.transfer"); }
}
