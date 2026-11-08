/**
 * GET    /api/obligations/:id — obaveza sa svim verzijama.
 * PATCH  /api/obligations/:id — veza, tip i odgovorni (bez roka; rok menjaju renew/correct).
 * DELETE /api/obligations/:id — brisanje POGREŠNOG unosa, samo u prvih 24 h i bez obaveza-verzija.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import {
  deleteObligation,
  getObligation,
  isServiceError,
  updateObligation,
  type ObligationInput,
} from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const ctx = guardResult.ctx;
    /*
     * Detalj poštuje ISTI opseg kao lista. Bez ovoga bi radnik mogao otvoriti tuđi rok ako zna
     * `id` — a to je jedina razlika između „ne vidi u listi" i „ne smije vidjeti".
     */
    const result = await getObligation(
      await getVerifiedPool(),
      ctx.companyId,
      id,
      {
        scope: ctx.scope === "SELF" ? "SELF" : "COMPANY",
        userId: ctx.userId,
        includeAttachments: can(ctx.roles, "obligations.attachments.view"),
      },
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.get");
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const input = (await request.json().catch(() => null)) as ObligationInput | null;
    if (!input) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    const { id } = await context.params;
    const result = await updateObligation(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.update");
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const result = await deleteObligation(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ deleted: true });
  } catch (error) {
    return internal(error, "obligations.delete");
  }
}
