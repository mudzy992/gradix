/** GET/PATCH /api/tenders/:id — R7 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { getTender, patchTender } from "@/server/tender-service";
import type { TenderPatchInput } from "@gradix/contracts";
import { failFromOutcome } from "../route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const tender = await getTender(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    if (!tender) return fail("NOT_FOUND", "Tender nije pronađen.");
    return ok(tender);
  } catch (error) {
    return internal(error, "tenders.get");
  }
}

export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderPatchInput | null;
    if (!body || typeof body !== "object") {
      return fail("VALIDATION_FAILED", "Tijelo zahtjeva nije validno.");
    }
    const outcome = await patchTender(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      body,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.patch");
  }
}
