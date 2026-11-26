import type { NextRequest } from "next/server";
import { PurchaseRequestInput } from "@gradix/contracts";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { createPurchaseRequest, listPurchaseRequests } from "@/server/purchase-request-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest):Promise<Response> {
  try {
    const auth=await guard(request,"purchase.view"); if (!auth.ok) return auth.response;
    const result=await listPurchaseRequests(await getVerifiedPool(),auth.ctx);
    return purchaseResponse(result.outcome==="OK" ? {outcome:"OK",data:{requests:result.data}} : result);
  } catch(error) { return internal(error,"purchase.requests.list"); }
}
export async function POST(request: NextRequest):Promise<Response> {
  try {
    const auth=await guard(request,"purchase.manage"); if (!auth.ok) return auth.response;
    const parsed=PurchaseRequestInput.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) return fail("VALIDATION_FAILED","Zahtjev nabavke nije validan.");
    return purchaseResponse(await createPurchaseRequest(await getVerifiedPool(),auth.ctx,parsed.data));
  } catch(error) { return internal(error,"purchase.requests.create"); }
}
