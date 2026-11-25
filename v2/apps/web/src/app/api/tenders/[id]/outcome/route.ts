/** GET/PUT /api/tenders/:id/outcome — ishod tendera (F7, §1.5) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { failFromOutcome } from "../../route-helpers";
import { getTenderOutcome, putTenderOutcome } from "@/server/tender-outcome-service";
import type { TenderOutcomeInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const result = await getTenderOutcome(await getVerifiedPool(), tenderActor(guardResult.ctx), id);
    if (!result.ok) return failFromOutcome(result);
    return ok({ outcome: result.outcome });
  } catch (error) {
    return internal(error, "tenders.outcome.get");
  }
}

export async function PUT(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.outcome.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderOutcomeInput | null;
    if (!body?.result) return fail("VALIDATION_FAILED", "Rezultat ishoda je obavezan.");
    const outcome = await putTenderOutcome(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      body,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.outcome.put");
  }
}
