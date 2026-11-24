/**
 * Prijava, refresh, odjava — serverska logika.
 *
 * Pravila (ADR 0005):
 *  - lozinka se provjerava Argon2id-om; neuspjeh je isti odgovor bez obzira postoji li nalog
 *  - refresh rotira: stari token se opoziva u ISTOJ transakciji u kojoj nastaje novi
 *  - ponovna upotreba opozvanog tokena gasi SVE sesije korisnika (AUTH_REFRESH_REUSE)
 *  - firma dolazi iz membershipa, nikad iz zahtjeva
 */
import type { Pool } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import {
  ACCOUNT_LOCK_ATTEMPTS,
  ACCOUNT_LOCK_MINUTES,
  decideRefresh,
  describeDevice,
  deviceFingerprint,
  refreshExpiry,
  twoFactorGate,
} from "@gradix/domain";
import { ipHash } from "./audit";
import { lookupMemberships, lookupSessionByHash, lookupUserByEmail } from "./auth-lookup";
import { getVerifiedPool } from "./db";
import { hashRefreshToken, newRefreshToken } from "./session";

export type LoginFailure =
  | { code: "AUTH_INVALID_CREDENTIALS" }
  | { code: "AUTH_COMPANY_INACTIVE" }
  | { code: "AUTH_ACCOUNT_LOCKED"; retryAfterSeconds: number }
  | { code: "FORBIDDEN"; message: string }
  /**
   * Lozinka je ispravna, ali prijava nije gotova: traži se 2FA kod (`VERIFY`) ili
   * uparivanje (`ENROLL`). Ruta izdaje pre-auth token, NE sesiju.
   */
  | {
      code: "AUTH_2FA_REQUIRED";
      gate: "VERIFY" | "ENROLL";
      userId: string;
      companyId: CompanyId;
    };

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
  /** UA i IP se pamte uz sesiju da korisnik prepozna uređaj i da admin vidi odakle je prijava. */
  device: { userAgent?: string | null; ip?: string | null } = {},
): Promise<LoginSuccess | LoginFailure> {
  const pool = await getVerifiedPool();
  const normalized = email.trim().toLowerCase();

  // RLS na globalnom users registru dopušta samo tačan email lookup prije tenanta.
  const user = await lookupUserByEmail(pool, normalized);

  // Zaključavanje naloga: provjerava se PRIJE hasha da se ne troši 40 ms Argon2 na nalog
  // koji ionako ne može proći, i da poruka ne ovisi o tome postoji li email.
  if (user?.locked_until && user.locked_until.getTime() > now.getTime()) {
    return {
      code: "AUTH_ACCOUNT_LOCKED",
      retryAfterSeconds: Math.max(1, Math.ceil((user.locked_until.getTime() - now.getTime()) / 1000)),
    };
  }

  // Uvijek se radi hash provjera (i za nepostojeći nalog), da vrijeme odgovora ne oda postojanje.
  const hash = user?.password_hash ?? "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$0000000000000000000000000000000000000000000";
  const passwordOk = await verify(hash, password);
  if (!user || !passwordOk || !user.is_active) {
    if (user) await recordFailure(pool, user.id, now);
    return { code: "AUTH_INVALID_CREDENTIALS" };
  }
  // Uspješna lozinka resetuje brojač: prag od 10 je za UZASTOPNE promašaje.
  if (user.failed_login_count > 0) {
    await pool.query("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1", [user.id]);
  }

  // Membership lookup ide kroz usku RLS politiku za pretragu (vidi auth-lookup.ts).
  const memberships = await lookupMemberships(pool, user.id);
  const membership = memberships.find((row) => row.company_active) ?? memberships[0];
  if (!membership) return { code: "FORBIDDEN", message: "Nalog nije povezan s aktivnom firmom." };
  if (!membership.company_active) return { code: "AUTH_COMPANY_INACTIVE" };

  /*
   * 2FA vrata (spec 01 §1.5). Redoslijed: lozinka → 2FA → sesija.
   *
   * Bez ovoga bi obavezna rola imala 2FA samo na papiru: lozinka bi bila dovoljna i
   * napadač sa ukradenom lozinkom bi ušao bez telefona.
   */
  const gate = twoFactorGate({
    roles: membership.roles as string[],
    totpEnabled: user.totp_enabled,
    mustEnroll: user.must_enroll_2fa,
  });
  if (gate !== "NONE") {
    return {
      code: "AUTH_2FA_REQUIRED",
      gate,
      userId: user.id,
      companyId: membership.company_id as CompanyId,
    };
  }

  const refreshToken = newRefreshToken();
  const fingerprint = deviceFingerprint(device.userAgent ?? null);
  const sessionId = await withCompany(pool, membership.company_id as CompanyId, async (client) => {
    // Jedna aktivna sesija po UREĐAJU (§1.6.30): nova prijava gasi stariju sa istog otiska.
    // Ide u istoj transakciji, pa ne postoji trenutak sa dvije aktivne sesije.
    await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND company_id = $2 AND device_hash = $3 AND revoked_at IS NULL`,
      [user.id, membership.company_id, fingerprint],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sessions
         (id, user_id, company_id, token_hash, expires_at, pwd_change_required,
          user_agent, device_label, device_hash, ip_hash, last_seen_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        user.id,
        membership.company_id,
        hashRefreshToken(refreshToken),
        refreshExpiry(now),
        user.must_change_password,
        device.userAgent ?? null,
        describeDevice(device.userAgent ?? null),
        fingerprint,
        device.ip ? ipHash(device.ip) : null,
        now,
      ],
    );
    await client.query("UPDATE users SET last_login_at = $1 WHERE id = $2", [now, user.id]);
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
      "UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND company_id = $3 AND revoked_at IS NULL RETURNING id",
      [now, session!.id, session!.company_id],
    );
    if (claimed.rowCount === 0) return false;
    // Rotirana sesija nasljeđuje uređaj: bez toga bi svaki refresh bio „nov uređaj“ i
    // lista sesija bi se punila duplikatima.
    await client.query(
      `INSERT INTO sessions
         (id, user_id, company_id, token_hash, expires_at, pwd_change_required,
          user_agent, device_label, device_hash, ip_hash, last_seen_at)
       SELECT gen_random_uuid()::text, $1, $2, $3, $4, u.must_change_password,
              s.user_agent, s.device_label, s.device_hash, s.ip_hash, now()
         FROM users u, sessions s
        WHERE u.id = $1 AND s.id = $5`,
      [session!.user_id, session!.company_id, hashRefreshToken(nextToken), refreshExpiry(now), session!.id],
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
    await client.query(
      "UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND company_id = $3 AND revoked_at IS NULL",
      [now, sessionId, companyId],
    );
  });
}

export async function revokeAllForUser(userId: string, companyId: CompanyId, now = new Date()): Promise<void> {
  await withCompany(await getVerifiedPool(), companyId, async (client) => {
    await client.query(
      "UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND company_id = $3 AND revoked_at IS NULL",
      [now, userId, companyId],
    );
  });
}

/**
 * Broji promašaj i zaključava nalog na 15 minuta poslije 10. Uz brojač se pamti i
 * `locked_until` (vrijeme), ne stanje — istek se ne mora „resetovati“ poslom.
 *
 * `GREATEST` na brojaču: dva paralelna promašaja ne smiju izgubiti jedan.
 */
export async function recordFailure(pool: Pool, userId: string, now = new Date()): Promise<void> {
  await pool.query(
    `UPDATE users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE
              WHEN failed_login_count + 1 >= $2 THEN $3::timestamptz + ($4::int * INTERVAL '1 minute')
              ELSE locked_until
            END
      WHERE id = $1`,
    [userId, ACCOUNT_LOCK_ATTEMPTS, now, ACCOUNT_LOCK_MINUTES],
  );
}

/**
 * Završetak prijave poslije 2FA: pravi sesiju. Odvojeno od `login()` jer se između dva
 * koraka ne smije otvoriti sesija — pre-auth token nosi samo dokaz o lozinci.
 */
export async function completeTwoFactorLogin(
  userId: string,
  companyId: CompanyId,
  device: { userAgent?: string | null; ip?: string | null } = {},
  now = new Date(),
): Promise<LoginSuccess | LoginFailure> {
  const pool = await getVerifiedPool();
  const memberships = await lookupMemberships(pool, userId);
  const membership = memberships.find((row) => row.company_id === companyId);
  if (!membership || !membership.company_active) {
    return { code: "AUTH_COMPANY_INACTIVE" };
  }

  const profile = await withCompany(pool, companyId, async (client) => {
    const result = await client.query<{
      first_name: string;
      last_name: string;
      must_change_password: boolean;
      must_enroll_2fa: boolean;
    }>("SELECT first_name, last_name, must_change_password, must_enroll_2fa FROM users WHERE id = $1", [userId]);
    return result.rows[0] ?? null;
  });
  if (!profile) return { code: "AUTH_INVALID_CREDENTIALS" };

  const refreshToken = newRefreshToken();
  const fingerprint = deviceFingerprint(device.userAgent ?? null);
  const sessionId = await withCompany(pool, companyId, async (client) => {
    await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND company_id = $2 AND device_hash = $3 AND revoked_at IS NULL`,
      [userId, companyId, fingerprint],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sessions
         (id, user_id, company_id, token_hash, expires_at, pwd_change_required,
          user_agent, device_label, device_hash, ip_hash, last_seen_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        userId,
        companyId,
        hashRefreshToken(refreshToken),
        refreshExpiry(now),
        profile.must_change_password,
        device.userAgent ?? null,
        describeDevice(device.userAgent ?? null),
        fingerprint,
        device.ip ? ipHash(device.ip) : null,
        now,
      ],
    );
    await client.query("UPDATE users SET last_login_at = $1 WHERE id = $2", [now, userId]);
    return inserted.rows[0]?.id ?? "";
  });

  return {
    userId,
    companyId,
    sessionId,
    refreshToken,
    mustChangePassword: profile.must_change_password,
    roles: membership.roles,
    displayName: "",
  };
}
