/**
 * R1a servis: pozivnice, reset lozinke, promjena lozinke, deaktivacija.
 *
 * Sve tenant operacije idu kroz `withCompany` (RLS). Dvije operacije rade PRIJE prijave
 * (prihvatanje pozivnice i postavljanje lozinke preko linka) — one idu kroz uske lookup
 * funkcije iz `access-lookup.ts`, koje postavljaju `app.invite_lookup_token` /
 * `app.reset_lookup_token` u `SET LOCAL`, pa politika propušta tačno jedan red.
 *
 * Token se vraća pozivaocu TAČNO jednom, u povratnoj vrijednosti. Nigdje se ne loguje,
 * ne upisuje u audit i ne čuva u bazi (tamo je samo SHA-256).
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { writeAudit, ipHash } from "./audit";
import { hashPassword, checkPasswordPolicy, verifyPassword } from "./password";
import { generateToken, hashToken, tokenExpiry, TOKEN_TTL_HOURS } from "./tokens";
import { isScope } from "@gradix/domain";

import type { Role, Scope } from "./permissions";
export type { Role, Scope };

export type Actor = { userId: string; roles: string[] };

export type ServiceError =
  | { code: "FORBIDDEN"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "CONFLICT"; message: string }
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "AUTH_PASSWORD_CHANGE_REQUIRED"; message: string }
  | { code: "LINK_INVALID"; message: string };

/* ------------------------------------------------------------------ korisnici */

export type UserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  scope: string;
  createdAt: Date;
};

