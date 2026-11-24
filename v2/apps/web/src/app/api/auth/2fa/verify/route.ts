/**
 * POST /api/auth/2fa/verify — potvrda uparivanja prvim kodom. Vraća recovery kodove JEDNOM.
 *
 * Uspjeh PONOVO IZDAJE token, bez `enr` zastavice. Bez toga nalog ostaje u sesiji za uparivanje
 * i poslije uspješnog uparivanja: `proxy` ga vraća na `/ured/postavke?tab=sigurnost`, a API
 * odbija svaku poslovnu rutu sa `AUTH_2FA_ENROLLMENT_REQUIRED`. Korisnik vidi „2FA je uključena"
 * i ne može dalje — ekran se, iz njegove perspektive, „ne može učitati".
 */
import type { NextRequest } from "next/server";
import { TwoFactorCodeInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { ACCESS_COOKIE, accessCookieOptions, issueAccessToken } from "@/server/session";
import { confirmEnrollment } from "@/server/two-factor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const parsed = TwoFactorCodeInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Kod ima 6 cifara.");
    const result = await confirmEnrollment(
      await getVerifiedPool(),
      { userId: auth.ctx.userId, companyId: auth.ctx.companyId, ip: clientIp(request) },
      parsed.data.code,
    );
    if ("code" in result) return fail(result.code, result.message);

    const response = ok({ recoveryCodes: result.recoveryCodes });
    // Nova sesija: uparivanje je završeno, pa `enr` više ne smije stajati u tokenu.
    const token = issueAccessToken({
      sub: auth.ctx.userId,
      sid: auth.ctx.sessionId,
      companyId: auth.ctx.companyId,
    });
    response.cookies.set(ACCESS_COOKIE, token, accessCookieOptions);
    return response;
  } catch (error) {
    return internal(error, "auth.2fa.verify");
  }
}
