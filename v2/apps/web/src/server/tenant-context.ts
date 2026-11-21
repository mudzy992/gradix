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
import { companyId, withCompany, type CompanyId } from "@gradix/db";
import { isScope, isSessionUsable, type Scope } from "@gradix/domain";
import type { NextRequest } from "next/server";
import { getVerifiedPool } from "./db";
import { ACCESS_COOKIE, verifyAccessToken } from "./session";

export type AuthContext = {
  userId: string;
  sessionId: string;
  companyId: CompanyId;
  roles: string[];
  mustChangePassword: boolean;
  /**
   * Opseg članstva (R3). Do R3 je opseg bio samo podatak u bazi koji UI nije ni dobijao; sada
   * odlučuje šta se vidi, pa mora biti u kontekstu — inače bi svaka ruta pitala bazu ponovo.
   */
  scope: Scope;
  /**
   * Projekti na koje je osoba dodijeljena — samo za opseg `PROJECTS`. Za `COMPANY` je `null`
   * (bez filtera), za `SELF` prazan niz. Namjerno `null`, a ne prazan niz: vidi `visibleProjectIds`.
   */
  projectIds: string[] | null;
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

  // Treat every signed claim as untrusted input at the tenant boundary too: an absent or
  // malformed companyId must fail as 401, not reach SET LOCAL as undefined or throw a 500.
  let tenantId: CompanyId;
  try {
    tenantId = companyId(claims.companyId);
  } catch {
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  const rows = await withCompany(await getVerifiedPool(), tenantId, async (client) => {
    const session = await client.query<{
      company_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      pwd_change_required: boolean;
    }>(
      `SELECT company_id, expires_at, revoked_at, pwd_change_required
         FROM sessions WHERE id = $1 AND user_id = $2 AND company_id = $3`,
      [claims.sid, claims.sub, tenantId],
    );
    const first = session.rows[0];
    if (!first || first.company_id !== tenantId) return null;
    if (!isSessionUsable({ expiresAt: first.expires_at, revokedAt: first.revoked_at }, now)) return null;

    const membership = await client.query<{
      roles: string[];
      scope: string;
      must_change_password: boolean;
    }>(
      `SELECT m.roles::text[] AS roles, m.scope, u.must_change_password
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN companies c ON c.id = m.company_id
        WHERE m.user_id = $1 AND m.company_id = $2 AND m.is_active AND u.is_active AND c.is_active`,
      [claims.sub, tenantId],
    );
    const row = membership.rows[0];
    if (!row) return null;

    // Projekti se čitaju SAMO kad opseg to traži. Za `COMPANY` i `SELF` upit ne ide — jedan
    // upit manje na svakoj stranici za svakog koga projekti ne zanimaju.
    let projectIds: string[] = [];
    if (row.scope === "PROJECTS") {
      // Dodjela radnika → njegov nalog. Mašina se ne računa: opseg prati ljude, a ne opremu.
      const assigned = await client.query<{ project_id: string }>(
        `SELECT DISTINCT a.project_id
           FROM project_assignments a
           JOIN workers w ON w.company_id = a.company_id AND w.id = a.worker_id
           JOIN companies c ON c.id = a.company_id
          WHERE a.company_id = $2 AND w.user_id = $1
            AND a.voided_at IS NULL
            AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
            AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)`,
        [claims.sub, tenantId],
      );
      projectIds = assigned.rows.map((entry) => String(entry.project_id));
    }

    return {
      ...row,
      pwd_change_required: first.pwd_change_required,
      projectIds,
      resolvedScope: isScope(row.scope) ? row.scope : ("SELF" as const),
    };
  });

  if (!rows) return { ok: false, code: "UNAUTHENTICATED" };
  const scope = rows.resolvedScope;
  return {
    ok: true,
    ctx: {
      userId: claims.sub,
      sessionId: claims.sid,
      companyId: tenantId,
      roles: rows.roles,
      mustChangePassword: rows.must_change_password || rows.pwd_change_required,
      // Nepoznat opseg se NE pretvara u `COMPANY`: to bi bila tiho podignuta dozvola. Neispravna
      // vrijednost (npr. iz ručnog upisa u bazu) pada na najuži opseg.
      scope: scope,
      projectIds: scope === "COMPANY" ? null : scope === "PROJECTS" ? rows.projectIds : [],
    },
  };
}

/** Dozvola je podatak, ne rasuti uslov (A3.3.5). Za R0 je dovoljna provjera role. */
export function hasRole(ctx: AuthContext, role: string): boolean {
  return ctx.roles.includes(role);
}
