/** GET/POST /api/hauls — R5.3 ured lista i unos tura. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listHauls, createHaul, type CreateInput } from "@/server/haul-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.haul.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const rows = await listHauls(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
      scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    }, {
      machineId: params.get("machineId") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    return ok({ hauls: rows });
  } catch (error) {
    return internal(error, "hauls.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.haul.create");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as CreateInput | null;
    if (!body?.machineId || !body.hauledAt || body.quantity == null || !body.quantityUnit
      || !body.originText || !body.destinationText || !body.materialText) {
      return fail(
        "VALIDATION_FAILED",
        "machineId, hauledAt, quantity, quantityUnit, originText, destinationText i materialText su obavezni.",
      );
    }
    const result = await createHaul(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
      scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    }, body);
    if (result.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", result.message ?? "Nemate pravo unosa.");
    }
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "hauls.create");
  }
}
