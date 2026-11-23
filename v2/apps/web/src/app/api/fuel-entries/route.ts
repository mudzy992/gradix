/** GET/POST /api/fuel-entries — R5.2 ured lista i unos goriva. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listFuelEntries, createFuelEntry, type CreateInput } from "@/server/fuel-entry-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fuel.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const rows = await listFuelEntries(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, {
      machineId: params.get("machineId") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    return ok({ entries: rows });
  } catch (error) {
    return internal(error, "fuel-entries.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fuel.create");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as CreateInput | null;
    if (!body?.machineId || !body.filledAt || body.liters == null) {
      return fail("VALIDATION_FAILED", "machineId, filledAt i liters su obavezni.");
    }
    const result = await createFuelEntry(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, body);
    if (result.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", result.message ?? "Nemate pravo unosa.");
    }
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "fuel-entries.create");
  }
}