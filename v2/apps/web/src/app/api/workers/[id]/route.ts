/** PATCH /api/workers/:id — izmjena radnika (`workers.manage`). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { WorkerInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { updateWorker, isServiceError } from "@/server/equipment-service";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerInput.partial().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const { id } = await context.params;
    const result = await updateWorker(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      input,
    );

    if (isServiceError(result)) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "CONFLICT" ? 409 : 400;
      return Response.json({ success: false, error: result }, { status });
    }
    return ok({ worker: result });
  } catch (error) {
    return internal(error, "workers.update");
  }
}
