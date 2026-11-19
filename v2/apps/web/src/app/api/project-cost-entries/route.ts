/** GET /api/project-cost-entries — R6.1 lista knjiženja. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listProjectCostEntries } from "@/server/project-cost-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const entries = await listProjectCostEntries(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        projectId: params.get("projectId") ?? undefined,
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
      },
    );
    return ok({ entries });
  } catch (error) {
    return internal(error, "project-cost-entries.list");
  }
}
