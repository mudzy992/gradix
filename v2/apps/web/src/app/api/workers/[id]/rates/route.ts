/** GET/POST /api/workers/:id/rates — istorija cijena; nova cijena je novi red. */
import type { NextRequest } from "next/server";
import { WorkerRateInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { addRate, businessToday, listRates } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.rates.view");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const pool = await getVerifiedPool();
    const result = await listRates(
      pool,
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      id,
      await businessToday(pool, guardResult.ctx.companyId),
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ rates: result.rates, current: result.current });
  } catch (error) {
    return internal(error, "workers.rates.list");
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.rates.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerRateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id } = await context.params;
    const pool = await getVerifiedPool();
    const actor = {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles,
    };
    const added = await addRate(pool, actor, id, parsed.data);
    if (!added.ok) return fail(added.code as never, added.message);

    const after = await listRates(pool, actor, id, added.rate.validFrom);
    if (!after.ok) return fail(after.code as never, after.message);
    return ok({ rates: after.rates, current: after.current });
  } catch (error) {
    return internal(error, "workers.rates.add");
  }
}
