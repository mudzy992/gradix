import type { NextRequest } from "next/server";
import { SubcontractContractInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { createSubContract,listSubContracts } from "@/server/subcontract-contract-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try {const a=await guard(request,"subcontractors.view"); if(!a.ok)return a.response; const result=await listSubContracts(await getVerifiedPool(),a.ctx);
    return purchaseResponse(result.outcome==='OK' ? {outcome:'OK',data:{contracts:result.data}} : result);
  } catch(error) {return internal(error,"subcontracts.list");}
}
export async function POST(request:NextRequest):Promise<Response> {
  try {const a=await guard(request,"subcontractors.manage"); if(!a.ok)return a.response; const parsed=SubcontractContractInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return fail("VALIDATION_FAILED","Podaci ugovora nisu validni."); return purchaseResponse(await createSubContract(await getVerifiedPool(),a.ctx,parsed.data));
  } catch(error) {return internal(error,"subcontracts.create");}
}
