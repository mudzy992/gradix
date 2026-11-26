import type { NextRequest } from "next/server";
import { PurchaseOrderPatchInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { getPurchaseOrder,patchPurchaseOrder } from "@/server/purchase-order-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Context):Promise<Response> {
  try { const a=await guard(request,"purchase.view"); if(!a.ok) return a.response;
    return purchaseResponse(await getPurchaseOrder(await getVerifiedPool(),a.ctx,(await params).id));
  } catch(error) { return internal(error,"purchase.orders.detail"); }
}
export async function PATCH(request:NextRequest,{params}:Context):Promise<Response> {
  try { const a=await guard(request,"purchase.manage"); if(!a.ok) return a.response;
    const parsed=PurchaseOrderPatchInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Narudžbenica nije validna.");
    return purchaseResponse(await patchPurchaseOrder(await getVerifiedPool(),a.ctx,(await params).id,parsed.data));
  } catch(error) { return internal(error,"purchase.orders.patch"); }
}
