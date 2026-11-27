/** GET /api/dashboard/risky-projects — top 5 rizičnih projekata + broj PENDING troškova. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listRiskyProjects } from "@/server/pregled-risky";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "dashboard.view");
    if (!guardResult.ok) return guardResult.response;
    const result = await listRiskyProjects(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    });
    if ("code" in result) return fail("FORBIDDEN", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "dashboard.risky-projects");
  }
}