export async function listUsers(pool: Pool, companyId: CompanyId): Promise<UserRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      is_active: boolean;
      must_change_password: boolean;
      roles: string[];
      scope: string;
      created_at: Date;
    }>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.must_change_password,
              m.roles::text[] AS roles, m.scope, u.created_at
         FROM users u
         JOIN memberships m ON m.user_id = u.id
        WHERE m.company_id = $1
        ORDER BY (m.roles)[1], u.last_name, u.first_name`,
      [companyId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      isActive: row.is_active,
      mustChangePassword: row.must_change_password,
      roles: row.roles,
      scope: row.scope,
      createdAt: row.created_at,
    }));
  });
}

/** Email aktera za audit — čita se u bazi, ne vjeruje se klijentu ni praznom stringu. */
async function resolveActorEmail(client: PoolClient, userId: string): Promise<string | null> {
  const result = await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
  return result.rows[0]?.email ?? null;
}

async function loadTarget(client: PoolClient, companyId: string, userId: string) {
  const result = await client.query<{ id: string; email: string; roles: string[]; is_active: boolean }>(
    `SELECT u.id, u.email, m.roles::text[] AS roles, u.is_active
       FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE u.id = $1 AND m.company_id = $2`,
    [userId, companyId],
  );
  return result.rows[0] ?? null;
}

/* ------------------------------------------------------------------ pozivnice */

export type IssuedInvitation = {
  id: string;
  /** Sirovi token — jedini put da postoji. Ruta ga vrati u tijelu, klijent kopira. */
  token: string;
  link: string;
  email: string;
  expiresAt: Date;
};

export async function issueInvitation(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  input: { email: string; roles: Role[]; scope: Scope; baseUrl: string; ip?: string },
): Promise<IssuedInvitation | ServiceError> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { code: "VALIDATION_FAILED", message: "Email nije ispravan." };
  }
  if (input.roles.length === 0) {
    return { code: "VALIDATION_FAILED", message: "Odaberite najmanje jednu rolu." };
  }
  // Opseg ima dvije vrijednosti (odluka vlasnika 2026-11-08): `PROJECTS` se vraća u R2.
  if (!isScope(input.scope)) {
    return { code: "VALIDATION_FAILED", message: "Opseg nije ispravan." };
  }

  const token = generateToken("invite");
  const id = randomUUID();

  return withCompany(pool, companyId, async (client) => {
    const actorEmail = await resolveActorEmail(client, actor.userId);
    // Osoba koja već ima aktivan nalog u firmi ne dobija pozivnicu.
    const existing = await client.query(
      `SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id
        WHERE m.company_id = $1 AND lower(u.email) = $2`,
      [companyId, email],
    );
    if ((existing.rowCount ?? 0) > 0) {
      return { code: "CONFLICT", message: "Osoba s tim emailom je već u firmi." } as ServiceError;
    }

    // Jedna važeća pozivnica po emailu: nova opoziva prethodnu (indeks bi inače pao).
    await client.query(
      `UPDATE invitations SET revoked_at = now()
        WHERE company_id = $1 AND lower(email) = $2 AND used_at IS NULL AND revoked_at IS NULL`,
      [companyId, email],
    );

    const expiresAt = tokenExpiry();
    await client.query(
      `INSERT INTO invitations (id, company_id, email, roles, scope, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4::"Role"[], $5, $6, $7, $8)`,
      [id, companyId, email, input.roles, input.scope, hashToken(token), expiresAt, actor.userId],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail,
      action: "invitation.created",
      entityType: "invitation",
      entityId: id,
      // Namjerno BEZ tokena: samo činjenice koje smiju ostati u tragu.
      metadata: { email, roles: input.roles, scope: input.scope, expiresAt: expiresAt.toISOString() },
      ipHash: input.ip ? ipHash(input.ip) : null,
    });

    return {
      id,
      token,
      link: `${input.baseUrl.replace(/\/$/, "")}/lozinka/postavi?token=${token}`,
      email,
      expiresAt,
    };
  });
}

export type InvitationPreview = {
  email: string;
  roles: string[];
  scope: string;
  companyName: string;
  expiresAt: Date;
};

/**
 * Čitanje pozivnice PRIJE prijave. Ključ postavlja server iz hash-a primljenog tokena;
 * politika `invite_lookup` propušta najviše jedan red. Vraća samo neosjetljiva polja.
 */
export async function previewInvitation(
  pool: Pool,
  token: string,
): Promise<InvitationPreview | { code: "LINK_INVALID"; message: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.invite_lookup_token', $1, true)", [hashToken(token)]);
    const result = await client.query<{
      email: string;
      roles: string[];
      scope: string;
      expires_at: Date;
      company_name: string;
    }>(
      `SELECT i.email, i.roles::text[] AS roles, i.scope, i.expires_at, c.name AS company_name
         FROM invitations i JOIN companies c ON c.id = i.company_id
        WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
      [hashToken(token)],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row) return { code: "LINK_INVALID", message: "Link je istekao ili je već iskorišten." };
    return {
      email: row.email,
      roles: row.roles,
      scope: row.scope,
      companyName: row.company_name,
      expiresAt: row.expires_at,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Prihvatanje pozivnice: atomski claim + kreiranje korisnika/članstva + audit, u JEDNOJ
 * transakciji. Ako bilo šta padne, pozivnica ostaje neiskorištena (nema „pola naloga“).
 */
export async function acceptInvitation(
  pool: Pool,
  token: string,
  input: { firstName: string; lastName: string; password: string; ip?: string },
): Promise<{ userId: string; companyId: string; email: string } | ServiceError> {
  const policyError = checkPasswordPolicy(input.password);
  if (policyError) return { code: "VALIDATION_FAILED", message: policyError };
  if (!input.firstName.trim() || !input.lastName.trim()) {
    return { code: "VALIDATION_FAILED", message: "Ime i prezime su obavezni." };
  }

  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.invite_lookup_token', $1, true)", [hashToken(token)]);

    // Atomski claim: drugi paralelni zahtjev dobija 0 redova i isti kod greške.
    const claimed = await client.query<{
      id: string;
      company_id: string;
      email: string;
      roles: string[];
      scope: string;
    }>(
      `UPDATE invitations
          SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING id, company_id, email, roles::text[] AS roles, scope`,
      [hashToken(token)],
    );
    const invite = claimed.rows[0];
    if (!invite) {
      await client.query("ROLLBACK");
      return { code: "LINK_INVALID", message: "Link je istekao ili je već iskorišten." };
    }

    // Tenant se postavlja TEK sada, iz firme koju nosi sama pozivnica — nikad iz zahtjeva.
    // Bez ovoga bi politika na `memberships` i `audit_events` odbila upis (i treba da odbije).
    await client.query("SELECT set_config('app.company_id', $1, true)", [invite.company_id]);

    const userId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, true, false)`,
      [userId, invite.email, passwordHash, input.firstName.trim(), input.lastName.trim()],
    );
    await client.query(
      `INSERT INTO memberships (id, user_id, company_id, roles, scope, is_active)
       VALUES ($1, $2, $3, $4::"Role"[], $5, true)`,
      [randomUUID(), userId, invite.company_id, invite.roles, invite.scope],
    );

    await writeAudit(client, {
      companyId: invite.company_id,
      actorId: null,
      actorEmail: invite.email,
      action: "invitation.accepted",
      entityType: "user",
      entityId: userId,
      metadata: { invitationId: invite.id, roles: invite.roles, scope: invite.scope },
      ipHash: input.ip ? ipHash(input.ip) : null,
    });

    await client.query("COMMIT");
    return { userId, companyId: invite.company_id, email: invite.email };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ reset lozinke */

export type IssuedReset = { id: string; token: string; link: string; expiresAt: Date };

export async function issuePasswordReset(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  targetUserId: string,
  input: { baseUrl: string; ip?: string },
): Promise<IssuedReset | ServiceError> {
  const token = generateToken("reset");
  const id = randomUUID();

  return withCompany(pool, companyId, async (client) => {
    const actorEmail = await resolveActorEmail(client, actor.userId);
    const target = await loadTarget(client, companyId, targetUserId);
    if (!target) return { code: "NOT_FOUND", message: "Osoba nije pronađena u ovoj firmi." } as ServiceError;
    if (target.roles.includes("OWNER") && !actor.roles.includes("OWNER")) {
      return { code: "FORBIDDEN", message: "Reset lozinke vlasniku može zatražiti samo vlasnik." } as ServiceError;
    }

    await client.query(
      `UPDATE password_resets SET revoked_at = now()
        WHERE company_id = $1 AND user_id = $2 AND used_at IS NULL AND revoked_at IS NULL`,
      [companyId, targetUserId],
    );

    const expiresAt = tokenExpiry();
    await client.query(
      `INSERT INTO password_resets (id, company_id, user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, companyId, targetUserId, hashToken(token), expiresAt, actor.userId],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail,
      action: "password.reset_issued",
      entityType: "user",
      entityId: targetUserId,
      metadata: { resetId: id, expiresAt: expiresAt.toISOString() },
      ipHash: input.ip ? ipHash(input.ip) : null,
    });

    return {
      id,
      token,
      link: `${input.baseUrl.replace(/\/$/, "")}/lozinka/postavi?token=${token}`,
      expiresAt,
    };
  });
}

