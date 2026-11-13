/**
 * GET /api/workday-conflicts — lista sukoba za razrješenje (`workdays.resolve`).
 * Opseg dolazi iz sesije i povezanog radnika, nikad iz upita.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { listConflicts } from "@/server/workday-resolve";
import { resolveViewerWorkerId, workdayResolveScopeFor } from "@/server/workday-review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.resolve");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const params = request.nextUrl.searchParams;
    // A1: granica kontrolnih znakova za query je zajednička — u guard() (svaka ruta).
    const status = params.get("status");
    const older = params.get("olderThanDays");
    const result = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const viewerWorkerId = await resolveViewerWorkerId(client, ctx.companyId, ctx.userId);
      const scope = workdayResolveScopeFor(ctx.roles, viewerWorkerId);
      return listConflicts(client, ctx.companyId, scope, {
        status: status === "OPEN" || status === "RESOLVED" ? status : undefined,
        projectId: params.get("projectId") ?? undefined,
        olderThanDays: older !== null && Number.isFinite(Number(older)) ? Number(older) : undefined,
        limit: Number(params.get("limit") ?? 50) || 50,
        offset: Number(params.get("offset") ?? 0) || 0,
      });
    });
    return ok(result);
  } catch (error) {
    return internal(error, "workday-conflicts.list");
  }
}
