/**
 * PATCH /api/fuel-entries/{id}/explain — objašnjenje odstupanja goriva.
 *
 * Kod `FUEL_DEVIATION_EXPLANATION_REQUIRED` (422) je namjerno zaseban: klijent tada traži
 * razlog, a ne popravku unosa. Točenje je i bez objašnjenja prošlo — zatvara se samo upozorenje.
 */
import type { NextRequest } from "next/server";
import { FuelDeviationExplainInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { explainFuelDeviation } from "@/server/fuel-price-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fuel.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const parsed = FuelDeviationExplainInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail(
        "FUEL_DEVIATION_EXPLANATION_REQUIRED",
        "Objašnjenje traži status, razlog i napomenu od najmanje 10 znakova.",
      );
    }
    const result = await explainFuelDeviation(
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
    if (result.outcome === "VALIDATION_FAILED") {
      return fail(
        result.code === "NOTE" ? "FUEL_DEVIATION_EXPLANATION_REQUIRED" : "VALIDATION_FAILED",
        result.message,
      );
    }
    return ok(result.data);
  } catch (error) {
    return internal(error, "fuel-deviations.explain");
  }
}