/**
 * Postavljanje lozinke preko linka (prije prijave). Token se claimuje atomski, pa se
 * u istoj transakciji mijenja lozinka i gase SVE sesije te osobe.
 */
export async function setPasswordWithToken(
  pool: Pool,
  kind: "reset" | "invite",
  token: string,
  newPassword: string,
  input: { ip?: string } = {},
): Promise<{ userId: string; companyId: string } | ServiceError> {
  const policyError = checkPasswordPolicy(newPassword);
  if (policyError) return { code: "VALIDATION_FAILED", message: policyError };

  const setting = kind === "reset" ? "app.reset_lookup_token" : "app.invite_lookup_token";
  const table = kind === "reset" ? "password_resets" : "invitations";
  const passwordHash = await hashPassword(newPassword);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config($1, $2, true)", [setting, hashToken(token)]);

    const claimed = await client.query<{ id: string; user_id: string; company_id: string }>(
      `UPDATE ${table}
          SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING id, user_id, company_id`,
      [hashToken(token)],
    );
    const row = claimed.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { code: "LINK_INVALID", message: "Link je istekao ili je već iskorišten." };
    }

    // Ista pravilo kao kod pozivnice: tenant dolazi iz zapisa, ne iz zahtjeva.
    await client.query("SELECT set_config('app.company_id', $1, true)", [row.company_id]);

    await client.query("UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2", [
      passwordHash,
      row.user_id,
    ]);

    const sessions = await client.query(
      "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL RETURNING id",
      [row.user_id, row.company_id],
    );

    await writeAudit(client, {
      companyId: row.company_id,
      actorId: row.user_id,
      actorEmail: null,
      action: kind === "reset" ? "password.reset_used" : "invitation.accepted",
      entityType: "user",
      entityId: row.user_id,
      metadata: { revokedSessions: sessions.rowCount ?? 0 },
      ipHash: input.ip ? ipHash(input.ip) : null,
    });

    await client.query("COMMIT");
    return { userId: row.user_id, companyId: row.company_id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ promjena lozinke */

export async function changeOwnPassword(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; sessionId: string },
  input: { currentPassword: string; newPassword: string; ip?: string },
): Promise<
  | { ok: true; revokedSessions: number }
  | { code: "VALIDATION_FAILED" | "FORBIDDEN"; message: string }
