/** POST /api/pay-periods/{id}/approve — Odobrenje obračuna (uz SELF_APPROVAL_FORBIDDEN). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { approvePeriod } from "@/server/payroll-period-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.approve");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const result = await approvePeriod(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    if ("code" in result) {
      return fail(result.code as never, result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "pay-periods.approve");
  }
}
