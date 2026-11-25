/** POST /api/tenders/:id/guarantees/:itemId/return — povrat garancije (F7) */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../../../route-actor";
import { failFromOutcome } from "../../../../route-helpers";
import { returnTenderGuarantee } from "@/server/tender-checklist-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id, itemId } = await context.params;
    const outcome = await returnTenderGuarantee(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      itemId,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.guarantees.return");
  }
}
