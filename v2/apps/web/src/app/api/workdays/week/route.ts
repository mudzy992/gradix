/** GET /api/workdays/week — sedmični pregled radnik × dan (`workdays.view`). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { weekView } from "@/server/workday-timer-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.view");
    if (!guardResult.ok) return guardResult.response;

    const url = new URL(request.url);
    const weekStart = url.searchParams.get("weekStart");
    if (!weekStart) return fail("VALIDATION_FAILED", "Nedostaje parametar „weekStart“.");
    const workerIds = url.searchParams.getAll("workerId");

    const result = await weekView(
      await getVerifiedPool(),
      guardResult.ctx,
      weekStart,
      { workerIds: workerIds.length > 0 ? workerIds : null },
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok(result.week);
  } catch (error) {
    return internal(error, "workdays.week");
  }
}
