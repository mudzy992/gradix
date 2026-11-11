/**
 * GET /api/workday-conflicts/counts — bedž u navigaciji i kartica na Pregledu.
 * Broji SAMO nerazriješene sukobe; stariji od praga su zaseban broj.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { countOpenConflicts } from "@/server/workday-resolve";
import { resolveViewerWorkerId, workdayResolveScopeFor } from "@/server/workday-review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.resolve");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const counts = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const viewerWorkerId = await resolveViewerWorkerId(client, ctx.companyId, ctx.userId);
      return countOpenConflicts(client, ctx.companyId, workdayResolveScopeFor(ctx.roles, viewerWorkerId));
    });
    return ok(counts);
  } catch (error) {
    return internal(error, "workday-conflicts.counts");
  }
}
