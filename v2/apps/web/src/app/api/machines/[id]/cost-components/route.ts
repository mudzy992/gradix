/**
 * GET   /api/machines/{id}/cost-components — komponente stope (machines.cost_rate.view).
 * POST  /api/machines/{id}/cost-components — nova komponenta (machines.cost_rate.manage).
 * PATCH /api/machines/{id}/cost-components — zatvaranje komponente na datum.
 *
 * `machineId` iz putanje ima prednost nad tijelom: klijent ne može poslati komponentu na jednu
 * mašinu a upisati je na drugu — to bi bila tiša izmjena tuđeg obračuna.
 */
import type { NextRequest } from "next/server";
import { MachineCostComponentInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  closeCostComponent,
  createCostComponent,
  listCostComponents,
} from "@/server/machine-cost-component-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.cost_rate.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const components = await listCostComponents(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    return ok({ components });
  } catch (error) {
    return internal(error, "machine-cost-components.list");
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.cost_rate.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const parsed = MachineCostComponentInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos komponente stope.");
    const result = await createCostComponent(
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
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "machine-cost-components.create");
  }
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.cost_rate.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const parsed = MachineCostComponentInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos komponente stope.");
    const result = await closeCostComponent(
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
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "machine-cost-components.close");
  }
}
