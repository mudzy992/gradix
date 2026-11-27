/** GET /api/fuel-entries/deviations — odstupanja potrošnje (OPEN prva). */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listFuelDeviations } from "@/server/fuel-price-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fuel.view");
    if (!guardResult.ok) return guardResult.response;
    const statusParam = request.nextUrl.searchParams.get("status");
    const status =
      statusParam === "OPEN" || statusParam === "EXPLAINED" || statusParam === "DISMISSED"
        ? statusParam
        : undefined;
    const result = await listFuelDeviations(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[], scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
      },
      { status, machineId: request.nextUrl.searchParams.get("machineId") ?? undefined },
    );
    return ok(result);
  } catch (error) {
    return internal(error, "fuel-deviations.list");
  }
}
