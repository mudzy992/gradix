/** GET/POST /api/tenders/:id/team — predloženi tim tendera (F7) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { addTenderTeamMember, listTenderTeam } from "@/server/tender-team-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const result = await listTenderTeam(await getVerifiedPool(), tenderActor(guardResult.ctx), id);
    if ("code" in result) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "tenders.team.list");
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { workerId?: string; role?: string } | null;
    if (!body?.workerId) return fail("VALIDATION_FAILED", "Radnik je obavezan.");
    const result = await addTenderTeamMember(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      {
        workerId: body.workerId,
        role: (body.role as "PM" | "SUPERVISOR" | "MEMBER") ?? "MEMBER",
      },
    );
    if (result.outcome !== "OK") return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "tenders.team.add");
  }
}
