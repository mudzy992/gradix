/**
 * R1b servis: matrica rola, dodjela rola i opsega, čitanje audit traga.
 *
 * Sve ide kroz `withCompany` (RLS) — firma dolazi iz sesije, nikad iz zahtjeva. Pravila
 * dodjele su OVDJE, ne u UI-u: dugme koje ne može proći ne treba ni da postoji, ali odluka
 * mora stajati na jednom mjestu koje važi i kad se ruta pozove mimo ekrana.
 */
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { writeAudit, ipHash } from "./audit";
import type { Role } from "./permissions";
import { PERMISSIONS, PERMISSION_INFO, ROLE_LABELS, ROLES, assignableRoles, can, isScope, permissionsFor } from "./permissions";

export type Actor = { userId: string; roles: string[] };

export type MembershipError =
  | { code: "FORBIDDEN"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "CONFLICT"; message: string };

const MAX_ROLES_PER_MEMBERSHIP = 5;

/* ------------------------------------------------------------------ matrica */

export type RoleMatrixRow = {
  role: Role;
  label: string;
  description: string;
  permissions: string[];
  assignableBy: string[];
};

/**
 * Matrica za pregled. Građena iz `PERMISSIONS`, pa ne može odstupiti od onoga što rute
 * stvarno provjeravaju — test to i tvrdi.
 */
export function roleMatrix(actorRoles: readonly string[]): {
  permissions: { key: string; label: string; description: string }[];
  roles: RoleMatrixRow[];
  editable: boolean;
} {
  const assignable = assignableRoles(actorRoles);
  return {
    permissions: (Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]).map((key) => ({
      key,
      label: PERMISSION_INFO[key].label,
      description: PERMISSION_INFO[key].description,
    })),
    roles: ROLES.map((role) => ({
      role,
      label: ROLE_LABELS[role].label,
      description: ROLE_LABELS[role].description,
      permissions: permissionsFor(role),
      // Ko može dodijeliti ovu rolu — OWNER samo vlasnik, ostalo svako sa `users.manage`.
      assignableBy: assignable.includes(role) ? ["OWNER", "ADMIN"] : ["OWNER"],
    })),
    // Matrica je pregled; `editable` je lažno uvijek — dozvole se ne mijenjaju iz UI-a (R1).
    editable: false,
  };
}

/* ------------------------------------------------------------------ dodjela */

export type Membership = { id: string; roles: string[]; scope: string; is_active: boolean };

async function loadMembership(client: PoolClient, companyId: string, userId: string) {
  const result = await client.query<{
    id: string;
    roles: string[];
    scope: string;
    is_active: boolean;
    email: string;
  }>(
    `SELECT m.id, m.roles::text[] AS roles, m.scope, m.is_active, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.company_id = $1 AND m.user_id = $2`,
    [companyId, userId],
  );
  return result.rows[0] ?? null;
}

export type MembershipChange = {
  userId: string;
  email: string;
  before: { roles: string[]; scope: string };
  after: { roles: string[]; scope: string };
};

/**
 * Dodjela rola i opsega. Pravila (sva u ovoj funkciji, sva u istoj transakciji sa audtom):
 *  1. akter mora imati `users.manage`,
 *  2. niko ne mijenja sopstvene role (ni vlasnik — to je put u firmu bez vlasnika),
 *  3. `OWNER` rolu daje i skida samo `OWNER`,
 *  4. firma ne može ostati bez vlasnika — i to je STRUKTURNO, ne posebnom provjerom:
 *     rolu `OWNER` mijenja samo `OWNER`, a nijedan `OWNER` ne mijenja sebe (pravilo 2), pa
 *     je osoba koja bi skinula posljednjeg vlasnika uvijek neko drugi — a takav ne postoji.
 *     Zato ovdje nema `if (posljednji vlasnik)` grane: bila bi nedostižna (mrtav kod).
 *     Test `rbac.integration.test.ts` dokazuje svojstvo, ne granu.
 *  5. najmanje jedna rola, najviše pet, samo role iz `ROLES`.
 */
