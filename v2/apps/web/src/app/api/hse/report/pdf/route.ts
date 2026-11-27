/**
 * GET /api/hse/report/pdf?from&to&project — mjesečni HSE izvještaj (spec 10 §1.6/30).
 *
 * Izvoz se auditira: izvještaj o povredama i mjerama je dokaz postupanja, pa mora imati trag ko ga
 * je iznio i kada.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { hseStats } from "@/server/hse-service";
import { buildHseReportPdf } from "@/server/hse-report-pdf-service";
import { writeAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.view");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const params = request.nextUrl.searchParams;
    const to = params.get("to") ?? new Date().toISOString().slice(0, 10);
    const from = params.get("from") ?? `${to.slice(0, 4)}-01-01`;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return fail("VALIDATION_FAILED", "from i to moraju biti datumi (YYYY-MM-DD).");
    }

    const pool = await getVerifiedPool();
    const stats = await hseStats(
      pool,
      { userId: ctx.userId, companyId: ctx.companyId, roles: ctx.roles as Role[], scope: ctx.scope, projectIds: ctx.projectIds },
      { from, to, projectId: params.get("project") ?? undefined },
    );
    const company = await withCompany(pool, ctx.companyId, (client) =>
      client.query<{ name: string }>("SELECT name FROM public.companies WHERE id = $1", [ctx.companyId]),
    );
    const companyName = company.rows[0]?.name ?? "Firma";

    await withCompany(pool, ctx.companyId, async (client) => {
      await writeAudit(client, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        actorEmail: null,
        action: "hse.report_exported",
        entityType: "hse_incident",
        entityId: `report_${from}_${to}`,
        metadata: { from, to, incidents: stats.incidents, ltifr: stats.ltifr },
        retentionClass: "ACCESS",
      });
    });

    const bytes = buildHseReportPdf(stats, companyName);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="hse-${from}-${to}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return internal(error, "hse.report.pdf");
  }
}
