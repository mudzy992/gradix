/**
 * PATCH  /api/obligation-requirements/:id — izmjena (najčešće `isActive: false`).
 * DELETE /api/obligation-requirements/:id — brisanje pogrešno unesenog pravila.
 *
 * Deaktivacija je normalan put: pravilo koje je važilo ostaje u bazi da se zna šta je bilo
 * obavezno. Brisanje je za grešku u unosu.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import {
  deleteRequirement,
  updateRequirement,
  type RequirementInput,
  requirementErrorCode,
} from "@/server/obligation-requirement-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const body = (await request.json().catch(() => null)) as Partial<RequirementInput> | null;
    if (!body) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    const { id } = await context.params;
    const result = await updateRequirement(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      id,
      body,
      guardResult.ctx,
    );
    if (!result.ok) return fail(requirementErrorCode(result.code), result.message);
    return ok({ requirement: result.requirement });
  } catch (error) {
    return internal(error, "obligation-requirements.update");
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const result = await deleteRequirement(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      id,
      guardResult.ctx,
    );
    if (!result.ok) return fail(requirementErrorCode(result.code), result.message);
    return ok({ deleted: true });
  } catch (error) {
    return internal(error, "obligation-requirements.delete");
  }
}
