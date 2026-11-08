/** PATCH /api/equipment/:id — izmjena mašine (`equipment.manage`). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { updateMachine, isServiceError, type MachineInput } from "@/server/equipment-service";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.manage");
    if (!guardResult.ok) return guardResult.response;

    const input = (await request.json().catch(() => null)) as MachineInput | null;
    if (!input) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    const { id } = await context.params;
    const result = await updateMachine(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ machine: result });
  } catch (error) {
    return internal(error, "equipment.update");
  }
}
