/** GET/POST /api/machines/{id}/maintenance-plans — F8 planovi preventivnog održavanja. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listMaintenancePlans, saveMaintenancePlan, type MaintenancePlanInput } from "@/server/maintenance-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const plans = await listMaintenancePlans(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, id);
    return ok({ plans });
  } catch (error) {
    return internal(error, "machines.maintenance-plans.list");
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as MaintenancePlanInput | null;
    if (!body) return fail("VALIDATION_FAILED", "Tijelo zahtjeva nije validno.");
    const outcome = await saveMaintenancePlan(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      null,
      body,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo.");
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", "Mašina ili šablon ne postoji.");
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "machines.maintenance-plans.create");
  }
}
