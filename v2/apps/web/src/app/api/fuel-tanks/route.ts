/** GET/POST /api/fuel-tanks — cisterne (opciono po firmi). */
import type { NextRequest } from "next/server";
import { FuelTankInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createFuelTank, listFuelTanks } from "@/server/fuel-price-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fuel.view");
    if (!guardResult.ok) return guardResult.response;
    const tanks = await listFuelTanks(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    });
    return ok({ tanks });
  } catch (error) {
    return internal(error, "fuel-tanks.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fuel.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = FuelTankInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos cisterne.");
    const result = await createFuelTank(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result.data);
  } catch (error) {
    return internal(error, "fuel-tanks.create");
  }
}
