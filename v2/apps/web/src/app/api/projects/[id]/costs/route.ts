/** GET /api/projects/{id}/costs — ledger jednog projekta; `PENDING` ide odvojeno od zbira. */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listCostEntries } from "@/server/cost-entry-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const search = request.nextUrl.searchParams;
    const result = await listCostEntries(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        projectId: id,
        from: search.get("from") ?? undefined,
        to: search.get("to") ?? undefined,
        categoryId: search.get("categoryId") ?? undefined,
        phaseId: search.get("phaseId") ?? undefined,
      },
    );
    return ok({
      entries: result.entries,
      totals: {
        posted: result.posted,
        currency_code: result.currency,
        pending_count: result.pendingCount,
        pending_quantity_by_unit: result.pendingByUnit,
      },
    });
  } catch (error) {
    return internal(error, "project-costs.list");
  }
}
