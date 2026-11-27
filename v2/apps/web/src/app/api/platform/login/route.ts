/**
 * POST /api/platform/login — odvojena prijava operatora platforme (spec 01 §1.8.35).
 *
 * Odvojena od `/api/auth/login` namjerno: operator NEMA `company_id`, pa ne smije ući kroz
 * istu putanju kao korisnik firme. Cookie je `gx_plat`, ime se ne miješa sa `gx_at`.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, internal, ok } from "@/server/api";
import { PLATFORM_COOKIE, platformLogin } from "@/server/platform-service";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Email i lozinka su obavezni.");
    const result = await platformLogin(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      // Ista poruka za sve razloge: operator koji pogodi email ne smije znati više.
      return fail("PLATFORM_FORBIDDEN", "Pristup nije dozvoljen.");
    }
    const response = ok({ principal: result.principal, expiresAt: result.expiresAt.toISOString() });
    response.cookies.set(PLATFORM_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch (error) {
    return internal(error, "platform.login");
  }
}
