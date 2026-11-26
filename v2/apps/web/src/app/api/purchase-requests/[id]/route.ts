import type { NextRequest } from "next/server";
import { PurchaseRequestPatchInput } from "@gradix/contracts";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { getPurchaseRequest, patchPurchaseRequest } from "@/server/purchase-request-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic = "force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Context):Promise<Response> {
  try {
    const auth=await guard(request,"purchase.view"); if (!auth.ok) return auth.response;
    return purchaseResponse(await getPurchaseRequest(await getVerifiedPool(),auth.ctx,(await params).id));
  } catch(error) { return internal(error,"purchase.requests.detail"); }
}
export async function PATCH(request:NextRequest,{params}:Context):Promise<Response> {
  try {
    const auth=await guard(request,"purchase.manage"); if (!auth.ok) return auth.response;
    const parsed=PurchaseRequestPatchInput.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) return fail("VALIDATION_FAILED","Zahtjev nabavke nije validan.");
    return purchaseResponse(await patchPurchaseRequest(await getVerifiedPool(),auth.ctx,(await params).id,parsed.data));
  } catch(error) { return internal(error,"purchase.requests.patch"); }
}
