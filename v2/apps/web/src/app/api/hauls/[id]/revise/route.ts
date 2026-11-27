/** POST /api/hauls/:id/revise — R5.3 uredska ispravka ture. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { reviseHaul } from "@/server/haul-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.haul.revise");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      reason?: string;
      payload?: Record<string, unknown>;
    } | null;
    if (!body?.reason) return fail("VALIDATION_FAILED", "Razlog je obavezan.");
    const result = await reviseHaul(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
      scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    }, id, { reason: body.reason, payload: body.payload ?? {} });
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "hauls.revise");
  }
}
