/** PATCH /api/fuel-tanks/{id}/count — popis cisterne (očitano stanje + razlika u audit). */
import type { NextRequest } from "next/server";
import { FuelTankCountInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { countFuelTank } from "@/server/fuel-price-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fuel.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const parsed = FuelTankCountInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan popis cisterne.");
    const result = await countFuelTank(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result.data);
  } catch (error) {
    return internal(error, "fuel-tanks.count");
  }
}
