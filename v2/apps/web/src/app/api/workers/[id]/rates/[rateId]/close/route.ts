/** PATCH /api/workers/:id/rates/:rateId/close — zatvaranje cijene (`valid_to`). */
import type { NextRequest } from "next/server";
import { WorkerRateCloseInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { businessToday, closeRate, listRates } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; rateId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.rates.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerRateCloseInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id, rateId } = await context.params;
    const pool = await getVerifiedPool();
    const actor = {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles,
      scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    };
    const closed = await closeRate(pool, actor, id, rateId, parsed.data.validTo);
    if (!closed.ok) return fail(closed.code as never, closed.message);

    const after = await listRates(pool, actor, id, await businessToday(pool, guardResult.ctx.companyId));
    if (!after.ok) return fail(after.code as never, after.message);
    return ok({ rates: after.rates, current: after.current });
  } catch (error) {
    return internal(error, "workers.rates.close");
  }
}
