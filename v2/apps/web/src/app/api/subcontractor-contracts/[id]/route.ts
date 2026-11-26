import type { NextRequest } from "next/server";
import { SubcontractContractPatch } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { listSubContracts,patchSubContract } from "@/server/subcontract-contract-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Context):Promise<Response> {
  try {const a=await guard(request,"subcontractors.view"); if(!a.ok)return a.response; const result=await listSubContracts(await getVerifiedPool(),a.ctx,(await params).id);
    if(result.outcome!=="OK")return purchaseResponse(result); if(!result.data[0])return fail("NOT_FOUND","Ugovor ne postoji."); return purchaseResponse({outcome:"OK",data:{contract:result.data[0]}});
  } catch(error) {return internal(error,"subcontracts.detail");}
}
export async function PATCH(request:NextRequest,{params}:Context):Promise<Response> {
  try {const a=await guard(request,"subcontractors.manage"); if(!a.ok)return a.response; const parsed=SubcontractContractPatch.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return fail("VALIDATION_FAILED","Podaci ugovora nisu validni."); return purchaseResponse(await patchSubContract(await getVerifiedPool(),a.ctx,(await params).id,parsed.data));
  } catch(error) {return internal(error,"subcontracts.patch");}
}