export async function changeMembership(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  targetUserId: string,
  input: { roles: string[]; scope: string; ip?: string },
): Promise<MembershipChange | MembershipError> {
  if (!can(actor.roles, "users.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo mijenjati role." };
  }
  if (actor.userId === targetUserId) {
    return { code: "FORBIDDEN", message: "Ne možete mijenjati sopstvene role." };
  }

  const roles = [...new Set(input.roles)];
  if (roles.length === 0) {
    return { code: "VALIDATION_FAILED", message: "Osoba mora imati najmanje jednu rolu." };
  }
  if (roles.length > MAX_ROLES_PER_MEMBERSHIP) {
    return { code: "VALIDATION_FAILED", message: `Najviše ${MAX_ROLES_PER_MEMBERSHIP} role po osobi.` };
  }
  if (roles.some((role) => !(ROLES as readonly string[]).includes(role))) {
    return { code: "VALIDATION_FAILED", message: "Nepoznata rola." };
  }
  if (!isScope(input.scope)) {
    return { code: "VALIDATION_FAILED", message: "Opseg nije ispravan." };
  }

  return withCompany(pool, companyId, async (client) => {
    const target = await loadMembership(client, companyId, targetUserId);
    if (!target) return { code: "NOT_FOUND", message: "Osoba nije pronađena u ovoj firmi." } as MembershipError;

    /*
     * Opseg `PROJECTS` bez ijedne dodjele ne vidi NIŠTA. Takav opseg nije podešavanje nego zamka:
     * čovjek se prijavi, ekran je prazan i izgleda da je sistem pokvaren. Zato se ovdje odbija, i
     * to prije upisa — a ne da se poslije objašnjava.
     *
     * Provjera ide preko radnika vezanog za nalog, jer se dodjele vode na radniku, ne na nalogu.
     */
    if (input.scope === "PROJECTS") {
      const assigned = await client.query(
        `SELECT 1
           FROM project_assignments a
           JOIN workers w ON w.company_id = a.company_id AND w.id = a.worker_id
           JOIN companies c ON c.id = a.company_id
          WHERE a.company_id = $2 AND w.user_id = $1
            AND a.voided_at IS NULL
            AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
            AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)
          LIMIT 1`,
        [targetUserId, companyId],
      );
      if (assigned.rowCount === 0) {
        return {
          code: "VALIDATION_FAILED",
          message:
            "Opseg „dodijeljeni projekti“ traži barem jedan projekat. Dodijelite osobu na projekat, pa postavite opseg.",
        } as MembershipError;
      }
    }

    const targetIsOwner = target.roles.includes("OWNER");
    const actorIsOwner = actor.roles.includes("OWNER");
    const givesOwner = roles.includes("OWNER");
    if ((targetIsOwner || givesOwner) && !actorIsOwner) {
      return {
        code: "FORBIDDEN",
        message: "Vlasnika i rolu vlasnika mijenja samo vlasnik.",
      } as MembershipError;
    }

    await client.query(
      `UPDATE memberships SET roles = $1::"Role"[], scope = $2, updated_at = now()
        WHERE company_id = $3 AND user_id = $4`,
      [roles, input.scope, companyId, targetUserId],
    );

    const actorEmail = await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [
      actor.userId,
    ]);

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: actorEmail.rows[0]?.email ?? null,
      action: "user.membership_changed",
      entityType: "user",
      entityId: targetUserId,
      // Prije i poslije — iz tragа se vidi šta je tačno promijenjeno, bez ijedne tajne.
      metadata: {
        email: target.email,
        from: { roles: target.roles, scope: target.scope },
        to: { roles, scope: input.scope },
      },
      ipHash: input.ip ? ipHash(input.ip) : null,
    });

    return {
      userId: targetUserId,
      email: target.email,
      before: { roles: target.roles, scope: target.scope },
      after: { roles, scope: input.scope },
    };
  });
}

/* ------------------------------------------------------------------ audit */

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AuditFilter = {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
};

export type AuditPage = { rows: AuditRow[]; nextCursor: string | null };

const AUDIT_PAGE_DEFAULT = 25;
const AUDIT_PAGE_MAX = 100;

/** Cursor je `createdAt|id` — keyset, ne offset: trag raste, offset bi duplirao i preskakao. */
function encodeCursor(row: { created_at: Date; id: string }): string {
  return Buffer.from(`${row.created_at.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const date = new Date(createdAt ?? "");
    if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !id) return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

export async function listAudit(
  pool: Pool,
  companyId: CompanyId,
  filter: AuditFilter,
  paging: { cursor?: string; limit?: number } = {},
): Promise<AuditPage | { code: "VALIDATION_FAILED"; message: string }> {
  const limit = Math.min(Math.max(paging.limit ?? AUDIT_PAGE_DEFAULT, 1), AUDIT_PAGE_MAX);

  const values: unknown[] = [companyId];
  // `company_id = $1` stoji DOSLOVNO u SQL predlošku dolje (B1: vidljiva druga
  // linija odbrane pored RLS-a); ovdje idu samo filteri iz zahtjeva.
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace("$?", `$${values.length}`));
  };

  if (filter.actorId) add("actor_id = $?", filter.actorId);
  if (filter.action) add("action = $?", filter.action);
  if (filter.entityType) add("entity_type = $?", filter.entityType);
  if (filter.entityId) add("entity_id = $?", filter.entityId);
  if (filter.from) add("created_at >= $?", filter.from);
  if (filter.to) add("created_at <= $?", filter.to);

  if (paging.cursor) {
    const cursor = decodeCursor(paging.cursor);
    if (!cursor) return { code: "VALIDATION_FAILED", message: "Cursor nije ispravan." };
    values.push(cursor.createdAt, cursor.id);
    where.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`);
  }

  values.push(limit + 1); // jedan red više: zna se postoji li sljedeća stranica

  return withCompany(pool, companyId, async (client) => {
    const result = await client.query<{
      id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      actor_id: string | null;
      actor_email: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, action, entity_type, entity_id, actor_id, actor_email, metadata, created_at
         FROM audit_events
        WHERE company_id = $1
          ${where.length > 0 ? `AND ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC
        LIMIT $${values.length}`,
      values,
    );

    const page = result.rows.slice(0, limit);
    return {
      rows: page.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actorId: row.actor_id,
        actorEmail: row.actor_email,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
      })),
      nextCursor: result.rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  });
}
