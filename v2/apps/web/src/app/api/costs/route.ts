/** GET /api/costs — ledger troškova firme sa filterima (projekat, period, kategorija, faza, status). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listCostEntries } from "@/server/cost-entry-service";
import type { CostEntryRow } from "@/server/cost-entry-types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    if (status !== null && !["POSTED", "PENDING", "REVERSED"].includes(status)) {
      return fail("VALIDATION_FAILED", "Nepoznat status troška.");
    }
    const result = await listCostEntries(
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
        categoryId: params.get("categoryId") ?? undefined,
        phaseId: params.get("phaseId") ?? undefined,
        status: (status as CostEntryRow["status"] | null) ?? undefined,
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
    return internal(error, "costs.list");
  }
}
