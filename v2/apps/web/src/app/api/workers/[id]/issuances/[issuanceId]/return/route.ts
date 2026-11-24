/** PATCH /api/workers/:id/issuances/:issuanceId/return — povrat, nikad brisanje. */
import type { NextRequest } from "next/server";
import { WorkerIssuanceReturnInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { returnIssuance } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; issuanceId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.issuances.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerIssuanceReturnInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id, issuanceId } = await context.params;
    const result = await returnIssuance(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      id,
      issuanceId,
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ issuances: result.issuances, activeCount: result.activeCount });
  } catch (error) {
    return internal(error, "workers.issuances.return");
  }
}
