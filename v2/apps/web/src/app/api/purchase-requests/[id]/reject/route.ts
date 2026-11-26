import type { NextRequest } from "next/server";
import { PurchaseRejectInput } from "@gradix/contracts";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { transitionPurchaseRequest } from "@/server/purchase-request-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic = "force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}):Promise<Response> {
  try {
    const auth=await guard(request,"purchase.manage"); if (!auth.ok) return auth.response;
    const parsed=PurchaseRejectInput.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) return fail("VALIDATION_FAILED","Odluka nije validna.");
    return purchaseResponse(await transitionPurchaseRequest(await getVerifiedPool(),auth.ctx,(await params).id,"reject",parsed.data.reason));
  } catch(error) { return internal(error,"purchase.requests.reject"); }
}
