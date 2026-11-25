/** DELETE /api/tenders/:id/resources/:resourceId (F7) */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../../route-actor";
import { failFromOutcome } from "../../../route-helpers";
import { deleteTenderResource } from "@/server/tender-pricing";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; resourceId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id, resourceId } = await context.params;
    const outcome = await deleteTenderResource(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      resourceId,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok({ outcome: "OK" });
  } catch (error) {
    return internal(error, "tenders.resources.delete");
  }
}
