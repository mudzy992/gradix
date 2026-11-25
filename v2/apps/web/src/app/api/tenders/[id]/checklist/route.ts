/** GET /api/tenders/:id/checklist — kontrolna lista i garancije (F7, §1.4) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { listTenderChecklist } from "@/server/tender-checklist-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const result = await listTenderChecklist(await getVerifiedPool(), tenderActor(guardResult.ctx), id);
    if ("outcome" in result) return fail(result.outcome === "FORBIDDEN" ? "FORBIDDEN" : "NOT_FOUND", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "tenders.checklist.list");
  }
}
