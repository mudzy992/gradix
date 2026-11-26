import type { NextRequest } from "next/server";
import { SubcontractStatementInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { createSubStatement,listSubStatements } from "@/server/subcontract-statement-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try {const a=await guard(request,"subcontractors.view"); if(!a.ok)return a.response; const result=await listSubStatements(await getVerifiedPool(),a.ctx);
    return purchaseResponse(result.outcome==='OK' ? {outcome:'OK',data:{statements:result.data}} : result);
  } catch(error) {return internal(error,"substatements.list");}
}
export async function POST(request:NextRequest):Promise<Response> {
  try {const a=await guard(request,"subcontractors.manage"); if(!a.ok)return a.response; const parsed=SubcontractStatementInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return fail("VALIDATION_FAILED","Podaci situacije nisu validni."); return purchaseResponse(await createSubStatement(await getVerifiedPool(),a.ctx,parsed.data));
  } catch(error) {return internal(error,"substatements.create");}
}
