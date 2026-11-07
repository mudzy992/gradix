/**
 * POST /api/auth/login — email + lozinka → access (cookie) + refresh (cookie).
 *
 * Mobile ne koristi cookie nego tijelo odgovora: isti token, isti ugovor.
 * Rate limiting: limit je u memoriji procesa i NIJE dovoljan za više replika.
 * To je svjesno u R0 (nema Redisa) i zapisano u STATUS.md kao dug za Fazu 2.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, internal, ok } from "@/server/api";
import { login } from "@/server/auth-service";
import { checkPasswordPolicy, verifyPassword } from "@/server/password";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, issueAccessToken, refreshCookieOptions } from "@/server/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

// Limiti se mogu podesiti bez izmjene koda, ali imaju sigurne zadane vrijednosti.
// Napomena: brojač je u memoriji procesa (R0 bez Redisa) — vidi STATUS.md, dug za Fazu 2.
const WINDOW_MS = Number(process.env.AUTH_LOGIN_WINDOW_MS ?? 60_000);
const MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_LIMIT ?? 5);
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(key: string, now: number): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordAttempt(key: string, now: number): void {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Email i lozinka su obavezni.");

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const key = `${ip}:${parsed.data.email.toLowerCase()}`;
    const now = Date.now();
    if (tooManyAttempts(key, now)) {
      return fail("RATE_LIMITED", "Previše pokušaja. Sačekajte minutu.");
    }

    const result = await login(parsed.data.email, parsed.data.password, verifyPassword);
    if ("code" in result) {
      recordAttempt(key, now);
      if (result.code === "AUTH_COMPANY_INACTIVE") {
        return fail("AUTH_COMPANY_INACTIVE", "Firma je deaktivirana. Obratite se administratoru.");
      }
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      // Ista poruka za nepostojeći nalog, pogrešnu lozinku i deaktiviran nalog.
      return fail("AUTH_INVALID_CREDENTIALS", "Email ili lozinka nisu ispravni.");
    }

    attempts.delete(key);
    const accessToken = issueAccessToken({
      sub: result.userId,
      sid: result.sessionId,
      companyId: result.companyId,
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
