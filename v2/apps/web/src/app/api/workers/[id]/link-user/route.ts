/**
 * PATCH /api/workers/:id/link-user — veza radnika i naloga (`users.manage`).
 *
 * Zašto `users.manage`, a ne `workers.manage`: veza dira korisnika, ne radnika. Veza NE daje
 * dozvole — role i opseg ostaju ono što su bili (vidi docs/PLAN-R2.md §1.5).
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { WorkerLinkPatch } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { isServiceError, linkWorkerUser } from "@/server/equipment-service";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "users.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerLinkPatch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Polje `userId` je obavezno (ili null za odvezivanje).");
    }

    const { id } = await context.params;
    const result = await linkWorkerUser(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      parsed.data.userId,
    );

    if (isServiceError(result)) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "CONFLICT" ? 409 : 400;
      return Response.json({ success: false, error: result }, { status });
    }
    return ok({ worker: result });
  } catch (error) {
    return internal(error, "workers.linkUser");
  }
}
