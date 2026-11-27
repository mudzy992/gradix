/** GET/POST /api/tenders/:id/resources — resursi kalkulacije (F7, §1.3/11) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { tenderActor } from "../../route-actor";
import { failFromOutcome } from "../../route-helpers";
import { createTenderResource, listTenderResources } from "@/server/tender-pricing";
import type { TenderResourceInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const resources = await listTenderResources(await getVerifiedPool(), tenderActor(guardResult.ctx), id);
    if (!Array.isArray(resources)) return fail(resources.code, resources.message);
    return ok({ resources });
  } catch (error) {
    return internal(error, "tenders.resources.list");
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.price.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as TenderResourceInput | null;
    if (!body?.kind || !body.description || !body.quantity || !body.unitCostAmount) {
      return fail("VALIDATION_FAILED", "Vrsta, opis, količina i cijena resursa su obavezni.");
    }
    const outcome = await createTenderResource(
      await getVerifiedPool(),
      tenderActor(guardResult.ctx),
      id,
      body,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.resources.create");
  }
}
