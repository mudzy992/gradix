/** POST /api/costs/manual — ručni trošak sa gradilišta (fotografija računa uz unos). */
import type { NextRequest } from "next/server";
import { ManualCostInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createManualCost } from "@/server/cost-entry-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.book");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ManualCostInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos troška.");
    const result = await createManualCost(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "VALIDATION_FAILED") {
      return fail("VALIDATION_FAILED", result.message ?? "Trošak nije moguće upisati.");
    }
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message ?? "Konflikt.");
    return ok(result);
  } catch (error) {
    return internal(error, "costs.manual");
  }
}
