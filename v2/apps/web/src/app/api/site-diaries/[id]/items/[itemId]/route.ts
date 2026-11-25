/** DELETE /api/site-diaries/{id}/items/{itemId} — brisanje stavke u nacrtu (§1.2/10). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { deleteDiaryItem } from "@/server/diary-service";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id, itemId } = await context.params;
    const outcome = await deleteDiaryItem(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      itemId,
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "site-diaries.item.delete");
  }
}
