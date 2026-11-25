/** GET /api/hse/incidents/{id} — detalj incidenta: dopune, istraga, mjere, prilozi (§1.3). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { getIncident } from "@/server/hse-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const detail = await getIncident(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, id);
    if (!detail) return fail("NOT_FOUND", "Incident ne postoji.");
    return ok(detail);
  } catch (error) {
    return internal(error, "hse.incidents.get");
  }
}
