/** POST /api/site-diaries/{id}/revise — ispravka zaključanog dnevnika kroz reviziju (§1.1/5). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { reviseDiary, type PatchDiaryInput } from "@/server/diary-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.sign");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as (PatchDiaryInput & { reason?: string }) | null;
    if (!body?.reason) {
      return fail("DIARY_REASON_REQUIRED", "Revizija traži razlog (bar 10 znakova).");
    }
    const outcome = await reviseDiary(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      body as PatchDiaryInput & { reason: string },
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "site-diaries.revise");
  }
}
