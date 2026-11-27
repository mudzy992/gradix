/** POST /api/tenders/:id/price-revisions/:revision/approve (F7, §1.3/13) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../../../route-actor";
import { failFromOutcome } from "../../../../route-helpers";
import { approveTenderPriceRevision } from "@/server/tender-pricing";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; revision: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.approve");
    if (!guardResult.ok) return guardResult.response;
    const { id, revision } = await context.params;
    const parsed = Number(revision);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      return fail("VALIDATION_FAILED", "Broj revizije nije ispravan.");
    }
    const outcome = await approveTenderPriceRevision(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      parsed,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.price_revisions.approve");
  }
}
