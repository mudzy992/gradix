import type { NextRequest } from "next/server";
import { PurchaseOrderInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { createPurchaseOrder,listPurchaseOrders } from "@/server/purchase-order-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try { const a=await guard(request,"purchase.view"); if(!a.ok) return a.response;
    const result=await listPurchaseOrders(await getVerifiedPool(),a.ctx);
    return purchaseResponse(result.outcome==="OK" ? {outcome:"OK",data:{orders:result.data}} : result);
  } catch(error) { return internal(error,"purchase.orders.list"); }
}
export async function POST(request:NextRequest):Promise<Response> {
  try { const a=await guard(request,"purchase.manage"); if(!a.ok) return a.response;
    const parsed=PurchaseOrderInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Narudžbenica nije validna.");
    return purchaseResponse(await createPurchaseOrder(await getVerifiedPool(),a.ctx,parsed.data));
  } catch(error) { return internal(error,"purchase.orders.create"); }
}
