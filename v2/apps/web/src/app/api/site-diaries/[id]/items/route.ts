/** POST /api/site-diaries/{id}/items — količina izvedenih radova (§1.2). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { addDiaryItem } from "@/server/diary-service";

export const dynamic = "force-dynamic";

type ItemBody = {
  boqItemId?: string | null;
  description: string;
  unit: string;
  quantity: string;
  source?: "MANUAL" | "HAUL" | "BOQ";
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as ItemBody | null;
    if (!body?.description || !body.unit || !body.quantity) {
      return fail("VALIDATION_FAILED", "Opis, jedinica i količina su obavezni.");
    }
    const outcome = await addDiaryItem(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
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
    return internal(error, "site-diaries.item.add");
  }
}
