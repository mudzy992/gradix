/** POST /api/machine-daily-checks/{id}/photo — potvrda fotografije kritičnog nalaza. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { confirmDailyCheckPhoto } from "@/server/machine-utilization-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.create");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const result = await confirmDailyCheckPhoto(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "machine-daily-checks.photo");
  }
}
