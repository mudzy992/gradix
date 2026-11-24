/** PATCH/DELETE /api/company/holidays/:id — izmjena i brisanje praznika. */
import type { NextRequest } from "next/server";
import { CompanyHolidayInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { deleteHoliday, updateHoliday } from "@/server/company-service";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await guard(request, "company.holidays.manage");
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const parsed = CompanyHolidayInput.partial().safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Neispravan unos.");
    }
    const result = await updateHoliday(
      await getVerifiedPool(),
      {
        userId: auth.ctx.userId,
        companyId: auth.ctx.companyId,
        actorEmail: null,
        roles: auth.ctx.roles,
        ip: clientIp(request),
      },
      id,
      parsed.data,
    );
    if ("code" in result) return fail(result.code, result.message);
    return ok({ holiday: result.holiday });
  } catch (error) {
    return internal(error, "company.holidays.patch");
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await guard(request, "company.holidays.manage");
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const result = await deleteHoliday(
      await getVerifiedPool(),
      {
        userId: auth.ctx.userId,
        companyId: auth.ctx.companyId,
        actorEmail: null,
        roles: auth.ctx.roles,
        ip: clientIp(request),
      },
      id,
    );
    return ok(result);
  } catch (error) {
    return internal(error, "company.holidays.delete");
  }
}
