import type { NextRequest } from "next/server";
import { PurchaseEmptyInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { decideManualCost } from "@/server/manual-cost-approval-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}):Promise<Response> {
  try {const a=await guard(request,"purchase.approve"); if(!a.ok)return a.response; const parsed=PurchaseEmptyInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return fail("VALIDATION_FAILED","Odluka nije validna."); return purchaseResponse(await decideManualCost(await getVerifiedPool(),a.ctx,(await params).id,"approve"));
  } catch(error) {return internal(error,"manual-cost.approve");}
}
