/** POST /api/project-cost-entries/book — R6.1 knjiženje (idempotentno). */
import type { NextRequest } from "next/server";
import { ProjectCostBookInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { bookProjectCosts } from "@/server/project-cost-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.book");
    if (!guardResult.ok) return guardResult.response;
    const raw = await request.json().catch(() => null);
    const parsed = ProjectCostBookInput.safeParse(raw);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Neispravan zahtjev za knjiženje.");
    }
    const result = await bookProjectCosts(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", result.message ?? "Nemate pravo knjiženja.");
    }
    if (result.outcome === "VALIDATION_FAILED") {
      return fail("VALIDATION_FAILED", result.message ?? "Knjiženje nije moguće.");
    }
    if (result.outcome === "CONFLICT") {
      return fail("CONFLICT", result.message ?? "Konflikt.");
    }
    return ok(result);
  } catch (error) {
    return internal(error, "project-cost-entries.book");
  }
}
