/**
 * Iz sesije u tenant kontekst. Jedno mjesto gdje se provjerava:
 *  - je li korisnik prijavljen (access JWT)
 *  - je li sesija još u bazi i nije opozvana (odjava i deaktivacija moraju djelovati odmah)
 *  - je li firma aktivna i je li korisnik njen član
 *
 * RLS radi tek kad `withCompany` postavi `app.company_id` — zato se sve provjere
 * rade prije poslovnog upita, ali firma nikad ne dolazi iz klijenta (samo iz sesije).
 */
import { withCompany, type CompanyId } from "@gradix/db";
import { isSessionUsable } from "@gradix/domain";
import type { NextRequest } from "next/server";
import { getPool } from "./db";
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

export async function authenticate(request: NextRequest, now = new Date()): Promise<AuthResult> {
  const token = readAccessToken(request);
  if (!token) return { ok: false, code: "UNAUTHENTICATED" };
  const claims = verifyAccessToken(token, now);
  if (!claims) return { ok: false, code: "UNAUTHENTICATED" };

  const rows = await withCompany(getPool(), claims.companyId as CompanyId, async (client) => {
    const session = await client.query<{ expires_at: Date; revoked_at: Date | null }>(
      "SELECT expires_at, revoked_at FROM sessions WHERE id = $1 AND user_id = $2",
      [claims.sid, claims.sub],
    );
    const first = session.rows[0];
    if (!first) return null;
    if (!isSessionUsable({ expiresAt: first.expires_at, revokedAt: first.revoked_at }, now)) return null;

    const membership = await client.query<{ roles: string[]; must_change_password: boolean }>(
      `SELECT m.roles::text[] AS roles, u.must_change_password
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN companies c ON c.id = m.company_id
        WHERE m.user_id = $1 AND m.company_id = $2 AND m.is_active AND u.is_active AND c.is_active`,
      [claims.sub, claims.companyId],
    );
    return membership.rows[0] ?? null;
  });

  if (!rows) return { ok: false, code: "UNAUTHENTICATED" };
  return {
    ok: true,
    ctx: {
      userId: claims.sub,
      sessionId: claims.sid,
      companyId: claims.companyId as CompanyId,
      roles: rows.roles,
      mustChangePassword: rows.must_change_password,
    },
  };
}

/** Dozvola je podatak, ne rasuti uslov (A3.3.5). Za R0 je dovoljna provjera role. */
export function hasRole(ctx: AuthContext, role: string): boolean {
  return ctx.roles.includes(role);
}
