/**
 * Sesije kao uređaji (spec 01 §1.6) — servis.
 *
 * Pravila koja ovaj modul drži:
 *   - korisnik vidi SAMO svoje sesije; admin vidi sesije korisnika SVOJE firme;
 *   - „odjavi sve ostale“ ostavlja TAČNO tekuću sesiju;
 *   - admin opoziv nosi obavezan razlog (`session.revoked_admin`, klasa ACCESS);
 *   - opozvana sesija prestaje važiti ODMAH: `authenticate` čita bazu na svakom zahtjevu,
 *     pa se ne čeka istek access tokena.
 *
 * Šta se NIKAD ne vraća: `token_hash` i sirovi `user_agent`. Klijentu treba oznaka uređaja
 * (`describeDevice`) i podaci za odluku — hash tokena je tajna, a puni UA je nečitljiv.
 */
import type { Pool } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { describeDevice, deviceFingerprint, sessionsToRevokeOthers } from "@gradix/domain";
import { writeAudit, ipHash } from "./audit";

export type SessionRow = {
  id: string;
  deviceLabel: string;
  deviceHash: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
};

type RawSession = {
  id: string;
  user_agent: string | null;
  device_label: string | null;
  device_hash: string | null;
  last_seen_at: Date;
  created_at: Date;
  expires_at: Date;
};

function toRow(row: RawSession, currentSessionId: string): SessionRow {
  return {
    id: row.id,
    // `device_label` je ono što je korisnik vidio pri prijavi; fallback je izveden iz UA.
    deviceLabel: row.device_label?.trim() || describeDevice(row.user_agent),
    deviceHash: row.device_hash,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    isCurrent: row.id === currentSessionId,
  };
}

/** Aktivne sesije korisnika, najsvježija prva. */
export async function listSessions(
  pool: Pool,
  companyId: CompanyId,
  userId: string,
  currentSessionId: string,
): Promise<SessionRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query<RawSession>(
      `SELECT id, user_agent, device_label, device_hash, last_seen_at, created_at, expires_at
         FROM sessions
        WHERE user_id = $1 AND company_id = $2
          AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_seen_at DESC`,
      [userId, companyId],
    );
    return result.rows.map((row) => toRow(row, currentSessionId));
  });
}

/**
 * Opoziv jedne sesije od strane VLASNIKA sesije. Tuđu sesiju ne može opozvati: upit traži
 * `user_id = ctx.userId`, pa ID iz tuđe firme ili tuđeg naloga vraća 0 redova.
 */
export async function revokeOwnSession(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; sessionId: string },
  targetSessionId: string,
  ip?: string,
): Promise<{ ok: true; revoked: number } | { ok: false; code: "NOT_FOUND" }> {
  if (targetSessionId === ctx.sessionId) {
    // Odjava tekuće sesije ide kroz `/api/auth/logout`, ne ovdje — inače bi korisnik
    // „opozvao“ sebe i ostao na ekranu bez sesije, sa čudnom porukom.
    return { ok: false, code: "NOT_FOUND" };
  }
  return withCompany(pool, ctx.companyId, async (client) => {
    const result = await client.query(
      `UPDATE sessions
          SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND company_id = $3 AND revoked_at IS NULL
        RETURNING id`,
      [targetSessionId, ctx.userId, ctx.companyId],
    );
    const revoked = result.rowCount ?? 0;
    if (revoked === 0) return { ok: false as const, code: "NOT_FOUND" as const };

    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: null,
      action: "session.revoked_self",
      entityType: "session",
      entityId: targetSessionId,
      metadata: {},
      ipHash: ip ? ipHash(ip) : null,
    });
    return { ok: true as const, revoked };
  });
}

