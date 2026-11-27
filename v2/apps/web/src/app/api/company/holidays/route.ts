/**
 * GET/POST /api/company/holidays — praznici i prenesene radne subote (spec 01 §3).
 *
 * `is_working = true` je jedini način da obračun sati zna da je subota bila radna; bez toga
 * bi svi ti sati ispali prekovremeni. Zato je ovo zasebna dozvola, ne dio postavki.
 */
import type { NextRequest } from "next/server";
import { CompanyHolidayInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { createHoliday, listHolidays } from "@/server/company-service";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "company.settings.view");
    if (!auth.ok) return auth.response;
    // Godina je poslovni podatak (firma radi po svojoj zoni), ne `new Date()` na serveru.
    const yearParam = request.nextUrl.searchParams.get("year");
    const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : new Date().getUTCFullYear();
    const holidays = await listHolidays(await getVerifiedPool(), auth.ctx.companyId, year);
    return ok({ holidays, year });
  } catch (error) {
    return internal(error, "company.holidays.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "company.holidays.manage");
    if (!auth.ok) return auth.response;
    const parsed = CompanyHolidayInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Neispravan unos.");
    }
    const result = await createHoliday(
      await getVerifiedPool(),
      {
        userId: auth.ctx.userId,
        companyId: auth.ctx.companyId,
        actorEmail: null,
        roles: auth.ctx.roles,
        ip: clientIp(request),
      },
      parsed.data,
    );
    if ("code" in result) return fail(result.code, result.message);
    return ok({ holiday: result.holiday });
  } catch (error) {
    return internal(error, "company.holidays.create");
  }
}
