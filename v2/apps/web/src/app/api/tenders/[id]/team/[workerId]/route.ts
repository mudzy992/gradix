/** DELETE /api/tenders/:id/team/:workerId (F7) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../../route-actor";
import { removeTenderTeamMember } from "@/server/tender-team-service";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; workerId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id, workerId } = await context.params;
    const result = await removeTenderTeamMember(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      workerId,
    );
    if (result.outcome !== "OK") return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "tenders.team.remove");
  }
}
