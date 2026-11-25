/** POST /api/tenders/:id/decision — odluka o učešću (F7, spec 08 §1.1/3) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { failFromOutcome } from "../../route-helpers";
import { decideTenderParticipation } from "@/server/tender-service";
import type { TenderDecisionInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderDecisionInput | null;
    if (!body || typeof body.participate !== "boolean") {
      return fail("VALIDATION_FAILED", "Odluka (DA/NE) i razlog su obavezni.");
    }
    const outcome = await decideTenderParticipation(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      { participate: body.participate, reason: body.reason ?? "" },
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.decision");
  }
}
