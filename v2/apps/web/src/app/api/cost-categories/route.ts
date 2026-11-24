/**
 * GET  /api/cost-categories — šifarnik kategorija troška + mapiranje izvora.
 * POST /api/cost-categories — nova kategorija ili izmjena postojeće.
 *
 * Zašto `POST` i za izmjenu: `id` u tijelu odlučuje. Jedna ruta, jedna dozvola (`projects.costs.manage`)
 * — dvije rute za isti šifarnik bi značile dva mjesta na kojima se provjerava mapiranje izvora.
 */
import type { NextRequest } from "next/server";
import { CostCategoryInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listCostCategories, saveCostCategory, isServiceError } from "@/server/project-budget-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.view");
    if (!guardResult.ok) return guardResult.response;
    const result = await listCostCategories(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    });
    if ("code" in result) return fail("FORBIDDEN", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "cost-categories.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = CostCategoryInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos kategorije troška.");
    const result = await saveCostCategory(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (isServiceError(result)) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      if (result.code === "CONFLICT") return fail("CONFLICT", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "cost-categories.save");
  }
}
