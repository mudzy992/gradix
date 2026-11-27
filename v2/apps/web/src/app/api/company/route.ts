/**
 * GET/PATCH /api/company — postavke firme (spec 01 §3).
 *
 * `slug` se ne mijenja: nije u `CompanySettingsPatch`, pa ruta ne može ni primiti izmjenu
 * identiteta tenanta. To je namjerno — identitet se ne prepravlja PATCH-em.
 */
import type { NextRequest } from "next/server";
import { CompanySettingsPatch } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getCompanySettings, updateCompanySettings } from "@/server/company-service";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "company.settings.view");
    if (!auth.ok) return auth.response;
    const company = await getCompanySettings(await getVerifiedPool(), auth.ctx.companyId);
    if (!company) return fail("NOT_FOUND", "Firma nije pronađena.");
    return ok({ company });
  } catch (error) {
    return internal(error, "company.get");
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "company.settings.manage");
    if (!auth.ok) return auth.response;
    const parsed = CompanySettingsPatch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Neispravan unos.");
    }
    const result = await updateCompanySettings(
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
    return ok({ company: result.company });
  } catch (error) {
    return internal(error, "company.patch");
  }
}
