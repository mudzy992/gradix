/** POST /api/tenders/:id/convert — R7.5 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { convertTenderToProject } from "@/server/tender-convert";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.convert");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const outcome = await convertTenderToProject(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      id,
    );
    if (outcome.outcome !== "OK") {
      return fail(outcome.outcome, outcome.message ?? "Zahtjev nije uspio.");
    }
    return ok({ outcome: "OK", projectId: outcome.projectId });
  } catch (error) {
    return internal(error, "tenders.convert");
  }
}
