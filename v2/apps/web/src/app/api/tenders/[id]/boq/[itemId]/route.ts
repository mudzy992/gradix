/** PATCH/DELETE /api/tenders/:id/boq/:itemId — izmjena stavke predmjera (F7) */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../../route-actor";
import { failFromOutcome } from "../../../route-helpers";
import { deleteTenderBoqItem, updateTenderBoqItem } from "@/server/tender-pricing";
import type { TenderBoqInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id, itemId } = await context.params;
    const body = (await request.json().catch(() => null)) as Partial<TenderBoqInput> | null;
    const outcome = await updateTenderBoqItem(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      itemId,
      body ?? {},
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.boq.update");
  }
}

export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id, itemId } = await context.params;
    const outcome = await deleteTenderBoqItem(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      itemId,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok({ outcome: "OK" });
  } catch (error) {
    return internal(error, "tenders.boq.delete");
  }
}
