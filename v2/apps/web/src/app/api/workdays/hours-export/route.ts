/** GET /api/workdays/hours-export?from=&to= — R6.2 CSV sati (LOCKED/CONFIRMED). */
import type { NextRequest } from "next/server";
import { HoursExportQuery } from "@gradix/contracts";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { buildHoursCsv } from "@/server/hours-csv";
import { listHoursForExport } from "@/server/hours-export-service";
import { can, type Role } from "@/server/permissions";

export const dynamic = "force-dynamic";

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.hours.export");
    if (!guardResult.ok) return guardResult.response;
    if (!can(guardResult.ctx.roles, "export.data")) return fail("FORBIDDEN", "Nemate pravo izvoza podataka.");
    const params = request.nextUrl.searchParams;
    const parsed = HoursExportQuery.safeParse({
      from: params.get("from") ?? "", to: params.get("to") ?? "",
      projectId: params.get("projectId") ?? undefined, team: params.get("team") ?? undefined,
    });
    if (!parsed.success || !validDate(parsed.data.from) || !validDate(parsed.data.to)) {
      return fail("VALIDATION_FAILED", "Neispravni filteri ili datumi.");
    }
    const { from, to } = parsed.data;
    if (from > to) return fail("VALIDATION_FAILED", "Datum „od“ ne smije biti poslije „do“.");
    const rows = await listHoursForExport(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds ?? [],
      },
      parsed.data,
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
