/** POST /api/tenders/:id/copy — kopiranje iz sličnog tendera (F7, §1.3/14) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { failFromOutcome } from "../../route-helpers";
import { copyTenderContent } from "@/server/tender-copy";
import type { TenderCopyInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderCopyInput | null;
    if (!body?.copyFromTenderId) {
      return fail("VALIDATION_FAILED", "Izaberite tender iz kojeg se kopira.");
    }
    const outcome = await copyTenderContent(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      body.copyFromTenderId,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.copy");
  }
}
