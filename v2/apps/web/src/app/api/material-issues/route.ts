import type { NextRequest } from "next/server";
import { MaterialIssueInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { issueMaterial } from "@/server/material-issue-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest):Promise<Response> {
  try { const a=await guard(request,"stock.manage"); if(!a.ok) return a.response;
    const parsed=MaterialIssueInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Izlaz materijala nije validan.");
    return purchaseResponse(await issueMaterial(await getVerifiedPool(),a.ctx,parsed.data));
  } catch(error) { return internal(error,"purchase.material.issue"); }
}
