/** PATCH /api/obligation-types/:id — naziv, pragovi, obavezan prilog, deaktivacija. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { isServiceError, updateObligationType, type ObligationTypeInput } from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const input = (await request.json().catch(() => null)) as ObligationTypeInput | null;
    if (!input) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    const { id } = await context.params;
    const result = await updateObligationType(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ type: result });
  } catch (error) {
    return internal(error, "obligation-types.update");
  }
}
