/** GET /api/pay-periods (+?year) — periodi obračuna; POST — otvaranje mjeseca. */
import type { NextRequest } from "next/server";
import { PayPeriodInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createPeriod, listPeriods } from "@/server/payroll-period-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.view");
    if (!guardResult.ok) return guardResult.response;
    const yearRaw = request.nextUrl.searchParams.get("year");
    const year = yearRaw === null ? undefined : Number(yearRaw);
    if (year !== undefined && !Number.isInteger(year)) {
      return fail("VALIDATION_FAILED", "Godina mora biti cijeli broj.");
    }
    const result = await listPeriods(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      { year },
    );
    if ("code" in result) return fail(result.code as never, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "pay-periods.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = PayPeriodInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan mjesec perioda.");
    const result = await createPeriod(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if ("code" in result) return fail(result.code as never, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "pay-periods.create");
  }
}
