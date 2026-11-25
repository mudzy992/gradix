/** GET/POST /api/tenders/:id/price-revisions — revizije cijene (F7, §1.3/13) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { failFromOutcome } from "../../route-helpers";
import { createTenderPriceRevision, listTenderPriceRevisions } from "@/server/tender-pricing";
import type { TenderPriceRevisionInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const revisions = await listTenderPriceRevisions(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
    );
    if (!Array.isArray(revisions)) return fail(revisions.code, revisions.message);
    return ok({ revisions });
  } catch (error) {
    return internal(error, "tenders.price_revisions.list");
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderPriceRevisionInput | null;
    if (!body?.markupPct || !body.riskReservePct || !body.discountPct) {
      return fail("VALIDATION_FAILED", "Marža, rezerva i popust su obavezni.");
    }
    const outcome = await createTenderPriceRevision(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      body,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.price_revisions.create");
  }
}
