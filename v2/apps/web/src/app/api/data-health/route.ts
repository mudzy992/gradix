import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { loadDataHealth } from "@/server/data-health";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "users.manage");
    if (!auth.ok) return auth.response;
    const data = await loadDataHealth(await getVerifiedPool(), auth.ctx);
    return data ? ok(data) : fail("FORBIDDEN", "Nemate pravo pregleda kvaliteta podataka.");
  } catch (error) { return internal(error, "data-health"); }
}
