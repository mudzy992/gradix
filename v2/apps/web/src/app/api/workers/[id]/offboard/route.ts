/**
 * POST /api/workers/:id/offboard — „Radnik odlazi“: jedna transakcija, a–f (spec 04 §1.6.24).
 *
 * Neuspjeh je cijela transakcija: radnik koji je „polovično otišao“ je gori od radnika koji
 * još nije razdužen.
 */
import type { NextRequest } from "next/server";
import { WorkerOffboardInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { offboardWorker } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerOffboardInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id } = await context.params;
    const result = await offboardWorker(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      id,
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    const { ok: _ok, ...rest } = result;
    return ok(rest);
  } catch (error) {
    return internal(error, "workers.offboard");
  }
}
