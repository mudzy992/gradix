/** GET/POST /api/workers/:id/leave — saldo dopusta i upis prava za godinu. */
import type { NextRequest } from "next/server";
import { WorkerLeaveEntitlementInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { setLeaveEntitlement, workerLeave } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.leave.view");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const result = await workerLeave(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      id,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ workerId: result.workerId, years: result.years });
  } catch (error) {
    return internal(error, "workers.leave.get");
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.leave.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerLeaveEntitlementInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id } = await context.params;
    const result = await setLeaveEntitlement(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      id,
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ workerId: id, years: result.years });
  } catch (error) {
    return internal(error, "workers.leave.set");
  }
}
