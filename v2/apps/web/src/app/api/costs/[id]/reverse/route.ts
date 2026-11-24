/**
 * POST /api/costs/{id}/reverse — storno: original `REVERSED` + novi `POSTED` red sa razlogom.
 *
 * Brisanje troška ne postoji (nema granta, triger ga brani). Zato je ovo jedini način ispravke i
 * razlog je obavezan — inače bi se iz knjige gubio trag zašto se iznos promijenio.
 */
import type { NextRequest } from "next/server";
import { CostReversalInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { reverseCost } from "@/server/cost-entry-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.book");
    if (!guardResult.ok) return guardResult.response;
    const parsed = CostReversalInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("COST_REVERSAL_REASON_REQUIRED", "Storno traži razlog od najmanje 10 znakova.");
    }
    const { id } = await params;
    const result = await reverseCost(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("COST_ALREADY_POSTED", result.message ?? "Konflikt.");
    if (result.outcome === "VALIDATION_FAILED") {
      if (result.code === "COST_REVERSAL_REASON_REQUIRED") {
        return fail("COST_REVERSAL_REASON_REQUIRED", result.message ?? "Razlog je obavezan.");
      }
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message ?? "Nema troška.");
      return fail("VALIDATION_FAILED", result.message ?? "Storno nije moguć.");
    }
    return ok(result);
  } catch (error) {
    return internal(error, "costs.reverse");
  }
}
