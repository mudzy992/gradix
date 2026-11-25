/** GET /api/machines/{id}/maintenance — F8 planovi, historija i pouzdanost mašine. */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { withCompany } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listMaintenancePlans } from "@/server/maintenance-service";
import { machineMaintenanceView } from "@/server/machine-reliability-service";

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
    const actor = {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    };
    const pool = await getVerifiedPool();
    /* Planovi i pouzdanost dolaze iz ISTOG zahtjeva (kartica mašine ih prikazuje zajedno), a
       pouzdanost otvara vlastitu transakciju — zato `listMaintenancePlans` ide prije nje. */
    const plans = await listMaintenancePlans(pool, actor, id);
    const view = await withCompany(pool, actor.companyId, (client) =>
      machineMaintenanceView(client, {
        companyId: actor.companyId,
        machineId: id,
        from: params.get("from"),
        to: params.get("to"),
      }),
    );
    return ok({ plans, reliability: view.reliability, orders: view.orders });
  } catch (error) {
    return internal(error, "machines.maintenance");
  }
}