/** „Odjavi sve ostale“ — tekuća sesija ostaje. */
export async function revokeOtherSessions(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; sessionId: string },
  ip?: string,
): Promise<{ ok: true; revoked: number }> {
  return withCompany(pool, ctx.companyId, async (client) => {
    const active = await client.query<{ id: string }>(
      `SELECT id FROM sessions
        WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [ctx.userId, ctx.companyId],
    );
    const targets = sessionsToRevokeOthers(active.rows, ctx.sessionId);
    if (targets.length === 0) return { ok: true as const, revoked: 0 };

    const result = await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE id = ANY($1) AND user_id = $2 AND company_id = $3 AND revoked_at IS NULL`,
      [targets, ctx.userId, ctx.companyId],
    );
    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: null,
      action: "session.revoked_self",
      entityType: "user",
      entityId: ctx.userId,
      metadata: { revoked: result.rowCount ?? 0, scope: "others" },
      ipHash: ip ? ipHash(ip) : null,
    });
    return { ok: true as const, revoked: result.rowCount ?? 0 };
  });
}

/** Admin pregled sesija korisnika svoje firme. */
export async function listUserSessions(
  pool: Pool,
  companyId: CompanyId,
  targetUserId: string,
): Promise<{ deviceLabel: string; sessions: SessionRow[] }> {
  return withCompany(pool, companyId, async (client) => {
    const member = await client.query<{ id: string }>(
      `SELECT m.user_id AS id FROM memberships m
        WHERE m.user_id = $1 AND m.company_id = $2`,
      [targetUserId, companyId],
    );
    if (!member.rows[0]) return { deviceLabel: "", sessions: [] };
    const result = await client.query<RawSession>(
      `SELECT id, user_agent, device_label, device_hash, last_seen_at, created_at, expires_at
         FROM sessions
        WHERE user_id = $1 AND company_id = $2
          AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_seen_at DESC`,
      [targetUserId, companyId],
    );
    return {
      deviceLabel: "",
      // `isCurrent` je za admina uvijek false: on gleda TUĐE sesije, nijedna nije njegova.
      sessions: result.rows.map((row) => toRow(row, "")),
    };
  });
}

/**
 * Admin opoziv: obavezan razlog i audit sa klasom ACCESS (5 g.).
 *
 * Zašto je razlog obavezan: opoziv tuđe sesije je akcija koja liči na napad (neko izgura
 * drugoga). Bez razloga u tragu, žrtva i vlasnik ne mogu razlikovati podršku od zloupotrebe.
 */
export async function revokeUserSessionAsAdmin(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; actorEmail: string | null; roles: readonly string[] },
  targetUserId: string,
  targetSessionId: string,
  reason: string,
  ip?: string,
): Promise<{ ok: true; revoked: number } | { ok: false; code: "VALIDATION_FAILED" | "NOT_FOUND"; message: string }> {
  if (reason.trim().length < 10) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Razlog je obavezan (najmanje 10 znakova)." };
  }
  return withCompany(pool, ctx.companyId, async (client) => {
    const result = await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND company_id = $3 AND revoked_at IS NULL
        RETURNING id`,
      [targetSessionId, targetUserId, ctx.companyId],
    );
    const revoked = result.rowCount ?? 0;
    if (revoked === 0) return { ok: false as const, code: "NOT_FOUND" as const, message: "Sesija nije aktivna." };

    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.roles[0] ?? null,
      action: "session.revoked_admin",
      entityType: "session",
      entityId: targetSessionId,
      metadata: { reason: reason.trim(), targetUserId },
      ipHash: ip ? ipHash(ip) : null,
      retentionClass: "ACCESS",
    });
    return { ok: true as const, revoked };
  });
}

/**
 * Prijava: opoziva stariju sesiju ISTOG uređaja (jedna aktivna po uređaju, §1.6.30).
 *
 * Zove se unutar transakcije koja upisuje novu sesiju, pa nema trenutka u kojem su dvije
 * aktivne. Otisak je familija pretraživača, ne cijeli UA — vidi `deviceFingerprint`.
 */
export async function supersedeSameDevice(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }> },
  input: { userId: string; companyId: CompanyId; userAgent: string | null },
): Promise<number> {
  const fingerprint = deviceFingerprint(input.userAgent);
  const result = await client.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND company_id = $2 AND device_hash = $3 AND revoked_at IS NULL`,
    [input.userId, input.companyId, fingerprint],
  );
  return result.rowCount ?? 0;
}

export { deviceFingerprint };
