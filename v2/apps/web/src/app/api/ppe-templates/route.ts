/** GET/POST /api/ppe-templates — šabloni OZO po radnom mjestu. */
import type { NextRequest } from "next/server";
import { PpeTemplateInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { listPpeTemplates, upsertPpeTemplate } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.issuances.view");
    if (!guardResult.ok) return guardResult.response;

    const result = await listPpeTemplates(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles,
    });
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ templates: result.templates });
  } catch (error) {
    return internal(error, "ppeTemplates.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.issuances.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = PpeTemplateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const result = await upsertPpeTemplate(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ template: result.template });
  } catch (error) {
    return internal(error, "ppeTemplates.upsert");
  }
}
