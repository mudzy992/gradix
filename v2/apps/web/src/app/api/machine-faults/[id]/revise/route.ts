/** POST /api/machine-faults/{id}/revise — R5.5 append-only ispravka. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { reviseMachineFault } from "@/server/machine-fault-revise";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fault.revise");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      reason?: string;
      payload?: Record<string, unknown>;
    } | null;
    if (!body?.reason) return fail("VALIDATION_FAILED", "reason je obavezan.");
    const outcome = await reviseMachineFault(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      { reason: body.reason, payload: body.payload ?? {} },
    );
    if (outcome.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", outcome.message ?? "Nemate pravo ispravke.");
    }
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "machine-faults.revise");
  }
}
