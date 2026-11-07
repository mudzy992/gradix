/**
 * POST /api/auth/refresh — rotira refresh token i izdaje novi access token.
 * Ponovna upotreba opozvanog tokena gasi sve sesije korisnika (AUTH_REFRESH_REUSE).
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { rotateRefresh } from "@/server/auth-service";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  isWellFormedRefreshToken,
  issueAccessToken,
  refreshCookieOptions,
} from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { refreshToken?: unknown };
    const token =
      (typeof body.refreshToken === "string" ? body.refreshToken : undefined) ??
      request.cookies.get(REFRESH_COOKIE)?.value;
    if (!token || !isWellFormedRefreshToken(token)) {
      return fail("AUTH_REFRESH_INVALID", "Sesija nije važeća. Prijavite se ponovo.");
    }

    const result = await rotateRefresh(token);
    if (!result.ok) {
      const response = fail(
        result.code,
        result.code === "AUTH_REFRESH_REUSE"
          ? "Sesija je opozvana. Prijavite se ponovo."
          : "Sesija je istekla. Prijavite se ponovo.",
      );
      response.cookies.delete(REFRESH_COOKIE);
      response.cookies.delete(ACCESS_COOKIE);
      return response;
    }

    const accessToken = issueAccessToken({
      sub: result.userId,
      sid: result.sessionId,
      companyId: result.companyId,
    });
    const response = ok({ accessToken, refreshToken: result.refreshToken });
    response.cookies.set(ACCESS_COOKIE, accessToken, accessCookieOptions);
    response.cookies.set(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions);
    return response;
  } catch (error) {
    return internal(error, "auth.refresh");
  }
}
