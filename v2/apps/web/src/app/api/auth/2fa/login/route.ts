/**
 * POST /api/auth/2fa/login — drugi korak prijave (spec 01 §1.5.24).
 *
 * Ulaz: pre-auth token iz `POST /api/auth/login` (u zaglavlju `x-gx-2fa`) + kod ili recovery kod.
 * Izlaz: ista sesija kao obična prijava (cookie + tokeni za mobilni).
 *
 * Zašto zaglavlje, a ne tijelo: token je dokaz, ne podatak forme — ne smije završiti u logu
 * zahtjeva ni u kopiranom `curl` primjeru.
 *
 * Ruta je JAVNA (`auth: false`): korisnik još nema sesiju. Sve što smije jeste ono što
 * pre-auth token dokazuje — jedan nalog, jedna firma, pet minuta.
 */
import type { NextRequest } from "next/server";
import { TwoFactorVerifyInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { completeTwoFactorLogin, recordFailure } from "@/server/auth-service";
import { getVerifiedPool } from "@/server/db";
import { PRE_AUTH_HEADER, verifyPreAuthToken } from "@/server/pre-auth";
import { checkPasswordPolicy } from "@/server/password";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  issueAccessToken,
  refreshCookieOptions,
} from "@/server/session";
import { consumeRecoveryCode, verifyLoginCode } from "@/server/two-factor";
import { withCompany, type CompanyId } from "@gradix/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const claims = verifyPreAuthToken(request.headers.get(PRE_AUTH_HEADER) ?? "");
    if (!claims) {
      return fail("AUTH_2FA_REQUIRED", "Priprema prijave je istekla. Prijavite se ponovo.");
    }
    const companyId = claims.companyId as CompanyId;
    const userAgent = request.headers.get("user-agent");
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const pool = await getVerifiedPool();

    /*
     * `gate: "ENROLL"` — lozinka je tačna, ali 2FA NIJE uparena a rola je traži.
     *
     * Ovdje se ne unosi kod (nema ga odakle uzeti), pa se izdaje sesija OGRANIČENA na
     * uparivanje (`enr: true`): vidi samo `/auth/2fa/{status,enroll,verify}` i `logout`.
     * Bez ovoga bi obavezna 2FA bila kružni argument — da bi upario 2FA trebaš sesiju,
     * a da bi dobio sesiju trebaš 2FA.
     */
    if (claims.gate === "ENROLL") {
      const session = await completeTwoFactorLogin(claims.sub, companyId, { userAgent, ip });
      if ("code" in session) return fail(session.code, "Nije moguće dovršiti prijavu.");
      const enrollmentToken = issueAccessToken({
        sub: session.userId,
        sid: session.sessionId,
        companyId: session.companyId,
        enr: true,
      });
      const response = ok({
        user: { id: session.userId, displayName: session.displayName, roles: session.roles },
        companyId: session.companyId,
        mustChangePassword: session.mustChangePassword,
        enrollmentRequired: true,
        accessToken: enrollmentToken,
        refreshToken: session.refreshToken,
      });
      response.cookies.set(ACCESS_COOKIE, enrollmentToken, accessCookieOptions);
      response.cookies.set(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions);
      return response;
    }

    const parsed = TwoFactorVerifyInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Kod je obavezan.");

    const outcome = await withCompany(pool, companyId, async (client) => {
      const code = parsed.data.code.trim();
      const numeric = /^\d{6}$/.test(code);
      if (numeric) {
        const result = await verifyLoginCode(client, claims.sub, code);
        return result.ok ? ({ ok: true } as const) : ({ ok: false, kind: "TOTP" } as const);
      }
      // Nije 6 cifara → recovery kod. Potrošnja je atomska i upisuje audit (klasa ACCESS).
      const used = await consumeRecoveryCode(client, claims.sub, code, companyId, ip);
      return used ? ({ ok: true } as const) : ({ ok: false, kind: "RECOVERY" } as const);
    });

    if (!outcome.ok) {
      // Ponovljeni promašaj broji se u zaključavanje naloga, isto kao pogrešna lozinka.
      await recordFailure(pool, claims.sub);
      return fail(
        "AUTH_2FA_INVALID",
        outcome.kind === "RECOVERY"
          ? "Recovery kod nije ispravan ili je već iskorišten."
          : "Kod nije ispravan. Provjerite sat na telefonu.",
      );
    }

    const session = await completeTwoFactorLogin(claims.sub, companyId, { userAgent, ip });
    if ("code" in session) return fail(session.code, "Nije moguće dovršiti prijavu.");

    const accessToken = issueAccessToken({
      sub: session.userId,
      sid: session.sessionId,
      companyId: session.companyId,
      ...(session.mustChangePassword ? { pwd: true } : {}),
    });
    const response = ok({
      user: { id: session.userId, displayName: session.displayName, roles: session.roles },
      companyId: session.companyId,
      mustChangePassword: session.mustChangePassword,
      accessToken,
      refreshToken: session.refreshToken,
      passwordPolicy: checkPasswordPolicy("") === null ? undefined : "min 10 znakova, slovo i broj",
    });
    response.cookies.set(ACCESS_COOKIE, accessToken, accessCookieOptions);
    response.cookies.set(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions);
    return response;
  } catch (error) {
    return internal(error, "auth.2fa.login");
  }
}
