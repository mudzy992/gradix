/** POST /api/machine-faults/{id}/reject — R5.5 OWNER/ADMIN odbijanje troška. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { rejectMachineFault } from "@/server/machine-fault-decide";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fault.approve");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { reason?: string | null } | null;
    const outcome = await rejectMachineFault(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      body?.reason,
    );
    if (outcome.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", outcome.message ?? "Nemate pravo odbijanja.");
    }
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "machine-faults.reject");
  }
}
