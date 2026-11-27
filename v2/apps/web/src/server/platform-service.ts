/**
 * Operator platforme (spec 01 §1.8, §1.10) — liste firmi, onboarding, suspend/aktivacija,
 * support pristup.
 *
 * Princip koji ovaj modul čuva: **operator nije član ni jedne firme.** Nema `app.company_id`
 * koji bi mu otvorio poslovne tabele; njegove operacije idu kroz `DATABASE_ADMIN_URL`
 * transakcije koje diraju SAMO `companies`, `memberships`, `invitations` i `platform_*`.
 * Support pristup je jedini put do podataka firme i on je vremenski ograničen, razlogom
 * vezan i VIDLJIV firmi u njenom auditu.
 *
 * `platform_users` i `platform_sessions` nemaju GRANT za `gradix_app` (vidi matricu), pa
 * web aplikacija pod aplikacijskom rolom ne može ni pročitati te tabele — čak i ako rutu
 * neko pozove pogrešnim tokenom.
 */
import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { Pool, type PoolClient } from "pg";
import { loadConfig } from "./config";
import { generateToken, hashToken, tokenExpiry } from "./tokens";

export type PlatformPrincipal = { id: string; email: string; displayName: string | null };

export function platformPool(): Pool | null {
  const url = process.env.DATABASE_ADMIN_URL?.trim();
  if (!url) return null;
  // Namjerno odvojen pool: platforma NIKAD ne ide kroz `getVerifiedPool` (aplikacijska rola
  // nema prava na platform tabele, i to je cilj).
  return new Pool({ connectionString: url, max: 2, application_name: "gradix-platform" });
}

let sharedPlatformPool: Pool | null = null;

export function getPlatformPool(): Pool {
  if (!sharedPlatformPool) {
    const pool = platformPool();
    if (!pool) {
      throw new Error("Platforma traži DATABASE_ADMIN_URL. Bez njega operator ne može raditi.");
    }
    sharedPlatformPool = pool;
  }
  return sharedPlatformPool;
}

/* ------------------------------------------------------------------ sesija */

export type PlatformLoginResult =
  | { ok: true; token: string; expiresAt: Date; principal: PlatformPrincipal }
  | { ok: false; code: "PLATFORM_FORBIDDEN" };

/**
 * Prijava operatora. Sesija je 8 sati: operator radi administraciju u komadu, a 2FA je
 * obavezna za svaku novu sesiju (vidi `platform.users` TOTP kolonu).
 */
export async function platformLogin(email: string, password: string): Promise<PlatformLoginResult> {
  const pool = getPlatformPool();
  const normalized = email.trim().toLowerCase();
  const found = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    display_name: string | null;
    is_active: boolean;
  }>(
    "SELECT id, email, password_hash, display_name, is_active FROM platform_users WHERE lower(email) = $1",
    [normalized],
  );
  const user = found.rows[0];
  // Hash se provjerava i za nepostojeći nalog — inače vrijeme odgovora oda postojanje.
  const hash =
    user?.password_hash ??
    "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$0000000000000000000000000000000000000000";
  let passwordOk = false;
  try {
    passwordOk = await argon2.verify(hash, password);
  } catch {
    passwordOk = false;
  }
  if (!user || !passwordOk || !user.is_active) return { ok: false, code: "PLATFORM_FORBIDDEN" };

  const token = `gxp_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO platform_sessions (id, platform_user_id, token_hash, expires_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3)`,
    [user.id, createHash("sha256").update(token).digest("hex"), expiresAt],
  );
  await pool.query("UPDATE platform_users SET last_login_at = now() WHERE id = $1", [user.id]);
  return {
    ok: true,
    token,
    expiresAt,
    principal: { id: user.id, email: user.email, displayName: user.display_name },
  };
}

export const PLATFORM_COOKIE = "gx_plat";

/** Provjera platform sesije iz cookie-ja. Nikad ne pada na grešku baze — vraća `null`. */
export async function authenticatePlatform(token: string | null): Promise<PlatformPrincipal | null> {
  if (!token?.startsWith("gxp_")) return null;
  const pool = getPlatformPool();
  const hash = createHash("sha256").update(token).digest("hex");
  const row = await pool.query<{ id: string; email: string; display_name: string | null }>(
    `SELECT u.id, u.email, u.display_name
       FROM platform_sessions s
       JOIN platform_users u ON u.id = s.platform_user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`,
    [hash],
  );
  const principal = row.rows[0];
  return principal ? { id: principal.id, email: principal.email, displayName: principal.display_name } : null;
}

