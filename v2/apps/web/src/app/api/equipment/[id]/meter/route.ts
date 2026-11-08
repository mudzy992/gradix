/**
 * PATCH /api/equipment/:id/meter — trenutna vrijednost brojila.
 *
 * Dozvola je `equipment.view` (rukovalac upisuje novo stanje), a **ispravka** manje vrijednosti
 * traži `equipment.manage`: onaj ko je pogriješio ne prepisuje sam sebi historiju bez traga.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { isServiceError, setMeterValue } from "@/server/equipment-service";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.view");
    if (!guardResult.ok) return guardResult.response;

    const body = (await request.json().catch(() => null)) as { value?: unknown; correct?: unknown } | null;
    if (!body || typeof body.value !== "number") return fail("VALIDATION_FAILED", "Polje `value` je obavezno.");

    const correct = body.correct === true;
    if (correct && !can(guardResult.ctx.roles, "equipment.manage")) {
      return fail("FORBIDDEN", "Ispravku brojila može potvrditi samo ured.");
    }

    const { id } = await context.params;
    const result = await setMeterValue(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      body.value,
      { correct },
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ machine: result });
  } catch (error) {
    return internal(error, "equipment.meter");
  }
}
