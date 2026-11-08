/** PATCH /api/workers/:id/active — deaktivacija umjesto brisanja (`workers.manage`). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { isServiceError, setWorkerActive } from "@/server/equipment-service";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.manage");
    if (!guardResult.ok) return guardResult.response;

    const body = (await request.json().catch(() => null)) as { active?: unknown } | null;
    if (!body || typeof body.active !== "boolean") {
      return fail("VALIDATION_FAILED", "Polje `active` je obavezno.");
    }

    const { id } = await context.params;
    const result = await setWorkerActive(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      body.active,
    );

    if (isServiceError(result)) {
      return fail(result.code, result.message);
    }
    return ok({ worker: result });
  } catch (error) {
    return internal(error, "workers.setActive");
  }
}
