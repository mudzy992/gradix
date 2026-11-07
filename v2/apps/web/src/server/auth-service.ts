/**
 * Prijava, refresh, odjava — serverska logika.
 *
 * Pravila (ADR 0005):
 *  - lozinka se provjerava Argon2id-om; neuspjeh je isti odgovor bez obzira postoji li nalog
 *  - refresh rotira: stari token se opoziva u ISTOJ transakciji u kojoj nastaje novi
 *  - ponovna upotreba opozvanog tokena gasi SVE sesije korisnika (AUTH_REFRESH_REUSE)
 *  - firma dolazi iz membershipa, nikad iz zahtjeva
 */
import { withCompany, type CompanyId } from "@gradix/db";
import { decideRefresh, refreshExpiry } from "@gradix/domain";
import { lookupMemberships, lookupSessionByHash } from "./auth-lookup";
import { getVerifiedPool } from "./db";
import { hashRefreshToken, newRefreshToken } from "./session";

export type LoginFailure =
  | { code: "AUTH_INVALID_CREDENTIALS" }
  | { code: "AUTH_COMPANY_INACTIVE" }
  | { code: "FORBIDDEN"; message: string };

export type LoginSuccess = {
  userId: string;
  companyId: CompanyId;
  sessionId: string;
  refreshToken: string;
  mustChangePassword: boolean;
  roles: string[];
  displayName: string;
};

export async function login(
  email: string,
  password: string,
  verify: (hash: string, password: string) => Promise<boolean>,
  now = new Date(),
): Promise<LoginSuccess | LoginFailure> {
  const pool = await getVerifiedPool();
  const normalized = email.trim().toLowerCase();

  // `users` nije tenant tabela: identitet je globalan (jedan email = jedan nalog).
  const userResult = await pool.query<{
    id: string;
    password_hash: string;
    is_active: boolean;
    must_change_password: boolean;
    first_name: string;
    last_name: string;
  }>(
    "SELECT id, password_hash, is_active, must_change_password, first_name, last_name FROM users WHERE lower(email) = $1",
    [normalized],
  );
  const user = userResult.rows[0];

  // Uvijek se radi hash provjera (i za nepostojeći nalog), da vrijeme odgovora ne oda postojanje.
  const hash = user?.password_hash ?? "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$0000000000000000000000000000000000000000000";
  const passwordOk = await verify(hash, password);
  if (!user || !passwordOk || !user.is_active) return { code: "AUTH_INVALID_CREDENTIALS" };

  // Membership lookup ide kroz usku RLS politiku za pretragu (vidi auth-lookup.ts).
  const memberships = await lookupMemberships(pool, user.id);
  const membership = memberships.find((row) => row.company_active) ?? memberships[0];
  if (!membership) return { code: "FORBIDDEN", message: "Nalog nije povezan s aktivnom firmom." };
  if (!membership.company_active) return { code: "AUTH_COMPANY_INACTIVE" };

  const refreshToken = newRefreshToken();
  const sessionId = await withCompany(pool, membership.company_id as CompanyId, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sessions (id, user_id, company_id, token_hash, expires_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4) RETURNING id`,
      [user.id, membership.company_id, hashRefreshToken(refreshToken), refreshExpiry(now)],
    );
    return inserted.rows[0]?.id ?? "";
  });

  return {
    userId: user.id,
    companyId: membership.company_id as CompanyId,
    sessionId,
    refreshToken,
    mustChangePassword: user.must_change_password,
    roles: membership.roles,
    displayName: `${user.first_name} ${user.last_name}`.trim(),
  };
}

export type RefreshResult =
  | { ok: true; userId: string; companyId: CompanyId; sessionId: string; refreshToken: string }
  | { ok: false; code: "AUTH_REFRESH_INVALID" | "AUTH_REFRESH_REUSE" };

export async function rotateRefresh(token: string, now = new Date()): Promise<RefreshResult> {
  const pool = await getVerifiedPool();
  const tokenHash = hashRefreshToken(token);

  // Bez tenanta se ne zna firma, a `sessions` je RLS tabela. Zato prvo nalazimo
  // sesiju po hashu tokena (ne po korisniku iz zahtjeva) kroz usku lookup politiku.
  const session = await lookupSessionByHash(pool, tokenHash);
  const decision = decideRefresh(
    session ? { expiresAt: session.expires_at, revokedAt: session.revoked_at } : null,
    now,
  );

  if (decision.kind === "reject") return { ok: false, code: "AUTH_REFRESH_INVALID" };
  if (decision.kind === "reuse") {
    // Krađa ili dupli zahtjev: gase se sve sesije korisnika, ne samo ova.
    await revokeAllForUser(session!.user_id, session!.company_id as CompanyId, now);
    return { ok: false, code: "AUTH_REFRESH_REUSE" };
  }

  const nextToken = newRefreshToken();
  const rotated = await withCompany(pool, session!.company_id as CompanyId, async (client) => {
    // Atomski claim: drugi paralelni zahtjev sa istim tokenom ne smije proći.
    const claimed = await client.query(
      "UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL RETURNING id",
      [now, session!.id],
    );
    if (claimed.rowCount === 0) return false;
    await client.query(
      `INSERT INTO sessions (id, user_id, company_id, token_hash, expires_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4)`,
      [session!.user_id, session!.company_id, hashRefreshToken(nextToken), refreshExpiry(now)],
    );
    return true;
  });

  if (!rotated) return { ok: false, code: "AUTH_REFRESH_REUSE" };
  return {
    ok: true,
    userId: session!.user_id,
    companyId: session!.company_id as CompanyId,
    sessionId: session!.id,
    refreshToken: nextToken,
  };
}

export async function revokeSession(sessionId: string, companyId: CompanyId, now = new Date()): Promise<void> {
  await withCompany(await getVerifiedPool(), companyId, async (client) => {
    await client.query("UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", [now, sessionId]);
  });
}

export async function revokeAllForUser(userId: string, companyId: CompanyId, now = new Date()): Promise<void> {
  await withCompany(await getVerifiedPool(), companyId, async (client) => {
    await client.query("UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL", [now, userId]);
  });
}
