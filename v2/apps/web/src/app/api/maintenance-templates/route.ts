/** GET/POST /api/maintenance-templates — F8 šabloni preventivnog održavanja. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  listMaintenanceTemplates,
  saveMaintenanceTemplate,
  type MaintenanceTemplateInput,
} from "@/server/maintenance-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.view");
    if (!guardResult.ok) return guardResult.response;
    const templates = await listMaintenanceTemplates(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    });
    return ok({ templates });
  } catch (error) {
    return internal(error, "maintenance-templates.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "service.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as MaintenanceTemplateInput | null;
    if (!body?.code || !body.name || !body.basis || !body.intervalValue) {
      return fail("VALIDATION_FAILED", "code, name, basis i intervalValue su obavezni.");
    }
    const outcome = await saveMaintenanceTemplate(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      null,
      body,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo.");
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", "Ne postoji.");
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "maintenance-templates.create");
  }
}
