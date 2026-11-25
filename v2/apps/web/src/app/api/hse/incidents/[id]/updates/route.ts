/**
 * POST /api/hse/incidents/{id}/updates — dopuna uz incident (§1.8/36).
 *
 * Nikad izmjena: dva zapisa o istom događaju su dva svjedoka, ne neslaganje verzija.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { addIncidentUpdate } from "@/server/hse-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.report");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { body?: string; authorWorkerId?: string | null } | null;
    if (!body?.body) return fail("VALIDATION_FAILED", "Tekst dopune je obavezan.");
    const outcome = await addIncidentUpdate(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      { body: body.body, authorWorkerId: body.authorWorkerId ?? null },
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "hse.incidents.update");
  }
}
