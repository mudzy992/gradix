/** POST /api/fuel-entries/:id/price — office fills an unknown fuel amount. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { setFuelAmount } from "@/server/fuel-entry-price-set";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fuel.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { totalAmount?: unknown } | null;
    if (typeof body?.totalAmount !== "string") {
      return fail("VALIDATION_FAILED", "Ured mora unijeti iznos. Nepoznat iznos nije 0.00.");
    }
    const result = await setFuelAmount(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, id, body.totalAmount);
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "fuel-entries.price");
  }
}
