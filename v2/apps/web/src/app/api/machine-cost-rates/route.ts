/** GET/POST /api/machine-cost-rates — R6.1 stope troška mašine. */
import type { NextRequest } from "next/server";
import { MachineCostRateUpsertInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  listMachineCostRates,
  upsertMachineCostRate,
} from "@/server/machine-cost-rate-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.cost_rate.view");
    if (!guardResult.ok) return guardResult.response;
    const machineId = request.nextUrl.searchParams.get("machineId") ?? undefined;
    const rates = await listMachineCostRates(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      machineId,
    );
    return ok({ rates });
  } catch (error) {
    return internal(error, "machine-cost-rates.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.cost_rate.manage");
    if (!guardResult.ok) return guardResult.response;
    const raw = await request.json().catch(() => null);
    const parsed = MachineCostRateUpsertInput.safeParse(raw);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Neispravan unos stope.");
    }
    const result = await upsertMachineCostRate(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    }
    if (result.outcome === "VALIDATION_FAILED") {
      return fail("VALIDATION_FAILED", result.message ?? "Neispravan unos.");
    }
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message ?? "Konflikt.");
    return ok(result);
  } catch (error) {
    return internal(error, "machine-cost-rates.upsert");
  }
}
