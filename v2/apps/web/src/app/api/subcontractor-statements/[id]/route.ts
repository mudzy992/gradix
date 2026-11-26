import type { NextRequest } from "next/server";
import { internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { getSubStatement } from "@/server/subcontract-statement-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}):Promise<Response> {
  try {const a=await guard(request,"subcontractors.view"); if(!a.ok)return a.response; return purchaseResponse(await getSubStatement(await getVerifiedPool(),a.ctx,(await params).id));
  } catch(error) {return internal(error,"substatements.detail");}
}
