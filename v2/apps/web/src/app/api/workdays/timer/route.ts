/**
 * POST /api/workdays/timer — jedna velika akcija „Moj dan“ (spec 03 §1.1).
 *
 * Bez dozvole u `guard`: radnik uvijek smije prijaviti SVOJ dan, a čiji je dan ne dolazi iz
 * zahtjeva nego iz veze `workers.user_id`, pa nema šta da se zloupotrijebi.
 */
import type { NextRequest } from "next/server";
import { WorkdayTimerInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { applyTimer } from "@/server/workday-timer-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request);
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkdayTimerInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const result = await applyTimer(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ day: result.day, blockers: result.blockers });
  } catch (error) {
    return internal(error, "workdays.timer");
  }
}
