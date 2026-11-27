/** GET /api/machines/{id}/reliability?from&to — F8 MTBF/MTTR i trošak po satu rada. */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { withCompany } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { machineReliabilityFor } from "@/server/machine-reliability-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const params = request.nextUrl.searchParams;
    const pool = await getVerifiedPool();
    const reliability = await withCompany(pool, guardResult.ctx.companyId, (client) =>
      machineReliabilityFor(client, {
        companyId: guardResult.ctx.companyId,
        machineId: id,
        from: params.get("from"),
        to: params.get("to"),
      }),
    );
    return ok({ reliability });
  } catch (error) {
    return internal(error, "machines.reliability");
  }
}
