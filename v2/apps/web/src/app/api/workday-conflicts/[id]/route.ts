/**
 * GET /api/workday-conflicts/{id} — detalj: oba unosa, autor, izvor, odstupanje sata.
 * Interna napomena se vraća samo ovom uredskom API-ju (workdays.resolve),
 * nikad pull/device payloadima.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { getConflictDetail } from "@/server/workday-resolve";
import { resolveViewerWorkerId, workdayResolveScopeFor } from "@/server/workday-review";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.resolve");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const { id } = await params;
    const conflict = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const viewerWorkerId = await resolveViewerWorkerId(client, ctx.companyId, ctx.userId);
      return getConflictDetail(client, ctx.companyId, workdayResolveScopeFor(ctx.roles, viewerWorkerId), id);
    });
    if (!conflict) return fail("NOT_FOUND", "Sukob nije pronađen ili nije u vašem opsegu.");
    return ok({ conflict });
  } catch (error) {
    return internal(error, "workday-conflicts.detail");
  }
}
