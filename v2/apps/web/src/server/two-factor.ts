/**
 * Dvofaktorska autentikacija (spec 01 §1.5) — servis.
 *
 * Tri stvari koje ovaj modul drži na jednom mjestu, jer svaka od njih može tiho pokvariti
 * sigurnost:
 *   1. **tajna se nikad ne vraća** poslije uparivanja; postoji kao šifrat i kao `otpauth://`
 *      URI tačno jednom, u odgovoru na `/enroll`;
 *   2. **kod se troši** (`last_used_step`): isti kod ne radi dva puta u istih 30 s;
 *   3. **recovery kod vrijedi jednom** (`used_at`), i svaka upotreba ostavlja audit zapis —
 *      inače „izgubio sam telefon“ postaje način da se zaobiđe 2FA bez traga.
 *
 * Ključ za šifrovanje dolazi iz `AUTH_SECRET`. Rotacija tog tajnog ključa obara sve 2FA
 * tajne (ponovno uparivanje) — to je namjerno i piše u `docs/COOLIFY.md`.
 */
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  requires2fa,
  totpUri,
  twoFactorGate,
  verifyTotp,
} from "@gradix/domain";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { writeAudit, ipHash } from "./audit";
import { loadConfig } from "./config";
import { getVerifiedPool } from "./db";

export type TotpFailure =
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "FORBIDDEN"; message: string }
  | { code: "AUTH_2FA_INVALID"; message: string }
  | { code: "CONFLICT"; message: string };

/** Recovery kod se u bazi drži kao SHA-256 (32 bajta entropije — Argon2 bi bio rasipanje). */
function recoveryHash(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code), "utf8").digest("hex");
}

function authSecret(): string {
  return loadConfig().AUTH_SECRET;
}

/** Ime izdavaoca u authenticator aplikaciji; ne mijenjati bez razloga (korisnici ga vide). */
export const TOTP_ISSUER = "Gradix";

export type Enrollment = {
  /** `otpauth://` URI — jedini put da tajna postoji van baze. */
  uri: string;
  /** Ista tajna u base32, za ručni unos kad kamera ne radi. */
  secret: string;
};

/**
 * Prvi korak uparivanja: pravi (ili zamjenjuje NEpotvrđenu) tajnu.
 *
 * Zašto zamjenjuje nepotvrđenu: ako je korisnik počeo uparivanje i odustao, stara tajna
 * nije vezana ni za jedan autentikator i samo smeta. Potvrđena tajna se NE dira — za to
 * postoji reset (admin, uz razlog).
 */
export async function beginEnrollment(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; email: string },
): Promise<Enrollment | TotpFailure> {
  return withCompany(pool, ctx.companyId, async (client) => {
    const existing = await client.query<{ confirmed_at: Date | null }>(
      "SELECT confirmed_at FROM user_totp WHERE user_id = $1",
      [ctx.userId],
    );
    if (existing.rows[0]?.confirmed_at) {
      return {
        code: "CONFLICT",
        message: "2FA je već uključena. Isključite je prije ponovnog uparivanja.",
      } as TotpFailure;
    }

    const secret = generateTotpSecret();
    await client.query(
      `INSERT INTO user_totp (id, user_id, secret_enc)
       VALUES (gen_random_uuid()::text, $1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET secret_enc = EXCLUDED.secret_enc, confirmed_at = NULL,
             last_used_step = NULL, updated_at = now()`,
      [ctx.userId, encryptTotpSecret(secret, authSecret())],
    );

    return { uri: totpUri({ secret, account: ctx.email, issuer: TOTP_ISSUER }), secret };
  });
}

/**
 * Drugi korak: potvrda prvim kodom. Tek sada je 2FA uključena (`users.totp_enabled`).
 *
 * Recovery kodovi se vraćaju TAČNO JEDNOM, u ovom odgovoru. Ako ih korisnik izgubi prije
 * nego ih prepiše, ostaje mu admin reset — namjerno, jer ponovni prikaz znači da negdje
 * postoje u čitljivom obliku.
 */
