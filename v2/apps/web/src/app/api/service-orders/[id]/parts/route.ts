/** POST /api/service-orders/{id}/parts — F8 utrošak dijela (kretnja OUT + trošak). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { addServiceOrderPart } from "@/server/service-order-actions";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { itemId?: string; quantity?: string; unitCostAmount?: string | null; note?: string | null }
      | null;
    if (!body?.itemId || !body.quantity) {
      return fail("VALIDATION_FAILED", "itemId i quantity su obavezni.");
    }
    const outcome = await addServiceOrderPart(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      {
        itemId: body.itemId,
        quantity: body.quantity,
        unitCostAmount: body.unitCostAmount ?? null,
        note: body.note ?? null,
      },
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "service-orders.parts");
  }
}
