/** POST /api/tenders/:id/guarantees — nova bankarska garancija (F7, §1.4/18) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { failFromOutcome } from "../../route-helpers";
import { createTenderGuarantee } from "@/server/tender-checklist-service";
import type { TenderGuaranteeInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderGuaranteeInput | null;
    if (!body?.code || !body.label || !body.guaranteeType || !body.validUntil) {
      return fail("VALIDATION_FAILED", "Oznaka, naziv, vrsta i rok važenja garancije su obavezni.");
    }
    const outcome = await createTenderGuarantee(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      body,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.guarantees.create");
  }
}
