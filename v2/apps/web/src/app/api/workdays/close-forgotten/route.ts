/** POST /api/workdays/close-forgotten — radnik odgovara na zaboravljen dan (tri izbora). */
import type { NextRequest } from "next/server";
import { WorkdayCloseForgottenInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { closeForgottenDay } from "@/server/workday-timer-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request);
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkdayCloseForgottenInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const result = await closeForgottenDay(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ day: result.day, blockers: result.blockers });
  } catch (error) {
    return internal(error, "workdays.closeForgotten");
  }
}
