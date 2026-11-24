/** GET /api/calendar/availability?from&to — zauzetost svih aktivnih mašina (kalendar). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { companyAvailability } from "@/server/machine-availability-service";

export const dynamic = "force-dynamic";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.view");
    if (!guardResult.ok) return guardResult.response;
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to) || to < from) {
      return fail("VALIDATION_FAILED", "from i to su obavezni datumi (GGGG-MM-DD), to ≥ from.");
    }
    const machines = await companyAvailability(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      from,
      to,
    );
    return ok({ machines, from, to });
  } catch (error) {
    return internal(error, "calendar-availability.list");
  }
}