export async function confirmEnrollment(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; ip?: string },
  code: string,
): Promise<{ ok: true; recoveryCodes: string[] } | TotpFailure> {
  const auth = authSecret();
  return withCompany(pool, ctx.companyId, async (client) => {
    const row = await client.query<{ secret_enc: string; confirmed_at: Date | null }>(
      "SELECT secret_enc, confirmed_at FROM user_totp WHERE user_id = $1",
      [ctx.userId],
    );
    const enrollment = row.rows[0];
    if (!enrollment) {
      return { code: "VALIDATION_FAILED", message: "Uparivanje nije započeto." } as TotpFailure;
    }
    if (enrollment.confirmed_at) {
      return { code: "CONFLICT", message: "2FA je već potvrđena." } as TotpFailure;
    }

    const secret = decryptTotpSecret(enrollment.secret_enc, auth);
    const verified = verifyTotp(code, secret);
    if (!verified.ok) {
      return { code: "AUTH_2FA_INVALID", message: "Kod nije ispravan. Provjerite sat na telefonu." } as TotpFailure;
    }

    const codes = generateRecoveryCodes();
    await client.query(
      `UPDATE user_totp
          SET confirmed_at = now(), last_used_step = $2, updated_at = now()
        WHERE user_id = $1`,
      [ctx.userId, verified.step],
    );
    await client.query("UPDATE users SET totp_enabled = true, must_enroll_2fa = false WHERE id = $1", [
      ctx.userId,
    ]);
    // Stari kodovi (ako ih je bilo) ne važe: novi set zamjenjuje sve.
    await client.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [ctx.userId]);
    for (const recoveryCode of codes) {
      await client.query(
        `INSERT INTO user_recovery_codes (id, user_id, code_hash)
         VALUES (gen_random_uuid()::text, $1, $2)`,
        [ctx.userId, recoveryHash(recoveryCode)],
      );
    }

    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: null,
      action: "user.2fa_enabled",
      entityType: "user",
      entityId: ctx.userId,
      metadata: { recoveryCodes: codes.length },
      ipHash: ctx.ip ? ipHash(ctx.ip) : null,
    });

    return { ok: true as const, recoveryCodes: codes };
  });
}

/**
 * Provjera koda pri prijavi. `step` se pamti da isti kod ne prođe dva puta.
 *
 * Poziva se IZ login rute, nakon što je lozinka provjerena, sa `app.company_id` već
 * postavljenim (tenant je poznat iz membershipa).
 */
export async function verifyLoginCode(
  client: PoolClient,
  userId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: "FORMAT" | "MISMATCH" | "REPLAY" | "NO_TOTP" }> {
  const row = await client.query<{ secret_enc: string; last_used_step: string | null; confirmed_at: Date | null }>(
    "SELECT secret_enc, last_used_step, confirmed_at FROM user_totp WHERE user_id = $1",
    [userId],
  );
  const totp = row.rows[0];
  if (!totp?.confirmed_at) return { ok: false, reason: "NO_TOTP" };

  const secret = decryptTotpSecret(totp.secret_enc, authSecret());
  const result = verifyTotp(code, secret, {
    lastUsedStep: totp.last_used_step === null ? null : Number(totp.last_used_step),
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  await client.query("UPDATE user_totp SET last_used_step = $2, updated_at = now() WHERE user_id = $1", [
    userId,
    result.step,
  ]);
  return { ok: true };
}

/**
 * Recovery kod: atomski claim (`used_at IS NULL`), pa audit.
 *
 * Vraća `false` i kad kod ne postoji i kad je potrošen — ista poruka. Razlika bi rekla
 * napadaču koji je kod već upotrijebljen.
 */
export async function consumeRecoveryCode(
  client: PoolClient,
  userId: string,
  code: string,
  companyId: CompanyId,
  ip?: string,
): Promise<boolean> {
  const claimed = await client.query(
    `UPDATE user_recovery_codes
        SET used_at = now()
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
      RETURNING id`,
    [userId, recoveryHash(code)],
  );
  if ((claimed.rowCount ?? 0) === 0) return false;

  // Potrošnja recovery koda je sigurnosni događaj: ide u audit sa ACCESS klasom (5 g.).
  await writeAudit(client, {
    companyId,
    actorId: userId,
    actorEmail: null,
    action: "user.2fa_recovery_used",
    entityType: "user",
    entityId: userId,
    metadata: { remaining: await remainingRecoveryCodes(client, userId) },
    ipHash: ip ? ipHash(ip) : null,
    retentionClass: "ACCESS",
  });
  return true;
}

/**
 * Je li ova osoba još u „uparivanje 2FA" stanju (gate `ENROLL`).
 *
 * Postoji jer `refresh` izdaje NOVI access token: bez ponovne provjere iz baze bi sesija
 * za uparivanje, nakon prvog osvježavanja tokena, postala puna sesija — obavezna 2FA bi se
 * zaobišla jednim `POST /api/auth/refresh`. Stanje se zato UVIJEK čita iz baze, nikad iz tokena.
 */
export async function enrollmentPendingFor(
  pool: Pool,
  userId: string,
  companyId: CompanyId,
): Promise<boolean> {
  return withCompany(pool, companyId, async (client) => {
    const row = await client.query<{
      roles: string[];
      totp_enabled: boolean;
      must_enroll_2fa: boolean;
    }>(
      `SELECT m.roles::text[] AS roles,
              COALESCE(t.confirmed_at IS NOT NULL, false) AS totp_enabled,
              u.must_enroll_2fa
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN user_totp t ON t.user_id = u.id
        WHERE m.user_id = $1 AND m.company_id = $2 AND m.is_active`,
      [userId, companyId],
    );
    const membership = row.rows[0];
    if (!membership) return false;
    return (
      twoFactorGate({
        roles: membership.roles,
        totpEnabled: membership.totp_enabled,
        mustEnroll: membership.must_enroll_2fa,
      }) === "ENROLL"
    );
  });
}

export async function remainingRecoveryCodes(client: PoolClient, userId: string): Promise<number> {
  const row = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL",
    [userId],
  );
  return Number(row.rows[0]?.count ?? 0);
}

/**
 * Isključivanje 2FA — dozvoljeno SAMO ako rola to ne traži (spec 01 §1.5.21).
 * OWNER/ADMIN/ACCOUNTANT ne mogu isključiti 2FA; to bi bilo samoubistvo pravila.
 */
export async function disableTwoFactor(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; roles: readonly string[]; ip?: string },
  input: { passwordOk: boolean; code: string },
): Promise<{ ok: true } | TotpFailure> {
  if (requires2fa(ctx.roles)) {
    return {
      code: "FORBIDDEN",
      message: "Vaša rola zahtijeva 2FA. Isključivanje nije moguće.",
    };
  }
  if (!input.passwordOk) {
    return { code: "FORBIDDEN", message: "Potvrdite lozinku da isključite 2FA." };
  }

  return withCompany(pool, ctx.companyId, async (client) => {
    const row = await client.query<{ secret_enc: string; last_used_step: string | null; confirmed_at: Date | null }>(
      "SELECT secret_enc, last_used_step, confirmed_at FROM user_totp WHERE user_id = $1",
      [ctx.userId],
    );
    const totp = row.rows[0];
    if (!totp?.confirmed_at) {
      return { code: "CONFLICT", message: "2FA nije uključena." } as TotpFailure;
    }
    const verified = verifyTotp(input.code, decryptTotpSecret(totp.secret_enc, authSecret()), {
      lastUsedStep: totp.last_used_step === null ? null : Number(totp.last_used_step),
    });
    if (!verified.ok) {
      return { code: "AUTH_2FA_INVALID", message: "Kod nije ispravan." } as TotpFailure;
    }

    await client.query("DELETE FROM user_totp WHERE user_id = $1", [ctx.userId]);
    await client.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [ctx.userId]);
    await client.query("UPDATE users SET totp_enabled = false, must_enroll_2fa = false WHERE id = $1", [
      ctx.userId,
    ]);
    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: null,
      action: "user.2fa_disabled",
      entityType: "user",
      entityId: ctx.userId,
      metadata: {},
      ipHash: ctx.ip ? ipHash(ctx.ip) : null,
    });
    return { ok: true as const };
  });
}