> {
  const policyError = checkPasswordPolicy(input.newPassword);
  if (policyError) return { code: "VALIDATION_FAILED", message: policyError };

  return withCompany(pool, ctx.companyId, async (client) => {
    const found = await client.query<{ password_hash: string; email: string }>(
      "SELECT password_hash, email FROM users WHERE id = $1",
      [ctx.userId],
    );
    const current = found.rows[0];
    if (!current) return { code: "FORBIDDEN", message: "Nalog nije pronađen." };

    if (!(await verifyPassword(current.password_hash, input.currentPassword))) {
      return { code: "VALIDATION_FAILED", message: "Trenutna lozinka nije ispravna." };
    }
    if (await verifyPassword(current.password_hash, input.newPassword)) {
      return { code: "VALIDATION_FAILED", message: "Nova lozinka ne smije biti ista kao trenutna." };
    }

    await client.query(
      "UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2",
      [await hashPassword(input.newPassword), ctx.userId],
    );
    // Tekuća sesija ostaje, sve ostale se gase.
    const revoked = await client.query(
      "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND company_id = $2 AND id <> $3 AND revoked_at IS NULL RETURNING id",
      [ctx.userId, ctx.companyId, ctx.sessionId],
    );

    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: current.email,
      action: "password.changed",
      entityType: "user",
      entityId: ctx.userId,
      metadata: { revokedSessions: revoked.rowCount ?? 0 },
      ipHash: input.ip ? ipHash(input.ip) : null,
    });

    return { ok: true, revokedSessions: revoked.rowCount ?? 0 };
  });
}

/* ------------------------------------------------------------------ deaktivacija */

export async function setUserActive(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  targetUserId: string,
  active: boolean,
  input: { ip?: string } = {},
): Promise<{ ok: true; revokedSessions: number } | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const actorEmail = await resolveActorEmail(client, actor.userId);
    const target = await loadTarget(client, companyId, targetUserId);
    if (!target) return { code: "NOT_FOUND", message: "Osoba nije pronađena u ovoj firmi." } as ServiceError;
    if (target.id === actor.userId) {
      return { code: "FORBIDDEN", message: "Ne možete deaktivirati sebe." } as ServiceError;
    }
    if (target.roles.includes("OWNER") && !actor.roles.includes("OWNER")) {
      return { code: "FORBIDDEN", message: "Vlasnika može deaktivirati samo vlasnik." } as ServiceError;
    }

    await client.query("UPDATE users SET is_active = $1 WHERE id = $2", [active, targetUserId]);
    await client.query("UPDATE memberships SET is_active = $1 WHERE user_id = $2 AND company_id = $3", [
      active,
      targetUserId,
      companyId,
    ]);

    const revoked = active
      ? { rowCount: 0 }
      : await client.query(
          "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL RETURNING id",
          [targetUserId, companyId],
        );

    if (!active) {
      await client.query(
        `UPDATE invitations SET revoked_at = now()
          WHERE company_id = $1 AND lower(email) = $2 AND used_at IS NULL AND revoked_at IS NULL`,
        [companyId, target.email],
      );
      await client.query(
        "UPDATE password_resets SET revoked_at = now() WHERE user_id = $1 AND company_id = $2 AND used_at IS NULL AND revoked_at IS NULL",
        [targetUserId, companyId],
      );
    }

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail,
      action: active ? "user.activated" : "user.deactivated",
      entityType: "user",
      entityId: targetUserId,
      metadata: { revokedSessions: revoked.rowCount ?? 0 },
      ipHash: input.ip ? ipHash(input.ip) : null,
    });

    return { ok: true, revokedSessions: revoked.rowCount ?? 0 };
  });
}

/** Ne mijenja bazu — koristi se u UI-u da dugme bude tačno. */
export function isInvitationUsable(invitation: { expiresAt: Date; usedAt?: Date | null }): boolean {
  return !invitation.usedAt && invitation.expiresAt.getTime() > Date.now();
}

export { TOKEN_TTL_HOURS };
