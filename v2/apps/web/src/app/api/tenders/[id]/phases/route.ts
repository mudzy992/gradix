/** POST /api/tenders/:id/phases — faza tendera (F7, §1.6/22.3) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { addTenderPhase } from "@/server/tender-team-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { code?: string; name?: string; weight?: number; plannedStart?: string | null; plannedEnd?: string | null }
      | null;
    if (!body?.code || !body.name) return fail("VALIDATION_FAILED", "Oznaka i naziv faze su obavezni.");
    const result = await addTenderPhase(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      {
        code: body.code,
        name: body.name,
        weight: body.weight ?? 1,
        plannedStart: body.plannedStart ?? null,
        plannedEnd: body.plannedEnd ?? null,
      },
    );
    if (result.outcome !== "OK") return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "tenders.phases.add");
  }
}
