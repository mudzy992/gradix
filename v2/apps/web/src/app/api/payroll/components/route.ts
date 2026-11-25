/** GET/POST /api/payroll/components — šifarnik komponenti obračuna. */
import type { NextRequest } from "next/server";
import { PayrollComponentInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { isPayrollError, listComponents, saveComponent } from "@/server/payroll-period-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.view");
    if (!guardResult.ok) return guardResult.response;
    const result = await listComponents(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    });
    if (isPayrollError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "payroll.components.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = PayrollComponentInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravna komponenta obračuna.");
    const result = await saveComponent(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (isPayrollError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "payroll.components.create");
  }
}