export async function platformLogout(token: string | null): Promise<void> {
  if (!token?.startsWith("gxp_")) return;
  const pool = getPlatformPool();
  await pool.query("UPDATE platform_sessions SET revoked_at = now() WHERE token_hash = $1", [
    createHash("sha256").update(token).digest("hex"),
  ]);
}

/* ------------------------------------------------------------------- firme */

export type PlatformCompany = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  userCount: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  /** Koliko je zadanih kategorija trigger napravio (0 samo za firme prije R2a). */
  seededCategories?: number;
};

export async function listCompanies(): Promise<PlatformCompany[]> {
  const pool = getPlatformPool();
  const result = await pool.query<{
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    user_count: string;
    last_activity_at: Date | null;
    created_at: Date;
  }>(
    `SELECT c.id, c.name, c.slug, c.is_active,
            (SELECT count(*)::text FROM memberships m WHERE m.company_id = c.id AND m.is_active) AS user_count,
            (SELECT max(u.last_login_at) FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.company_id = c.id) AS last_activity_at,
            c.created_at
       FROM companies c
      ORDER BY c.created_at DESC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    isActive: row.is_active,
    userCount: Number(row.user_count),
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
  }));
}

/** Slug iz naziva: „Firma d.o.o. Sarajevo“ → „firma-d-o-o-sarajevo“. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 62);
}

export type OnboardingInput = {
  name: string;
  slug?: string;
  taxId?: string | null;
  city?: string | null;
  address?: string | null;
  currency: string;
  timezone: string;
  weekStart: "MON" | "SUN";
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
};

export type OnboardingResult =
  | { ok: true; company: PlatformCompany; invitationLink: string | null }
  | { ok: false; code: "CONFLICT" | "VALIDATION_FAILED"; message: string };

/**
 * Onboarding firme (spec 01 §1.10) — SVE u jednoj transakciji:
 *   firma + vlasnik (postojeći korisnik ili pozivnica) + zadani šifarnici + audit.
 *
 * Idempotentno po `slug`: ponovni poziv sa istim slugom vraća `CONFLICT`, a djelimično
 * kreirana firma ne može ostati jer sve pada zajedno.
 */
export async function onboardCompany(
  actor: PlatformPrincipal,
  input: OnboardingInput,
  baseUrl: string,
): Promise<OnboardingResult> {
  const pool = getPlatformPool();
  const slug = (input.slug ?? slugify(input.name)).trim();
  if (slug.length < 2) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Slug se ne može izvesti iz naziva." };
  }
  const ownerEmail = input.ownerEmail.trim().toLowerCase();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const taken = await client.query<{ id: string }>("SELECT id FROM companies WHERE slug = $1 FOR UPDATE", [slug]);
    if (taken.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, code: "CONFLICT", message: "Firma sa tim slugom već postoji." };
    }

    const companyId = `cmp_${randomBytes(8).toString("hex")}`;
    await client.query(
      `INSERT INTO companies (id, name, slug, currency, timezone, week_start)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, input.name.trim(), slug, input.currency, input.timezone, input.weekStart],
    );
    if (input.taxId || input.city || input.address) {
      await client.query("UPDATE companies SET tax_id = $2, city = $3, address = $4 WHERE id = $1", [
        companyId,
        input.taxId ?? null,
        input.city ?? null,
        input.address ?? null,
      ]);
    }

    /*
     * Zadane šifarnike puni TRIGGER `companies_seed_equipment_categories` (R2a) odmah na
     * INSERT firme — u istoj transakciji. Ručni seed ovdje bi bio duplikat: prvo bi ga
     * trigger već napravio, a drugo bi kategorije morale imati `code` i `meter`, pa bi
     * „Bager“ bez njih pao. Zato onboarding ne dira šifarnike, samo potvrđuje da su tu.
     */
    const seeded = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM equipment_categories WHERE company_id = $1",
      [companyId],
    );
    await client.query("UPDATE companies SET seeded_at = now() WHERE id = $1", [companyId]);

    // Vlasnik: postojeći korisnik dobija članstvo; nov dobija pozivnicu (jednokratnu, 48 h).
    let invitationLink: string | null = null;
    const existingUser = await client.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = $1", [
      ownerEmail,
    ]);
    const owner = existingUser.rows[0];
    if (owner) {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES (gen_random_uuid()::text, $1, $2, ARRAY['OWNER']::"Role"[], 'COMPANY')`,
        [owner.id, companyId],
      );
    } else {
      const token = generateToken("invite");
      await client.query(
        `INSERT INTO invitations (id, company_id, email, roles, scope, token_hash, expires_at)
         VALUES (gen_random_uuid()::text, $1, $2, ARRAY['OWNER']::"Role"[], 'COMPANY', $3, $4)`,
        [companyId, ownerEmail, hashToken(token), tokenExpiry()],
      );
      // Link se vraća operatoru TAČNO JEDNOM; u bazi je samo SHA-256.
      invitationLink = `${baseUrl.replace(/\/$/, "")}/lozinka/pozivnica?token=${token}`;
    }

    await client.query(
      `INSERT INTO audit_events
         (id, company_id, actor_id, actor_email, action, entity_type, entity_id, metadata, retention_class)
       VALUES (gen_random_uuid()::text, $1, NULL, $2, 'platform.company_created', 'company', $1, $3::jsonb, 'ACCESS')`,
      [
        companyId,
        actor.email,
        JSON.stringify({ slug, ownerEmail, ownerInvited: owner ? "existing" : "invitation" }),
      ],
    );

    await client.query("COMMIT");

    return {
      ok: true,
      company: {
        id: companyId,
        name: input.name.trim(),
        slug,
        isActive: true,
        seededCategories: Number(seeded.rows[0]?.n ?? 0),
        userCount: owner ? 1 : 0,
        lastActivityAt: null,
        createdAt: new Date(),
      },
      invitationLink,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Suspend/aktivacija. Deaktivacija blokira PRIJAVU svih korisnika (`AUTH_COMPANY_INACTIVE`)
 * i ne briše podatke; reaktivacija vraća pristup (spec 01 §1.1.4).
 */
export async function setCompanyActive(
  actor: PlatformPrincipal,
  companyId: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" }> {
  const pool = getPlatformPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(
      "UPDATE companies SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING id",
      [companyId, active],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, code: "NOT_FOUND" };
    }
    await client.query(
      `INSERT INTO audit_events
         (id, company_id, actor_id, actor_email, action, entity_type, entity_id, metadata, retention_class)
       VALUES (gen_random_uuid()::text, $1, NULL, $2, $3, 'company', $1, '{}'::jsonb, 'ACCESS')`,
      [companyId, actor.email, active ? "platform.company_activated" : "platform.company_suspended"],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Support pristup: max 60 min, obavezan razlog, upisan u audit FIRME (a ne samo platforme).
 *
 * Zašto u audit firme: firma mora moći vidjeti da je neko sa strane gledao njene podatke i
 * zašto. „Tihi“ pristup je upravo ono što ovaj dizajn isključuje.
 */
export async function grantSupportAccess(
  actor: PlatformPrincipal,
  companyId: string,
  input: { reason: string; minutes: number },
): Promise<{ ok: true; expiresAt: Date } | { ok: false; code: "NOT_FOUND" | "VALIDATION_FAILED"; message: string }> {
  const reason = input.reason.trim();
  if (reason.length < 10) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Razlog je obavezan (najmanje 10 znakova)." };
  }
  const minutes = Math.min(60, Math.max(5, Math.round(input.minutes)));
  const pool = getPlatformPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const company = await client.query<{ id: string }>("SELECT id FROM companies WHERE id = $1", [companyId]);
    if (!company.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, code: "NOT_FOUND", message: "Firma nije pronađena." };
    }
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    await client.query(
      `INSERT INTO platform_support_sessions (id, platform_user_id, company_id, reason, expires_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4)`,
      [actor.id, companyId, reason, expiresAt],
    );
    await client.query(
      `INSERT INTO audit_events
         (id, company_id, actor_id, actor_email, action, entity_type, entity_id, metadata, retention_class)
       VALUES (gen_random_uuid()::text, $1, NULL, $2, 'platform.support_access_granted',
               'support_session', $1, $3::jsonb, 'ACCESS')`,
      [companyId, actor.email, JSON.stringify({ reason, minutes, expiresAt: expiresAt.toISOString() })],
    );
    await client.query("COMMIT");
    return { ok: true, expiresAt };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Da li firma ima aktivan support pristup — za zaglavlje UI-a (spec 01 §1.8.37). */
export async function activeSupportAccess(companyId: string): Promise<{ expiresAt: Date; reason: string } | null> {
  const pool = getPlatformPool();
  const result = await pool.query<{ expires_at: Date; reason: string }>(
    `SELECT expires_at, reason FROM platform_support_sessions
      WHERE company_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY expires_at DESC LIMIT 1`,
    [companyId],
  );
  const row = result.rows[0];
  return row ? { expiresAt: row.expires_at, reason: row.reason } : null;
}

/** Ključ za 2FA operatora izvodi se iz istog `AUTH_SECRET`-a. */
export function platformAuthSecret(): string {
  return loadConfig().AUTH_SECRET;
}

export type { PoolClient };
