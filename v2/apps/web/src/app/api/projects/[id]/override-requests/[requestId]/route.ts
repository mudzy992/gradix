/**
 * POST /api/projects/:id/override-requests/:requestId — ODOBRENJE iznimke (`projects.override`).
 *
 * Odobrenje stvara dodjelu sa iznimkom u istoj transakciji; zahtjev bez dodjele ne visi ni o čemu.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { OverrideApproveInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { approveOverride, isServiceError } from "@/server/project-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; requestId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.override");
    if (!guardResult.ok) return guardResult.response;

    const parsed = OverrideApproveInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje rok do kojeg iznimka važi.");
    const input = parsed.data;

    const { requestId } = await context.params;
    const result = await approveOverride(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        userId: guardResult.ctx.userId,
        roles: guardResult.ctx.roles,
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      requestId,
      { validUntil: input.validUntil, fromDate: input.fromDate, toDate: input.toDate ?? null },
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ assignment: result });
  } catch (error) {
    return internal(error, "projects.override_approve");
  }
}
