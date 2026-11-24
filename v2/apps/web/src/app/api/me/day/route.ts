/**
 * GET /api/me/day — ekran „Moj dan“: današnji dan, zaboravljen dan koji traži odgovor i dodjele.
 *
 * `forgotten` je OBAVEZAN dio odgovora, ne dodatak: bez njega telefon ne zna da pita radnika
 * „šta je bilo sa jučerašnjim danom“, pa bi dan zauvijek ostao otvoren.
 */
import type { NextRequest } from "next/server";
import { internal, ok, fail } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { myDay } from "@/server/workday-my-day";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request);
    if (!guardResult.ok) return guardResult.response;

    const result = await myDay(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles,
    });
    if (!result.ok) return fail(result.code as never, result.message);
    return ok(result.day);
  } catch (error) {
    return internal(error, "me.day");
  }
}
