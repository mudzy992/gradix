/** GET/PATCH /api/service-orders/{id} — F8 detalj naloga i izmjena bez statusa. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { getServiceOrder } from "@/server/service-order-service";
import { updateServiceOrder, type PatchServiceOrderInput } from "@/server/service-order-patch";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const detail = await getServiceOrder(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, id);
    if (!detail) return fail("NOT_FOUND", "Nalog ne postoji.");
    return ok(detail);
  } catch (error) {
    return internal(error, "service-orders.get");
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as PatchServiceOrderInput | null;
    if (!body) return fail("VALIDATION_FAILED", "Tijelo zahtjeva nije validno.");
    const outcome = await updateServiceOrder(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      body,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "service-orders.patch");
  }
}