/**
 * Reset 2FA od strane admina (izgubljen telefon): briše tajnu i traži PONOVNO uparivanje
 * pri sljedećoj prijavi. Razlog je obavezan, jer je ovo radnja koja slabi zaštitu naloga.
 */
export async function resetTwoFactor(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; actorEmail: string | null; ip?: string },
  targetUserId: string,
  reason: string,
): Promise<{ ok: true } | TotpFailure> {
  if (reason.trim().length < 10) {
    return { code: "VALIDATION_FAILED", message: "Razlog je obavezan (najmanje 10 znakova)." };
  }
  return withCompany(pool, ctx.companyId, async (client) => {
    const target = await client.query<{ id: string }>(
      // Tenant predikat je u WHERE (B1 pravilo), ne samo u JOIN ON.
      `SELECT u.id FROM users u
         JOIN memberships m ON m.user_id = u.id AND m.company_id = $2
        WHERE u.id = $1 AND m.company_id = $2`,
      [targetUserId, ctx.companyId],
    );
    if (!target.rows[0]) return { code: "FORBIDDEN", message: "Korisnik nije u vašoj firmi." } as TotpFailure;

    await client.query("DELETE FROM user_totp WHERE user_id = $1", [targetUserId]);
    await client.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [targetUserId]);
    await client.query(
      "UPDATE users SET totp_enabled = false, must_enroll_2fa = true WHERE id = $1",
      [targetUserId],
    );
    await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL", [
      targetUserId,
      ctx.companyId,
    ]);
    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      action: "user.2fa_reset",
      entityType: "user",
      entityId: targetUserId,
      metadata: { reason: reason.trim() },
      ipHash: ctx.ip ? ipHash(ctx.ip) : null,
      retentionClass: "ACCESS",
    });
    return { ok: true as const };
  });
}

/** Stanje 2FA korisnika za ekran i za prijavu (bez tajne). */
export async function twoFactorStatus(
  pool: Pool,
  companyId: CompanyId,
  userId: string,
): Promise<{ enabled: boolean; pendingEnrollment: boolean; recoveryCodesLeft: number }> {
  return withCompany(pool, companyId, async (client) => {
    const row = await client.query<{ confirmed_at: Date | null; totp_enabled: boolean }>(
      `SELECT t.confirmed_at, u.totp_enabled
         FROM users u LEFT JOIN user_totp t ON t.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    const enabled = Boolean(row.rows[0]?.totp_enabled && row.rows[0]?.confirmed_at);
    return {
      enabled,
      pendingEnrollment: !enabled && Boolean(row.rows[0]?.confirmed_at === null),
      recoveryCodesLeft: enabled ? await remainingRecoveryCodes(client, userId) : 0,
    };
  });
}

export { getVerifiedPool };
