/** GET /api/tenders/:id/calculation — obračun ponude (F7, §1.3/12) */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { failFromOutcome } from "../../route-helpers";
import { calculateTenderOffer } from "@/server/tender-pricing";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const params = request.nextUrl.searchParams;
    const outcome = await calculateTenderOffer(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      {
        markupPct: params.get("markupPct") ?? undefined,
        riskReservePct: params.get("riskReservePct") ?? undefined,
        discountPct: params.get("discountPct") ?? undefined,
      },
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok({ calculation: outcome.calculation });
  } catch (error) {
    return internal(error, "tenders.calculation");
  }
}
