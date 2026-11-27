/** PATCH /api/partners/:id — R7.1 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { updatePartner } from "@/server/partner-service";
import type { PartnerPatchInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "partners.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as PartnerPatchInput | null;
    if (!body || typeof body !== "object") {
      return fail("VALIDATION_FAILED", "Tijelo zahtjeva nije validno.");
    }
    const outcome = await updatePartner(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      body,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    if (outcome.outcome === "VALIDATION_FAILED") {
      return fail("VALIDATION_FAILED", outcome.message ?? "Unos nije validan.");
    }
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", outcome.message ?? "Konflikt.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "partners.patch");
  }
}
