/** POST /api/site-diaries/{id}/delays — zastoj kao dokaz za produženje roka (§1.1/4). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { addDiaryDelay, type AddDelayInput } from "@/server/diary-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as AddDelayInput | null;
    if (!body?.kind || !body.fromAt || !body.toAt || !body.hours) {
      return fail("VALIDATION_FAILED", "Vrsta, početak, kraj i sati zastoja su obavezni.");
    }
    const outcome = await addDiaryDelay(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      body,
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "site-diaries.delay.add");
  }
}
