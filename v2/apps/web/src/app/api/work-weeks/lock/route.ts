/** POST /api/work-weeks/lock — zaključaj odobrenu sedmicu (`workdays.lock`). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { lockWeek } from "@/server/workday-week-actions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.lock");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as { weekStart?: string } | null;
    if (!body?.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
      return fail("VALIDATION_FAILED", "weekStart (YYYY-MM-DD) je obavezan.");
    }
    const result = await lockWeek(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, body.weekStart);
    if (result.outcome === "NOT_FOUND") return fail("NOT_FOUND", "Sedmica nije pronađena.");
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo zaključati.");
    return ok(result);
  } catch (error) {
    return internal(error, "work-weeks.lock");
  }
}
