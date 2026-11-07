/**
 * Sesije: cookie za web, isti token za mobilni (ADR 0005).
 *
 * - access token: JWT HS256, 15 min, nosi `sub` (userId) i `sid` (sessionId)
 * - refresh token: 48 slučajnih bajtova; u bazi samo SHA-256 hash
 * - rotacija na svaki refresh; opozvan token = ponovna upotreba = gase se sve sesije korisnika
 * - nema replay prozora ni generacija (B6.16)
 *
 * Cookie je `httpOnly` + `sameSite=lax` + `secure` u produkciji: JS ga ne vidi, pa XSS ne krade sesiju.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TOKEN_BYTES,
  REFRESH_TTL_SECONDS,
  isValidRefreshTokenFormat,
} from "@gradix/domain";
import { loadConfig } from "./config";

export const ACCESS_COOKIE = "gx_at";
export const REFRESH_COOKIE = "gx_rt";
export const COMPANY_COOKIE = "gx_co";

export type AccessClaims = {
  sub: string;
  sid: string;
  companyId: string;
  /**
   * Sesija izdata dok je nalog morao promijeniti lozinku. Takva sesija smije samo
   * `POST /api/auth/change-password` i `POST /api/auth/logout-all`; sve ostalo vraća
   * `AUTH_PASSWORD_CHANGE_REQUIRED`. Provjerava se i u bazi (`sessions.pwd_change_required`),
   * pa promjena djeluje odmah, a ne tek kad istekne token.
   */
  pwd?: boolean;
  exp: number;
  iat: number;
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueAccessToken(claims: Omit<AccessClaims, "exp" | "iat">, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: AccessClaims = { ...claims, iat, exp: iat + ACCESS_TTL_SECONDS };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`, loadConfig().AUTH_SECRET);
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string, now = new Date()): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${body}`, loadConfig().AUTH_SECRET);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessClaims;
    if (typeof claims.sub !== "string" || typeof claims.sid !== "string") return null;
    if (claims.exp * 1000 <= now.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function newRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedRefreshToken(token: string): boolean {
  return isValidRefreshTokenFormat(token);
}

export const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: REFRESH_TTL_SECONDS,
};

export const accessCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: ACCESS_TTL_SECONDS,
};
