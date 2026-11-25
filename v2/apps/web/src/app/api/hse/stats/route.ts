/**
 * GET /api/hse/stats?from&to&project — LTIFR, izgubljeni dani, mjere na vrijeme, obuke (§1.6).
 *
 * Sve je IZRAČUN, ne tabela: stopa na odrađene sate ne smije živjeti u redu koji neko zaboravi
 * osvježiti.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { hseStats } from "@/server/hse-service";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const to = params.get("to") ?? new Date().toISOString().slice(0, 10);
    const from = params.get("from") ?? `${to.slice(0, 4)}-01-01`;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return fail("VALIDATION_FAILED", "from i to moraju biti datumi (YYYY-MM-DD).");
    }
    const stats = await hseStats(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      { from, to, projectId: params.get("project") ?? params.get("projectId") ?? undefined },
    );
    return ok(stats);
  } catch (error) {
    return internal(error, "hse.stats");
  }
}
