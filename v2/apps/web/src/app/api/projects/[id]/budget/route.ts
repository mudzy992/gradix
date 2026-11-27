/**
 * GET  /api/projects/{id}/budget — budžet po revizijama; `?revision=` bira reviziju.
 * POST /api/projects/{id}/budget — NOVA revizija (budžet se nikad ne prepisuje).
 */
import type { NextRequest } from "next/server";
import { ProjectBudgetInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { getBudget, reviseBudget } from "@/server/project-budget-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function errorResponse(result: { code: string; message: string }): Response {
  if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
  if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
  if (result.code === "BUDGET_REVISION_CONFLICT") {
    return fail("BUDGET_REVISION_CONFLICT", result.message);
  }
  return fail("VALIDATION_FAILED", result.message);
}

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.costs.view");
    if (!guardResult.ok) return guardResult.response;
    const raw = request.nextUrl.searchParams.get("revision");
    const revision = raw === null ? undefined : Number(raw);
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) {
      return fail("VALIDATION_FAILED", "Revizija mora biti cijeli broj ≥ 1.");
    }
    const { id } = await params;
    const result = await getBudget(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      revision,
    );
    if ("code" in result) return errorResponse(result);
    return ok(result);
  } catch (error) {
    return internal(error, "project-budget.get");
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.budget.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProjectBudgetInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos budžeta.");
    const { id } = await params;
    const result = await reviseBudget(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data,
    );
    if ("code" in result) return errorResponse(result);
    return ok(result);
  } catch (error) {
    return internal(error, "project-budget.revise");
  }
}
