/**
 * POST /api/auth/login — email + lozinka → access (cookie) + refresh (cookie).
 *
 * Mobile ne koristi cookie nego tijelo odgovora: isti token, isti ugovor.
 * Rate limiting (R1a): brojač je u tabeli `login_attempts`, hashiran sa AUTH_SECRET kao
 * pepperom, pa radi i sa više replika. Aplikacija nema direktan pristup tabeli — samo kroz
 * funkcije (vidi migration `r1a_pristup` i `bootstrap/grants.sql`).
 */
import type { NextRequest } from "next/server";
import { LoginRequest, hasControlChars } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { login } from "@/server/auth-service";
import { checkPasswordPolicy, verifyPassword } from "@/server/password";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, issueAccessToken, refreshCookieOptions } from "@/server/session";
import { getVerifiedPool } from "@/server/db";
import { clearAttempts, rateLimitWait, recordAttempt } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const parsed = LoginRequest.safeParse(body);
    if (!parsed.success) {
      // A1c: log ODBIJENOG unosa BEZ vrijednosti — samo ime polja, dužina i da li sadrži
      // kontrolne znakove. To je dovoljno da se vidi odakle dolazi NUL (npr. s mobilnog),
      // a nikad ne upisuje email ni lozinku u log.
      let controlChars = false;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (const [field, value] of Object.entries(body as Record<string, unknown>)) {
          if (typeof value !== "string") continue;
          if (hasControlChars(value)) controlChars = true;
          console.warn(
            JSON.stringify({ level: "warn", context: "auth.login", field, length: value.length, controlChars: hasControlChars(value) }),
          );
        }
      }
      return fail(
        "VALIDATION_FAILED",
        controlChars
          ? "Email ili lozinka sadrži nedozvoljene kontrolne znakove."
          : "Email i lozinka su obavezni.",
      );
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    // Brojač i prijava moraju gledati ISTI ključ: `login` normalizuje email, pa bi bez ovoga
    // „ Ured@Demo.ba " pravio drugi brojač (i zaobilazio limit).
    const email = parsed.data.email.trim().toLowerCase();
    const pool = await getVerifiedPool();

    // Koliko još traje prozor — da poruka kaže stvarni broj sekundi, ne fiksnu minutu.
    const wait = await rateLimitWait(pool, email);
    if (wait > 0) {
      const response = fail("RATE_LIMITED", `Previše pokušaja. Pokušajte ponovo za ${wait} s.`);
      response.headers.set("Retry-After", String(wait));
      return response;
    }

    const result = await login(email, parsed.data.password, verifyPassword);
    if ("code" in result) {
      await recordAttempt(pool, email, ip);
      if (result.code === "AUTH_COMPANY_INACTIVE") {
        return fail("AUTH_COMPANY_INACTIVE", "Firma je deaktivirana. Obratite se administratoru.");
      }
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      // Ista poruka za nepostojeći nalog, pogrešnu lozinku i deaktiviran nalog.
      return fail("AUTH_INVALID_CREDENTIALS", "Email ili lozinka nisu ispravni.");
    }

    await clearAttempts(pool, email);
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
