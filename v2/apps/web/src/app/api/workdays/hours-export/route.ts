/** GET /api/workdays/hours-export?from=&to= — R6.2 CSV sati (LOCKED/CONFIRMED). */
import type { NextRequest } from "next/server";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { buildHoursCsv } from "@/server/hours-csv";
import { listHoursForExport } from "@/server/hours-export-service";
import type { Role } from "@/server/permissions";

export const dynamic = "force-dynamic";

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.hours.export");
    if (!guardResult.ok) return guardResult.response;
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return fail("VALIDATION_FAILED", "Parametri from i to moraju biti YYYY-MM-DD.");
    }
    if (from > to) {
      return fail("VALIDATION_FAILED", "Datum „od“ ne smije biti poslije „do“.");
    }
    const rows = await listHoursForExport(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds ?? [],
      },
      { from, to },
    );
    const csv = buildHoursCsv(rows);
    const filename = `obracun-sati-${from}-${to}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return internal(error, "workdays.hours-export");
  }
}
