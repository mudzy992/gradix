import type { NextRequest } from "next/server";
import { MaterialIssueInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { issueMaterial } from "@/server/material-issue-service";
import { listMaterialIssues } from "@/server/phase-10b-list-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try { const a=await guard(request,"purchase.view"); if(!a.ok) return a.response;
    const result=await listMaterialIssues(await getVerifiedPool(),a.ctx);
    return purchaseResponse(result.outcome==="OK" ? {outcome:"OK",data:{issues:result.data}} : result);
  } catch(error) { return internal(error,"purchase.material.list"); }
}
export async function POST(request:NextRequest):Promise<Response> {
  try { const a=await guard(request,"stock.manage"); if(!a.ok) return a.response;
    const parsed=MaterialIssueInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Izlaz materijala nije validan.");
    return purchaseResponse(await issueMaterial(await getVerifiedPool(),a.ctx,parsed.data));
  } catch(error) { return internal(error,"purchase.material.issue"); }
}
