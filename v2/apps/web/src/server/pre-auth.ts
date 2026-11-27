/**
 * Pre-auth token (spec 01 §1.5.24): kratkotrajni dokaz „lozinka je provjerena“ između
 * prvog i drugog koraka prijave.
 *
 * Zašto poseban token, a ne sesija sa zastavicom: između koraka korisnik još NIJE
 * prijavljen i ne smije dobiti ni jednu rutu. Pre-auth token nosi samo `sub`, `companyId`
 * i rok od 5 minuta, i apsolutno ništa drugo se ne može iz njega izvesti.
 *
 * Potpis je isti HMAC kao za access token (`AUTH_SECRET`), ali sa DRUGAČIJOM oznakom tipa
 * (`typ: "gx-pre"`). Bez toga bi pre-auth token bio prihvaćen kao access token — klasična
 * greška koja dva različita tokena pretvara u jedan.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PRE_AUTH_TTL_SECONDS } from "@gradix/domain";
import { loadConfig } from "./config";

export type PreAuthClaims = {
  typ: "gx-pre";
  sub: string;
  companyId: string;
  /** `ENROLL` = korisnik mora prvo upariti 2FA; `VERIFY` = traži se kod. */
  gate: "ENROLL" | "VERIFY";
  iat: number;
  exp: number;
};

function b64(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issuePreAuthToken(
  claims: { sub: string; companyId: string; gate: "ENROLL" | "VERIFY" },
  now = new Date(),
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: PreAuthClaims = { typ: "gx-pre", ...claims, iat, exp: iat + PRE_AUTH_TTL_SECONDS };
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`, loadConfig().AUTH_SECRET)}`;
}

export function verifyPreAuthToken(token: string, now = new Date()): PreAuthClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${body}`, loadConfig().AUTH_SECRET);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PreAuthClaims;
    // Tip je OBAVEZAN: access token nema `typ` i zato nikad ne prolazi kao pre-auth.
    if (claims.typ !== "gx-pre") return null;
    if (claims.gate !== "ENROLL" && claims.gate !== "VERIFY") return null;
    if (typeof claims.sub !== "string" || typeof claims.companyId !== "string") return null;
    if (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= now.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Pre-auth token putuje u zaglavlju `x-gx-2fa`, nikad u cookie-ju (nije sesija). */
export const PRE_AUTH_HEADER = "x-gx-2fa";
