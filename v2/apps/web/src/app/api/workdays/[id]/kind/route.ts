/** PATCH /api/workdays/:id/kind — vrsta dana (izostanak, godišnji, praznik). */
import type { NextRequest } from "next/server";
import { WorkdayKindInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { setDayKind } from "@/server/workday-timer-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.kind");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkdayKindInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id } = await context.params;
    const result = await setDayKind(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      id,
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ day: result.day, blockers: result.blockers });
  } catch (error) {
    return internal(error, "workdays.kind");
  }
}
