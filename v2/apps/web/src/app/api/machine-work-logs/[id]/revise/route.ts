/** POST /api/machine-work-logs/:id/revise — R5.1 uredska ispravka sati mašine. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { reviseMachineWorkLog } from "@/server/machine-work-log-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.work_log.revise");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      reason?: string;
      payload?: Record<string, unknown>;
    } | null;
    if (!body?.reason || typeof body.reason !== "string") {
      return fail("VALIDATION_FAILED", "Razlog je obavezan (najmanje 10 znakova).");
    }
    const result = await reviseMachineWorkLog(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, id, {
      reason: body.reason,
      payload: body.payload ?? {},
    });
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo ispravke.");
    if (result.outcome === "VALIDATION_FAILED") return fail(result.code as "VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "machine-work-logs.revise");
  }
}
