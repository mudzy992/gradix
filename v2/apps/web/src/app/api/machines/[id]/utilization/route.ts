/** GET /api/machines/{id}/utilization?from&to — obje kolone iskorištenosti + MTBF/MTTR. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { machineUtilization } from "@/server/machine-utilization-service";

export const dynamic = "force-dynamic";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    // Datumi su obavezni: bez perioda bi „iskorištenost" bila brojka bez značenja.
    if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to) || to < from) {
      return fail("VALIDATION_FAILED", "from i to su obavezni datumi (GGGG-MM-DD), to ≥ from.");
    }
    const view = await machineUtilization(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      from,
      to,
    );
    if (!view) return fail("NOT_FOUND", "Mašina nije pronađena.");
    return ok(view);
  } catch (error) {
    return internal(error, "machine-utilization.get");
  }
}
