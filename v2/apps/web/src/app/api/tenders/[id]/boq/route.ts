/** GET/POST /api/tenders/:id/boq — predmjer tendera (F7, spec 08 §1.3/10) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { failFromOutcome } from "../../route-helpers";
import { createTenderBoqItem, listTenderBoq } from "@/server/tender-pricing";
import type { TenderBoqInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const items = await listTenderBoq(await getVerifiedPool(), tenderActor(guardResult.ctx), id);
    if (!Array.isArray(items)) return fail(items.code, items.message);
    return ok({ items });
  } catch (error) {
    return internal(error, "tenders.boq.list");
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderBoqInput | null;
    if (!body?.code || !body.description || !body.unit || !body.quantity || !body.unitCostAmount) {
      return fail("VALIDATION_FAILED", "Oznaka, opis, jedinica, količina i trošak su obavezni.");
    }
    const outcome = await createTenderBoqItem(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      body,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.boq.create");
  }
}
