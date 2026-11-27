/** POST /api/hse/actions/create — nova korektivna mjera (incident ILI inspekcija, §1.3/15). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createAction, type ActionInput } from "@/server/hse-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.investigate");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as ActionInput | null;
    if (!body?.description) {
      return fail("VALIDATION_FAILED", "Opis mjere je obavezan.");
    }
    /* Red je namjeran: odgovorni pa rok. Poruka uvijek imenuje ono što PRVO nedostaje, pa
       čovjek ne popunjava polje koje ne rješava grešku. */
    if (!body.responsibleWorkerId) {
      return fail("HSE_ACTION_RESPONSIBLE_REQUIRED", "Mjera traži odgovornu osobu.");
    }
    if (!body.dueOn) {
      return fail("HSE_ACTION_DUE_REQUIRED", "Mjera traži rok (datum).");
    }
    const outcome = await createAction(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
      },
      body,
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") {
      const code = outcome.code === "HSE_ACTION_RESPONSIBLE_REQUIRED" || outcome.code === "HSE_ACTION_DUE_REQUIRED"
        ? outcome.code
        : "VALIDATION_FAILED";
      return fail(code, outcome.message);
    }
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "hse.actions.create");
  }
}
