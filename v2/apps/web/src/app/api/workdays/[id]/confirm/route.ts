/** POST /api/workdays/:id/confirm — šef potvrđuje dan (`workdays.confirm`). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { confirmWorkday } from "@/server/workday-approval";
import type { Role } from "@/server/permissions";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.confirm");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const result = await confirmWorkday(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, id);
    if (result.outcome === "NOT_FOUND") return fail("NOT_FOUND", "Radni dan nije pronađen.");
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo potvrditi ovaj dan.");
    if (result.outcome === "VALIDATION_FAILED" || result.outcome === "CONFLICT") {
      return ok(result);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "workdays.confirm");
  }
}
