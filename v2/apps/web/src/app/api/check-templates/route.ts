/** GET/POST/PATCH /api/check-templates — šabloni dnevnog pregleda po kategoriji. */
import type { NextRequest } from "next/server";
import { CheckTemplateInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  createCheckTemplate,
  listCheckTemplates,
  updateCheckTemplate,
} from "@/server/check-template-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const templates = await listCheckTemplates(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        categoryId: params.get("categoryId") ?? undefined,
        includeInactive: params.get("includeInactive") === "1",
      },
    );
    return ok({ templates });
  } catch (error) {
    return internal(error, "check-templates.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = CheckTemplateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan šablon pregleda.");
    const result = await createCheckTemplate(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result.data);
  } catch (error) {
    return internal(error, "check-templates.create");
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = CheckTemplateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan šablon pregleda.");
    const result = await updateCheckTemplate(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result.data);
  } catch (error) {
    return internal(error, "check-templates.update");
  }
}
