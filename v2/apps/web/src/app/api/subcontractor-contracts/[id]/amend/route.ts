import type { NextRequest } from "next/server";
import { SubcontractAmendInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { amendSubContract,listSubContractAmendments } from "@/server/subcontract-contract-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}):Promise<Response> {
  try {const a=await guard(request,"subcontractors.view"); if(!a.ok)return a.response;
    const result=await listSubContractAmendments(await getVerifiedPool(),a.ctx,(await params).id);
    return purchaseResponse(result.outcome==="OK" ? {outcome:"OK",data:{amendments:result.data}} : result);
  } catch(error) {return internal(error,"subcontracts.amendments.list");}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}):Promise<Response> {
  try {const a=await guard(request,"subcontractors.manage"); if(!a.ok)return a.response; const parsed=SubcontractAmendInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return fail("VALIDATION_FAILED","Podaci aneksa nisu validni."); return purchaseResponse(await amendSubContract(await getVerifiedPool(),a.ctx,(await params).id,parsed.data));
  } catch(error) {return internal(error,"subcontracts.amend");}
}
