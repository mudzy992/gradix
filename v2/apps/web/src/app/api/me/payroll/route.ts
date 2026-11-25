/**
 * GET /api/me/payroll?year=&month= — vlastiti obračun (`payroll.own.view`).
 *
 * Radnik se veže preko `workers.user_id`; tuđi ID se ne prima — ni kad ga neko pošalje, jer
 * ruta nema parametar za radnika.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { getMyPayroll } from "@/server/payroll-period-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.own.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const now = new Date();
    const year = Number(params.get("year") ?? now.getUTCFullYear());
    const month = Number(params.get("month") ?? now.getUTCMonth() + 1);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return fail("VALIDATION_FAILED", "Mjesec mora biti između 1 i 12.");
    }
    const result = await getMyPayroll(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      { year, month },
    );
    if ("code" in result) return fail(result.code as never, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "me.payroll");
  }
}
