import type { NextRequest } from "next/server";
import { PurchaseEmptyInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { approveSubStatement } from "@/server/subcontract-statement-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}):Promise<Response> {
  try {const a=await guard(request,"subcontractors.manage"); if(!a.ok)return a.response; if(!PurchaseEmptyInput.safeParse(await request.json().catch(()=>null)).success)return fail("VALIDATION_FAILED","Unos nije validan.");
    return purchaseResponse(await approveSubStatement(await getVerifiedPool(),a.ctx,(await params).id));
  } catch(error) {return internal(error,"substatements.approve");}
}
