import type { NextRequest } from "next/server";
import { PurchaseEmptyInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { sendPurchaseOrder } from "@/server/purchase-order-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}):Promise<Response> {
  try { const a=await guard(request,"purchase.manage"); if(!a.ok) return a.response;
    if(!PurchaseEmptyInput.safeParse(await request.json().catch(()=>null)).success) return fail("VALIDATION_FAILED","Unos nije validan.");
    return purchaseResponse(await sendPurchaseOrder(await getVerifiedPool(),a.ctx,(await params).id));
  } catch(error) { return internal(error,"purchase.orders.send"); }
}
