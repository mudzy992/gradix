/**
 * Iz sesije u tenant kontekst. Jedno mjesto gdje se provjerava:
 *  - je li korisnik prijavljen (access JWT)
 *  - je li sesija još u bazi i nije opozvana (odjava i deaktivacija moraju djelovati odmah)
 *  - je li firma aktivna i je li korisnik njen član
 *  - je li nalog deaktiviran (R1a: deaktivacija mora djelovati odmah, ne za 15 minuta)
 *
 * RLS radi tek kad `withCompany` postavi `app.company_id` — zato se sve provjere
 * rade prije poslovnog upita, ali firma nikad ne dolazi iz klijenta (samo iz sesije).
 */
import { withCompany, type CompanyId } from "@gradix/db";
import { isSessionUsable } from "@gradix/domain";
import type { NextRequest } from "next/server";
import { getVerifiedPool } from "./db";
import { ACCESS_COOKIE, verifyAccessToken } from "./session";

export type AuthContext = {
  userId: string;
  sessionId: string;
  companyId: CompanyId;
  roles: string[];
  mustChangePassword: boolean;
};

export type AuthResult = { ok: true; ctx: AuthContext } | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" };

export function readAccessToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return request.cookies.get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * Rute koje smije koristiti sesija izdata dok je nalog morao promijeniti lozinku.
 * Sve ostalo vraća `AUTH_PASSWORD_CHANGE_REQUIRED` (403) — bez toga bi korisnik sa
 * privremenom lozinkom mogao raditi sve osim što mu UI to ne pokazuje.
 */
const PASSWORD_CHANGE_ALLOWED = new Set(["/api/auth/change-password", "/api/auth/logout-all", "/api/me"]);

export function requiresPasswordChange(
  ctx: AuthContext,
  pathname: string,
): "AUTH_PASSWORD_CHANGE_REQUIRED" | null {
  if (!ctx.mustChangePassword) return null;
  return PASSWORD_CHANGE_ALLOWED.has(pathname) ? null : "AUTH_PASSWORD_CHANGE_REQUIRED";
}

export async function authenticate(request: NextRequest, now = new Date()): Promise<AuthResult> {
  const token = readAccessToken(request);
  if (!token) return { ok: false, code: "UNAUTHENTICATED" };
  const claims = verifyAccessToken(token, now);
  if (!claims) return { ok: false, code: "UNAUTHENTICATED" };

  const rows = await withCompany(await getVerifiedPool(), claims.companyId as CompanyId, async (client) => {
    const session = await client.query<{
      expires_at: Date;
      revoked_at: Date | null;
      pwd_change_required: boolean;
    }>(
      "SELECT expires_at, revoked_at, pwd_change_required FROM sessions WHERE id = $1 AND user_id = $2",
      [claims.sid, claims.sub],
    );
    const first = session.rows[0];
    if (!first) return null;
    if (!isSessionUsable({ expiresAt: first.expires_at, revokedAt: first.revoked_at }, now)) return null;

    const membership = await client.query<{
      roles: string[];
      must_change_password: boolean;
    }>(
      `SELECT m.roles::text[] AS roles, u.must_change_password
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN companies c ON c.id = m.company_id
        WHERE m.user_id = $1 AND m.company_id = $2 AND m.is_active AND u.is_active AND c.is_active`,
      [claims.sub, claims.companyId],
    );
    const row = membership.rows[0];
    if (!row) return null;
    return { ...row, pwd_change_required: first.pwd_change_required };
  });

  if (!rows) return { ok: false, code: "UNAUTHENTICATED" };
  return {
    ok: true,
    ctx: {
      userId: claims.sub,
      sessionId: claims.sid,
      companyId: claims.companyId as CompanyId,
      roles: rows.roles,
      mustChangePassword: rows.must_change_password || rows.pwd_change_required,
    },
  };
}

/** Dozvola je podatak, ne rasuti uslov (A3.3.5). Za R0 je dovoljna provjera role. */
export function hasRole(ctx: AuthContext, role: string): boolean {
  return ctx.roles.includes(role);
}
