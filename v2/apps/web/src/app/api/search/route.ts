import type { NextRequest } from "next/server";
import { SearchQuery } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { globalSearch } from "@/server/global-search";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth=await guard(request);
    if(!auth.ok) return auth.response;
    const parsed=SearchQuery.safeParse({q:request.nextUrl.searchParams.get("q") ?? ""});
    if(!parsed.success) return fail("VALIDATION_FAILED","Pretraga mora imati 2 do 100 znakova.");
    return ok({results:await globalSearch(await getVerifiedPool(),auth.ctx,parsed.data.q.trim())});
  } catch(error) { return internal(error,"search"); }
}
