import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { loadDashboardActions } from "@/server/dashboard-actions";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth=await guard(request,"dashboard.actions.view");
    if(!auth.ok) return auth.response;
    const result=await loadDashboardActions(await getVerifiedPool(),auth.ctx);
    return result ? ok(result) : fail("FORBIDDEN","Nemate pravo pregleda dashboarda.");
  } catch(error) { return internal(error,"dashboard.actions"); }
}
