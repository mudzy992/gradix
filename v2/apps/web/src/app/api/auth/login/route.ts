/**
 * POST /api/auth/login — email + lozinka → access (cookie) + refresh (cookie).
 *
 * Mobile ne koristi cookie nego tijelo odgovora: isti token, isti ugovor.
 * Rate limiting (R1a): brojač je u tabeli `login_attempts`, hashiran sa AUTH_SECRET kao
 * pepperom, pa radi i sa više replika. Aplikacija nema direktan pristup tabeli — samo kroz
 * funkcije (vidi migration `r1a_pristup` i `bootstrap/grants.sql`).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, internal, ok } from "@/server/api";
import { login } from "@/server/auth-service";
import { checkPasswordPolicy, verifyPassword } from "@/server/password";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, issueAccessToken, refreshCookieOptions } from "@/server/session";
import { getVerifiedPool } from "@/server/db";
import { clearAttempts, isRateLimited, recordAttempt } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Email i lozinka su obavezni.");

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const pool = await getVerifiedPool();
    if (await isRateLimited(pool, parsed.data.email)) {
      return fail("RATE_LIMITED", "Previše pokušaja. Sačekajte minutu.");
    }

    const result = await login(parsed.data.email, parsed.data.password, verifyPassword);
    if ("code" in result) {
      await recordAttempt(pool, parsed.data.email, ip);
      if (result.code === "AUTH_COMPANY_INACTIVE") {
        return fail("AUTH_COMPANY_INACTIVE", "Firma je deaktivirana. Obratite se administratoru.");
      }
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      // Ista poruka za nepostojeći nalog, pogrešnu lozinku i deaktiviran nalog.
      return fail("AUTH_INVALID_CREDENTIALS", "Email ili lozinka nisu ispravni.");
    }

    await clearAttempts(pool, parsed.data.email);
    const accessToken = issueAccessToken({
      sub: result.userId,
      sid: result.sessionId,
      companyId: result.companyId,
      // Sesija nosi obavezu promjene lozinke dok se ne promijeni (provjera i u bazi).
      ...(result.mustChangePassword ? { pwd: true } : {}),
    });

    const response = ok({
      user: { id: result.userId, displayName: result.displayName, roles: result.roles },
      companyId: result.companyId,
      mustChangePassword: result.mustChangePassword,
      // Mobile čita tokene odavde; web ih dobija i kroz cookie.
      accessToken,
      refreshToken: result.refreshToken,
      passwordPolicy: checkPasswordPolicy("") === null ? undefined : "min 10 znakova, slovo i broj",
    });
    response.cookies.set(ACCESS_COOKIE, accessToken, accessCookieOptions);
    response.cookies.set(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions);
    return response;
  } catch (error) {
    return internal(error, "auth.login");
  }
}
