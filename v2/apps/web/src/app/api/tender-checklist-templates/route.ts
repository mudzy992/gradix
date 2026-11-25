/** GET/POST /api/tender-checklist-templates — šifarnik kontrolne liste (F7, §1.4/15) */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listChecklistTemplates, upsertChecklistTemplate } from "@/server/tender-checklist-service";
import { failFromOutcome } from "../tenders/route-helpers";
import type { TenderChecklistTemplateInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

function actorOf(ctx: { userId: string; companyId: string; roles: string[] }) {
  return { userId: ctx.userId, companyId: ctx.companyId, roles: ctx.roles as Role[] };
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const templates = await listChecklistTemplates(
      await getVerifiedPool(),
      actorOf(guardResult.ctx),
    );
    if (!Array.isArray(templates)) return failFromOutcome(templates);
    return ok({ templates });
  } catch (error) {
    return internal(error, "tender_checklist_templates.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as TenderChecklistTemplateInput | null;
    if (!body?.code || !body.label) {
      return fail("VALIDATION_FAILED", "Oznaka i naziv stavke su obavezni.");
    }
    const outcome = await upsertChecklistTemplate(
      await getVerifiedPool(),
      actorOf(guardResult.ctx),
      body,
    );
    if (outcome.outcome !== "OK") return failFromOutcome(outcome);
    return ok(outcome);
  } catch (error) {
    return internal(error, "tender_checklist_templates.upsert");
  }
}
