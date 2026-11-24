/** GET /api/workers/:id/history — čitljiva vremenska linija kartice radnika. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { workerHistory } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.view");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const result = await workerHistory(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      id,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ entries: result.entries });
  } catch (error) {
    return internal(error, "workers.history");
  }
}
