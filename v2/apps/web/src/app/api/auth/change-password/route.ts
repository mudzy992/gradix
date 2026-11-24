/**
 * POST /api/auth/change-password — promjena vlastite lozinke.
 * Gasim sve ostale sesije; tekuća ostaje (čovjek nastavlja gdje je stao).
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok, type ErrorCode } from "@/server/api";
import { ChangePasswordRequest } from "@gradix/contracts";
import { changeOwnPassword } from "@/server/access-service";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE, accessCookieOptions, issueAccessToken } from "@/server/session";
import { authenticate } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const CODE_MAP: Record<string, ErrorCode> = {
  VALIDATION_FAILED: "AUTH_PASSWORD_WEAK",
  FORBIDDEN: "FORBIDDEN",
};

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return fail(auth.code, "Niste prijavljeni.");

    const parsed = ChangePasswordRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Sva polja su obavezna.");

    const result = await changeOwnPassword(
      await getVerifiedPool(),
      {
        userId: auth.ctx.userId,
        companyId: auth.ctx.companyId,
        sessionId: auth.ctx.sessionId,
      },
      { ...parsed.data, ip: clientIp(request) },
    );

    if ("code" in result) {
      // Pogrešna trenutna lozinka i ista nova lozinka su korisničke greške, ne sigurnosne.
      const code =
        result.code === "VALIDATION_FAILED" && result.message.includes("Trenutna")
          ? "AUTH_PASSWORD_WRONG"
          : (CODE_MAP[result.code] ?? "INTERNAL");
      return fail(code, result.message);
    }
    /*
     * Token se PONOVO IZDAJE bez `pwd` zastavice.
     *
     * Bez ovoga nalog ostaje zaglavljen: baza je `must_change_password` postavila na `false`,
     * ali stari token nosi `pwd: true` do isteka (15 min), pa `authenticate` vraća
     * `mustChangePassword` sa `rows.must_change_password || rows.pwd_change_required` — i
     * `/api/auth/2fa/status` odbija zahtjev sa „Prvo postavite novu lozinku" tačno poslije
     * uspješne promjene. Korisnik vidi uspjeh i onda 403 na sljedećem ekranu.
     *
     * `enr` se NE dodaje: uobičajena sesija poslije promjene lozinke nije sesija za uparivanje.
     * Sesija izdana radi uparivanja nastavlja bez `pwd`, sa `enr`, i ide na 2FA ekran.
     */
    const response = ok(result);
    const token = issueAccessToken({
      sub: auth.ctx.userId,
      sid: auth.ctx.sessionId,
      companyId: auth.ctx.companyId,
    });
    response.cookies.set(ACCESS_COOKIE, token, accessCookieOptions);
    return response;
  } catch (error) {
    return internal(error, "auth.changePassword");
  }
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
