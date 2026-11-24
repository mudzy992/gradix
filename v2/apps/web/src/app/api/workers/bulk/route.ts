/** POST /api/workers/bulk — masovne izmjene: jedna transakcija, izvještaj preskočenih. */
import type { NextRequest } from "next/server";
import { WorkerBulkInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { bulkWorkers } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerBulkInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const result = await bulkWorkers(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ updated: result.updated, skipped: result.skipped });
  } catch (error) {
    return internal(error, "workers.bulk");
  }
}
