/**
 * GET/POST /api/platform/companies — lista firmi i onboarding (spec 01 §3).
 *
 * Ruta NE koristi `guard()`: operator nije član firme i nema `app.company_id`. Provjera ide
 * kroz `gx_plat` cookie i odvojenu konekciju (`DATABASE_ADMIN_URL`).
 */
import type { NextRequest } from "next/server";
import { PlatformCompanyCreateInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import {
  PLATFORM_COOKIE,
  authenticatePlatform,
  listCompanies,
  onboardCompany,
} from "@/server/platform-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const actor = await authenticatePlatform(request.cookies.get(PLATFORM_COOKIE)?.value ?? null);
    if (!actor) return fail("PLATFORM_FORBIDDEN", "Pristup je dozvoljen samo operatoru platforme.");
    return ok({ companies: await listCompanies() });
  } catch (error) {
    return internal(error, "platform.companies.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const actor = await authenticatePlatform(request.cookies.get(PLATFORM_COOKIE)?.value ?? null);
    if (!actor) return fail("PLATFORM_FORBIDDEN", "Pristup je dozvoljen samo operatoru platforme.");
    const parsed = PlatformCompanyCreateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Neispravan unos.");
    }
    const result = await onboardCompany(actor, parsed.data, request.nextUrl.origin);
    if (!result.ok) return fail(result.code, result.message);
    return ok({ company: result.company, invitationLink: result.invitationLink });
  } catch (error) {
    return internal(error, "platform.companies.create");
  }
}
