/** PATCH/DELETE /api/ppe-templates/:id — izmjena i brisanje šablona OZO. */
import type { NextRequest } from "next/server";
import { PpeTemplateInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { deletePpeTemplate, upsertPpeTemplate } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.issuances.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = PpeTemplateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id } = await context.params;
    const result = await upsertPpeTemplate(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      { ...parsed.data, id },
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ template: result.template });
  } catch (error) {
    return internal(error, "ppeTemplates.patch");
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.issuances.manage");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const result = await deletePpeTemplate(
      await getVerifiedPool(),
      { userId: guardResult.ctx.userId, companyId: guardResult.ctx.companyId, roles: guardResult.ctx.roles },
      id,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ deleted: true });
  } catch (error) {
    return internal(error, "ppeTemplates.delete");
  }
}
