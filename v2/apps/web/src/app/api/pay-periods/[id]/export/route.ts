/**
 * GET /api/pay-periods/{id}/export?format=xlsx|csv&includeProvisional
 *
 * Default je samo `LOCKED`. Provizorni izvoz (uključuje `FOREMAN_CONFIRMED`) je eksplicitan i
 * u zaglavlju fajla piše da nije konačan obračun — inače bi isti dan bio izvezen dvaput.
 */
import type { NextRequest } from "next/server";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { buildPayrollExport } from "@/server/payroll-export";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.hours.export");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const includeProvisional = ["1", "true", "yes"].includes(
      (request.nextUrl.searchParams.get("includeProvisional") ?? "").toLowerCase(),
    );
    const result = await buildPayrollExport(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      { periodId: id, format, includeProvisional },
    );
    if ("code" in result) return fail(result.code as never, result.message);
    return new Response(new Uint8Array(result.body), {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${result.filename}"`,
        "cache-control": "no-store",
        "x-export-format-version": result.meta.version,
        "x-export-provisional": result.meta.provisional ? "1" : "0",
      },
    });
  } catch (error) {
    return internal(error, "pay-periods.export");
  }
}
