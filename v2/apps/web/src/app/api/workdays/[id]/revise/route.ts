/** POST /api/workdays/:id/revise — uredska revizija (`workdays.revise`). Ne dira LOCKED red. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { reviseWorkday } from "@/server/workday-week-actions";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.revise");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      reason?: string;
      payload?: Record<string, unknown>;
    } | null;
    if (!body?.reason || typeof body.reason !== "string") {
      return fail("VALIDATION_FAILED", "Razlog je obavezan (najmanje 10 znakova).");
    }
    const result = await reviseWorkday(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
      scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    }, {
      workdayId: id,
      reason: body.reason,
      payload: body.payload ?? {},
    });
    if (result.outcome === "NOT_FOUND") return fail("NOT_FOUND", "Radni dan nije pronađen.");
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo revizije.");
    return ok(result);
  } catch (error) {
    return internal(error, "workdays.revise");
  }
}
