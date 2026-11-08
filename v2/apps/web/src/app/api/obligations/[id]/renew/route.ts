/**
 * POST /api/obligations/:id/renew — obnova je NOVA VERZIJA, stara ostaje.
 *
 * Novi rok mora biti poslije starog: „obnova“ sa istim datumom nije obnova nego ispravka, a
 * ispravka ima svoj put (`/correct`) i svoje pravilo od 24 h.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { isServiceError, renewObligation, type ObligationRenewInput } from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const input = (await request.json().catch(() => null)) as ObligationRenewInput | null;
    if (!input) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    const { id } = await context.params;
    const result = await renewObligation(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.renew");
  }
}
