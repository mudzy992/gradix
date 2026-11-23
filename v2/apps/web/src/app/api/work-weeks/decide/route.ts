/** POST /api/work-weeks/decide — odobri/odbij sedmicu (`workdays.week_decide`). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { decideWeek } from "@/server/workday-week-actions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.week_decide");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as {
      weekStart?: string;
      decision?: string;
      reason?: string;
    } | null;
    if (!body?.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
      return fail("VALIDATION_FAILED", "weekStart (YYYY-MM-DD) je obavezan.");
    }
    if (body.decision !== "APPROVE" && body.decision !== "REJECT") {
      return fail("VALIDATION_FAILED", "decision mora biti APPROVE ili REJECT.");
    }
    const result = await decideWeek(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, {
      weekStart: body.weekStart,
      decision: body.decision,
      reason: body.reason,
    });
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo odlučivati o sedmici.");
    return ok(result);
  } catch (error) {
    return internal(error, "work-weeks.decide");
  }
}
