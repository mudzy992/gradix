/** GET/POST /api/service-orders — F8 radionica: red čekanja i unos naloga. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createServiceOrder, listServiceOrders, type CreateServiceOrderInput } from "@/server/service-order-service";
import { isServiceOrderStatus } from "@gradix/domain";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    const orders = await listServiceOrders(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      {
        status: status && isServiceOrderStatus(status) ? status : undefined,
        machineId: params.get("machine") ?? params.get("machineId") ?? undefined,
        waitingParts: params.get("waiting") === "1" || params.get("waiting") === "true",
        mineOnly: params.get("mine") === "1" || params.get("mine") === "true",
      },
    );
    return ok({ orders });
  } catch (error) {
    return internal(error, "service-orders.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as CreateServiceOrderInput | null;
    if (!body?.machineId || !body.description || !body.origin || !body.kind || !body.priority) {
      return fail("VALIDATION_FAILED", "machineId, description, origin, kind i priority su obavezni.");
    }
    const outcome = await createServiceOrder(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      body,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "service-orders.create");
  }
}
