/**
 * POST /api/obligations/:id/correct — ispravka greške u unosu, samo u prvih 24 h.
 * Poslije toga greška se ispravlja obnovom (nova verzija), da historija ne bude šum.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { ObligationCorrectInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { correctObligation, isServiceError } from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = ObligationCorrectInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const { id } = await context.params;
    const result = await correctObligation(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      { ...input, expiresAt: input.expiresAt ?? "" },
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.correct");
  }
}
