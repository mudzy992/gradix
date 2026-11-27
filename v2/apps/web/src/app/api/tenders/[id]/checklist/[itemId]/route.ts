/** PATCH /api/tenders/:id/checklist/:itemId (F7, §1.4/15) */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../../route-actor";
import { failFromOutcome } from "../../../route-helpers";
import { patchTenderChecklistItem } from "@/server/tender-checklist-service";
import type { TenderChecklistPatchInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id, itemId } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderChecklistPatchInput | null;
    const outcome = await patchTenderChecklistItem(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      itemId,
      body ?? {},
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.checklist.patch");
  }
}
