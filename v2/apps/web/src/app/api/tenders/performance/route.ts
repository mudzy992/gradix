/** GET /api/tenders/performance?from&to&partnerId — uspješnost tendera (F7, §1.5/21) */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../route-actor";
import { failFromOutcome } from "../route-helpers";
import { tenderPerformance } from "@/server/tender-outcome-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const outcome = await tenderPerformance(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      {
        from: params.get("from"),
        to: params.get("to"),
        partnerId: params.get("partnerId"),
      },
    );
    if ("outcome" in outcome) return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.performance");
  }
}
