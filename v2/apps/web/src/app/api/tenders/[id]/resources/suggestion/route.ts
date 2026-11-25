/** GET /api/tenders/:id/resources/suggestion?kind=&workerId=&machineId= (F7) */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../../route-actor";
import { failFromOutcome } from "../../../route-helpers";
import { suggestResourceCost } from "@/server/tender-pricing";

export const dynamic = "force-dynamic";

const KINDS = ["LABOR", "MACHINE", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const kindParam = request.nextUrl.searchParams.get("kind") ?? "LABOR";
    const kind: Kind = (KINDS as readonly string[]).includes(kindParam) ? (kindParam as Kind) : "OTHER";
    const outcome = await suggestResourceCost(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      {
        kind,
        workerId: request.nextUrl.searchParams.get("workerId") ?? undefined,
        machineId: request.nextUrl.searchParams.get("machineId") ?? undefined,
      },
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok({ outcome: "OK", unitCostAmount: outcome.unitCostAmount });
  } catch (error) {
    return internal(error, "tenders.resources.suggestion");
  }
}
