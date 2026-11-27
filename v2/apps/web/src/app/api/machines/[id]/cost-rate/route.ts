/**
 * GET  /api/machines/{id}/cost-rate — izračunata stopa + razlaganje + ručna stopa.
 * POST /api/machines/{id}/cost-rate — ručna stopa sa razlogom ili „vrati na izračunato".
 *
 * Razlog je obavezan u domeni servisa, ne u ruti: `amount: null` je jedini slučaj bez razloga.
 */
import type { NextRequest } from "next/server";
import { MachineCostRateManualInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { getMachineCostRate, setManualCostRate } from "@/server/machine-cost-component-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.cost_rate.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const rate = await getMachineCostRate(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    if (!rate) return fail("NOT_FOUND", "Mašina nije pronađena.");
    return ok({ rate });
  } catch (error) {
    return internal(error, "machine-cost-rate.get");
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.cost_rate.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const parsed = MachineCostRateManualInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos stope.");
    const result = await setManualCostRate(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      { ...parsed.data, machineId: id },
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") {
      // Razlog koji nedostaje je ZASEBAN kod: ekran tada traži razlog, ne popravku iznosa.
      return fail(
        result.code === "REASON" ? "COST_RATE_MANUAL_OVERRIDE" : "VALIDATION_FAILED",
        result.message,
      );
    }
    const rate = await getMachineCostRate(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    return ok({ rate });
  } catch (error) {
    return internal(error, "machine-cost-rate.set");
  }
}
