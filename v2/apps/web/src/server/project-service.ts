/**
 * R3 servis: projekti, dodjele radnika i mašina, iznimke od blokade.
 *
 * Pravila koja žive OVDJE, a ne u rutama ili UI-u:
 *  - projekat je firme i vidi se po opsegu: `COMPANY` sve, `PROJECTS` samo dodijeljeno, `SELF` ništa
 *    osim svog imena na projektu;
 *  - tuđi projekat u ISTOJ firmi je 403 („nisi dodijeljen"), a tuđa firma 404 — razlika je namjerna,
 *    jer čovjek sa opsegom `PROJECTS` mora znati je li projekat obrisan ili mu nije dodijeljen;
 *  - dodjela se odbija ako radnik/mašina ima ISTEKLU blokirajuću obavezu, osim uz evidentiranu
 *    iznimku sa razlogom i rokom (odluka vlasnika 2026-11-09);
 *  - preklapanje perioda istog entiteta na istom projektu brani TRIGER u bazi; servis ga prevodi u
 *    čitljivu poruku umjesto da pusti `ASSIGNMENT_OVERLAP` do ekrana.
 *
 * Opseg se provjerava na JEDNOM mjestu (`projektiKojeVidim`), pa nema rasutih uslova po upitima.
 */
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import {
  assignmentBlockMessage,
  checkAssignment,
  safeTimezone,
  businessDate,
  visibleProjectIds,
  type AssignmentOverride,
  type Scope,
} from "@gradix/domain";
import { writeAudit } from "./audit";
import type { Actor } from "./rbac-service";

export type ServiceError =
  | { code: "FORBIDDEN"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "CONFLICT"; message: string };

/** Prepoznaje se po `message`, ne po `code`: `ProjectRow` ima svoje polje `code` (šifra projekta). */
export function isServiceError(value: unknown): value is ServiceError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "PAUSED", "FINISHED", "CANCELLED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

/** Nazivi statusa za ekran — jedan izvor, da se ne pišu dvije verzije istog prevoda. */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNED: "U planu",
  ACTIVE: "Aktivan",
  PAUSED: "Pauziran",
  FINISHED: "Završen",
  CANCELLED: "Otkazan",
};

/** Kontekst aktera: `scope` i `projectIds` dolaze iz sesije (R3), ne iz zahtjeva. */
export type ProjectActor = Actor & { scope: Scope; projectIds: string[] | null };

export type ProjectRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  siteAddress: string | null;
  sitePlace: string | null;
  startsOn: string | null;
  endsOn: string | null;
  managerWorkerId: string | null;
  managerName: string | null;
  note: string | null;
  isActive: boolean;
  workerCount: number;
  machineCount: number;
  overdueObligations: number;
  expiringObligations: number;
  createdAt: string;
};

const toDate = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

/**
 * `SELECT` dio za projekat, sa brojevima koji se računaju na licu mjesta.
 *
 * Brojevi se računaju podupitima, a ne aplikacijom: lista projekata inače radi N+1 upita, a sa 40
 * projekata to je 40 krugova do baze za jedan ekran.
 *
 * Rokovi se broje po `obligation_state()` iz R2b — ista funkcija kao ekran rokova, pa se broj na
 * projektu i stanje na listi rokova ne mogu razići.
 */
const PROJECT_SELECT = `
  SELECT p.id, p.code, p.name, p.status, p.site_address, p.site_place,
         p.starts_on, p.ends_on, p.manager_worker_id, p.note, p.is_active, p.created_at,
         COALESCE(mw.first_name || ' ' || mw.last_name, NULL) AS manager_name,
         (SELECT count(*)::int FROM project_assignments a
           WHERE a.company_id = p.company_id AND a.project_id = p.id AND a.worker_id IS NOT NULL) AS worker_count,
         (SELECT count(*)::int FROM project_assignments a
           WHERE a.company_id = p.company_id AND a.project_id = p.id AND a.machine_id IS NOT NULL) AS machine_count,
         (SELECT count(*)::int FROM obligations o
            JOIN obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
           WHERE o.company_id = p.company_id AND o.project_id = p.id
             AND o.superseded_by IS NULL
             AND obligation_state(o.expires_at, t.default_reminder_days, $1) = 'expired') AS overdue_obligations,
         (SELECT count(*)::int FROM obligations o
            JOIN obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
           WHERE o.company_id = p.company_id AND o.project_id = p.id
             AND o.superseded_by IS NULL
             AND obligation_state(o.expires_at, t.default_reminder_days, $1) = 'expiring') AS expiring_obligations
    FROM projects p
    LEFT JOIN workers mw ON mw.company_id = p.company_id AND mw.id = p.manager_worker_id
`;

function toProject(row: Record<string, unknown>): ProjectRow {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    status: String(row.status),
    siteAddress: row.site_address ? String(row.site_address) : null,
    sitePlace: row.site_place ? String(row.site_place) : null,
    startsOn: toDate(row.starts_on),
    endsOn: toDate(row.ends_on),
    managerWorkerId: row.manager_worker_id ? String(row.manager_worker_id) : null,
    managerName: row.manager_name ? String(row.manager_name) : null,
    note: row.note ? String(row.note) : null,
    isActive: Boolean(row.is_active),
    workerCount: Number(row.worker_count ?? 0),
    machineCount: Number(row.machine_count ?? 0),
    overdueObligations: Number(row.overdue_obligations ?? 0),
    expiringObligations: Number(row.expiring_obligations ?? 0),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/** Poslovni datum firme — isto pravilo kao u rokovima: „danas" nije UTC. */
export async function companyToday(client: PoolClient, companyId: CompanyId): Promise<string> {
  const result = await client.query<{ timezone: string | null }>(
    "SELECT timezone FROM companies WHERE id = $1",
    [companyId],
  );
  return businessDate(new Date(), safeTimezone(result.rows[0]?.timezone));
}

/**
 * Filter po opsegu, kao gotov SQL isječak.
 *
 * `null` iz `visibleProjectIds` znači „bez filtera" (`COMPANY`); prazan niz znači „nijedan" — i to
 * je ISPRAVNO za `SELF` i za `PROJECTS` bez dodjele. Zato se ne piše `= ANY('{}')` za sve.
 */
function scopeClause(actor: ProjectActor, column: string): { sql: string; params: unknown[] } {
  const ids = visibleProjectIds({ userId: actor.userId, scope: actor.scope, projectIds: actor.projectIds ?? [] });
  if (ids === null) return { sql: "", params: [] };
  if (ids.length === 0) return { sql: " AND false", params: [] };
  return { sql: ` AND ${column} = ANY($SCOPE_IDS::text[])`, params: [ids] };
}

/* ================================================================== projekti */

export type ProjectFilter = {
  status?: string;
  includeInactive?: boolean;
  /** Samo projekti na kojima je taj radnik — za „moji projekti" na mobilnom. */
  workerUserId?: string;
};

export async function listProjects(
  pool: Pool,
  companyId: CompanyId,
  actor: ProjectActor,
  filter: ProjectFilter = {},
): Promise<ProjectRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const today = await companyToday(client, companyId);
    const params: unknown[] = [today];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    const conditions: string[] = [];
    if (!filter.includeInactive) conditions.push("p.is_active");
    if (filter.status) {
      if (!isProjectStatus(filter.status)) return [];
      conditions.push(`p.status = ${param(filter.status)}`);
    }
    if (filter.workerUserId) {
      conditions.push(
        `EXISTS (SELECT 1 FROM project_assignments a
                   JOIN workers w ON w.company_id = a.company_id AND w.id = a.worker_id
                  WHERE a.company_id = p.company_id AND a.project_id = p.id AND w.user_id = ${param(
                    filter.workerUserId,
                  )})`,
      );
    }

    // Opseg ide POSLIJE ostalih uslova i uvijek prisutan — nema puta koji ga preskače.
    const scope = scopeClause(actor, "p.id");
    let sql = `${PROJECT_SELECT} WHERE ${conditions.length > 0 ? conditions.join(" AND ") : "true"}`;
    if (scope.sql) {
      const index = param(scope.params[0]);
      sql += scope.sql.replace("$SCOPE_IDS", index);
    }
    sql += " ORDER BY p.status = 'ACTIVE' DESC, p.code";

    const result = await client.query(sql, params);
    return result.rows.map(toProject);
  });
}

export async function getProject(
  pool: Pool,
  companyId: CompanyId,
  actor: ProjectActor,
  projectId: string,
): Promise<ProjectRow | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const today = await companyToday(client, companyId);
    const result = await client.query(`${PROJECT_SELECT} WHERE p.id = $2`, [today, projectId]);
    const row = result.rows[0];
    // Tuđa firma i nepostojeći projekat daju isti odgovor — RLS ne pravi razliku, pa je ne
    // izmišljamo ni mi.
    if (!row) return { code: "NOT_FOUND", message: "Projekat nije pronađen." } as ServiceError;

    // Tuđi projekat u ISTOJ firmi: 403, ne 404. Čovjek sa opsegom mora znati da projekat postoji.
    const ids = visibleProjectIds({ userId: actor.userId, scope: actor.scope, projectIds: actor.projectIds ?? [] });
    if (ids !== null && !ids.includes(projectId)) {
      return { code: "FORBIDDEN", message: "Nisi dodijeljen ovom projektu." } as ServiceError;
    }

    return toProject(row);
  });
}

export type ProjectInput = {
  code: string;
  name: string;
  status?: string;
  siteAddress?: string | null;
  sitePlace?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  managerWorkerId?: string | null;
  note?: string | null;
  isActive?: boolean;
};

function validateProject(input: ProjectInput): ServiceError | null {
  if (!input.code?.trim() || input.code.trim().length > 40) {
    return { code: "VALIDATION_FAILED", message: "Šifra projekta je obavezna (do 40 znakova)." };
  }
  if (!input.name?.trim() || input.name.trim().length > 200) {
    return { code: "VALIDATION_FAILED", message: "Naziv projekta je obavezan (do 200 znakova)." };
  }
  if (input.status !== undefined && !isProjectStatus(input.status)) {
    return { code: "VALIDATION_FAILED", message: "Nepoznat status projekta." };
  }
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
    return { code: "VALIDATION_FAILED", message: "Kraj ne može biti prije početka." };
  }
  return null;
}

export async function createProject(
  pool: Pool,
  companyId: CompanyId,
  actor: ProjectActor,
  input: ProjectInput,
): Promise<ProjectRow | ServiceError> {
  const invalid = validateProject(input);
  if (invalid) return invalid;

  return withCompany(pool, companyId, async (client) => {
    const code = input.code.trim().toUpperCase();
    const exists = await client.query("SELECT 1 FROM projects WHERE code = $1", [code]);
    if (exists.rowCount !== 0) {
      return { code: "CONFLICT", message: `Projekat sa šifrom „${code}" već postoji.` } as ServiceError;
    }

    const id = `prj_${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO projects (id, company_id, code, name, status, site_address, site_place,
                             starts_on, ends_on, manager_worker_id, note, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        companyId,
        code,
        input.name.trim(),
        input.status ?? "ACTIVE",
        input.siteAddress?.trim() || null,
        input.sitePlace?.trim() || null,
        input.startsOn || null,
        input.endsOn || null,
        input.managerWorkerId || null,
        input.note?.trim() || null,
        input.isActive ?? true,
        actor.userId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.created",
      entityType: "project",
      entityId: id,
      metadata: { code, name: input.name.trim(), status: input.status ?? "ACTIVE" },
    });

    const created = await client.query(`${PROJECT_SELECT} WHERE p.id = $2`, [
      await companyToday(client, companyId),
      id,
    ]);
    return toProject(created.rows[0]!);
  });
}

export async function updateProject(
  pool: Pool,
  companyId: CompanyId,
  actor: ProjectActor,
  projectId: string,
  input: Partial<ProjectInput>,
): Promise<ProjectRow | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const current = await client.query<{ code: string; status: string }>(
      "SELECT code, status FROM projects WHERE id = $1",
      [projectId],
    );
    const before = current.rows[0];
    if (!before) return { code: "NOT_FOUND", message: "Projekat nije pronađen." } as ServiceError;

    if (input.status !== undefined && !isProjectStatus(input.status)) {
      return { code: "VALIDATION_FAILED", message: "Nepoznat status projekta." } as ServiceError;
    }
    if (input.code !== undefined) {
      const code = input.code.trim().toUpperCase();
      if (!code) {
        return { code: "VALIDATION_FAILED", message: "Šifra projekta ne može biti prazna." } as ServiceError;
      }
      if (code !== before.code) {
        const taken = await client.query("SELECT 1 FROM projects WHERE code = $1 AND id <> $2", [
          code,
          projectId,
        ]);
        if (taken.rowCount !== 0) {
          return { code: "CONFLICT", message: `Projekat sa šifrom „${code}" već postoji.` } as ServiceError;
        }
      }
    }
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
      return { code: "VALIDATION_FAILED", message: "Kraj ne može biti prije početka." } as ServiceError;
    }

    const sets: string[] = [];
    const params: unknown[] = [projectId];
    const set = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (input.code !== undefined) set("code", input.code.trim().toUpperCase());
    if (input.name !== undefined) set("name", input.name.trim());
    if (input.status !== undefined) set("status", input.status);
    if (input.siteAddress !== undefined) set("site_address", input.siteAddress?.trim() || null);
    if (input.sitePlace !== undefined) set("site_place", input.sitePlace?.trim() || null);
    if (input.startsOn !== undefined) set("starts_on", input.startsOn || null);
    if (input.endsOn !== undefined) set("ends_on", input.endsOn || null);
    if (input.managerWorkerId !== undefined) set("manager_worker_id", input.managerWorkerId || null);
    if (input.note !== undefined) set("note", input.note?.trim() || null);
    if (input.isActive !== undefined) set("is_active", input.isActive);

    if (sets.length > 0) {
      await client.query(`UPDATE projects SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    }

    // Status ima svoju radnju u auditu: „projekat završen" je ono što ljudi traže u tragu, a ne
    // „projekat izmijenjen".
    const statusChanged = input.status !== undefined && input.status !== before.status;
    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: statusChanged ? "project.status_changed" : "project.updated",
      entityType: "project",
      entityId: projectId,
      metadata: statusChanged
        ? { from: before.status, to: input.status }
        : { fields: Object.keys(input) },
    });

    const updated = await client.query(`${PROJECT_SELECT} WHERE p.id = $2`, [
      await companyToday(client, companyId),
      projectId,
    ]);
    return toProject(updated.rows[0]!);
  });
}

/* ================================================================== dodjele */

export type AssignmentBlockerRow = {
  obligationId: string;
  typeLabel: string;
  covered: boolean;
  reason?: string;
};

export type AssignmentRow = {
  id: string;
  projectId: string;
  workerId: string | null;
  workerName: string | null;
  machineId: string | null;
  machineCode: string | null;
  machineName: string | null;
  fromDate: string;
  toDate: string | null;
  note: string | null;
  blocked: AssignmentBlockerRow[];
  createdAt: string;
};

const ASSIGNMENT_SELECT = `
  SELECT a.id, a.project_id, a.worker_id, a.machine_id, a.from_date, a.to_date, a.note, a.created_at,
         (w.first_name || ' ' || w.last_name) AS worker_name,
         m.code AS machine_code, m.name AS machine_name
    FROM project_assignments a
    LEFT JOIN workers  w ON w.company_id = a.company_id AND w.id = a.worker_id
    LEFT JOIN machines m ON m.company_id = a.company_id AND m.id = a.machine_id
`;

type ObligationForCheck = { id: string; typeLabel: string; state: "valid" | "expiring" | "expired" | "superseded" | "no_expiry"; blocksAssignment: boolean };

/**
 * Obaveze entiteta koje ulaze u provjeru blokade.
 *
 * Gleda se NAJNOVIJA aktivna obaveza po tipu (`superseded_by IS NULL`) — obnovljena obaveza ima
 * novi rok, a stara verzija ne smije blokirati.
 */
async function entityObligations(
  client: PoolClient,
  today: string,
  entity: { workerId?: string | null; machineId?: string | null },
): Promise<ObligationForCheck[]> {
  const column = entity.workerId ? "o.worker_id" : "o.machine_id";
  const value = entity.workerId ?? entity.machineId;
  if (!value) return [];

  const result = await client.query(
    `SELECT o.id, t.label AS type_label, t.blocks_assignment,
            obligation_state(o.expires_at, t.default_reminder_days, $2) AS state
       FROM obligations o
       JOIN obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
      WHERE ${column} = $1 AND o.superseded_by IS NULL`,
    [value, today],
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    typeLabel: String(row.type_label),
    state: String(row.state) as ObligationForCheck["state"],
    blocksAssignment: Boolean(row.blocks_assignment),
  }));
}

async function activeOverrides(
  client: PoolClient,
  assignmentId: string,
): Promise<AssignmentOverride[]> {
  const result = await client.query(
    "SELECT obligation_id, reason, valid_until, created_by FROM project_assignment_overrides WHERE assignment_id = $1",
    [assignmentId],
  );
  return result.rows.map((row) => ({
    obligationId: String(row.obligation_id),
    reason: String(row.reason),
    validUntil: toDate(row.valid_until) ?? "",
    createdBy: row.created_by ? String(row.created_by) : null,
  }));
}

export type AssignmentInput = {
  workerId?: string | null;
  machineId?: string | null;
  fromDate: string;
  toDate?: string | null;
  note?: string | null;
  overrides?: { obligationId: string; reason: string; validUntil: string }[];
};

/**
 * Dodjela radnika ili mašine na projekat.
 *
 * Redoslijed je namjeran: prvo se provjere obaveze (jeftino), pa se upiše dodjela, pa iznimke.
 * Iznimke se upisuju POSLIJE dodjele jer nose FK na nju, i to u istoj transakciji — ako iznimka
 * padne, padne i dodjela. Suprotno bi ostavilo dodjelu bez odobrenja.
 */
export async function createAssignment(
  pool: Pool,
  companyId: CompanyId,
  actor: ProjectActor,
  projectId: string,
  input: AssignmentInput,
): Promise<AssignmentRow | ServiceError> {
  const hasWorker = Boolean(input.workerId);
  const hasMachine = Boolean(input.machineId);
  if (hasWorker === hasMachine) {
    return {
      code: "VALIDATION_FAILED",
      message: "Dodjela ide ili radniku ili mašini — tačno jedno od toga.",
    };
  }
  if (!input.fromDate) {
    return { code: "VALIDATION_FAILED", message: "Datum početka je obavezan." };
  }
  if (input.toDate && input.toDate < input.fromDate) {
    return { code: "VALIDATION_FAILED", message: "Kraj dodjele ne može biti prije početka." };
  }

  return withCompany(pool, companyId, async (client) => {
    // Opseg: na tuđi projekat se ne dodaje niko.
    const ids = visibleProjectIds({ userId: actor.userId, scope: actor.scope, projectIds: actor.projectIds ?? [] });
    if (ids !== null && !ids.includes(projectId)) {
      return { code: "FORBIDDEN", message: "Nisi dodijeljen ovom projektu." } as ServiceError;
    }

    const project = await client.query("SELECT 1 FROM projects WHERE id = $1", [projectId]);
    if (project.rowCount === 0) {
      return { code: "NOT_FOUND", message: "Projekat nije pronađen." } as ServiceError;
    }

    if (input.workerId) {
      const worker = await client.query("SELECT 1 FROM workers WHERE id = $1 AND is_active", [input.workerId]);
      if (worker.rowCount === 0) {
        return { code: "NOT_FOUND", message: "Radnik nije pronađen ili nije aktivan." } as ServiceError;
      }
    }
    if (input.machineId) {
      const machine = await client.query("SELECT 1 FROM machines WHERE id = $1 AND is_active", [input.machineId]);
      if (machine.rowCount === 0) {
        return { code: "NOT_FOUND", message: "Mašina nije pronađena ili nije aktivna." } as ServiceError;
      }
    }

    const today = await companyToday(client, companyId);
    const obligations = await entityObligations(client, today, {
      workerId: input.workerId,
      machineId: input.machineId,
    });
    const requestedOverrides: AssignmentOverride[] = (input.overrides ?? []).map((entry) => ({
      obligationId: entry.obligationId,
      reason: entry.reason,
      validUntil: entry.validUntil,
    }));
    const check = checkAssignment(obligations, requestedOverrides, today);
    const blockMessage = assignmentBlockMessage(check);
    if (blockMessage) {
      return { code: "CONFLICT", message: blockMessage } as ServiceError;
    }

    const id = `pas_${crypto.randomUUID()}`;
    try {
      await client.query(
        `INSERT INTO project_assignments (id, company_id, project_id, worker_id, machine_id,
                                          from_date, to_date, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          companyId,
          projectId,
          input.workerId ?? null,
          input.machineId ?? null,
          input.fromDate,
          input.toDate || null,
          input.note?.trim() || null,
          actor.userId,
        ],
      );
      // Iznimke nose FK na dodjelu, pa idu tek sada — u istoj transakciji.
      for (const override of check.overridden) {
        const requested = requestedOverrides.find((entry) => entry.obligationId === override.obligationId);
        await client.query(
          `INSERT INTO project_assignment_overrides (id, company_id, assignment_id, obligation_id,
                                                     reason, valid_until, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            `pao_${crypto.randomUUID()}`,
            companyId,
            id,
            override.obligationId,
            requested?.reason.trim() ?? override.reason ?? "",
            requested?.validUntil ?? today,
            actor.userId,
          ],
        );
        await writeAudit(client, {
          companyId,
          actorId: actor.userId,
          actorEmail: null,
          action: "project.assignment_overridden",
          entityType: "project_assignment",
          entityId: id,
          metadata: {
            obligationId: override.obligationId,
            typeLabel: override.typeLabel,
            reason: requested?.reason.trim() ?? override.reason ?? "",
            validUntil: requested?.validUntil ?? today,
          },
        });
      }
    } catch (error) {
      // Triger u bazi baci `ASSIGNMENT_OVERLAP`; ekran ne treba da vidi naziv constraint-a.
      if (typeof error === "object" && error !== null && "message" in error) {
        const message = String((error as { message: unknown }).message);
        if (message.includes("ASSIGNMENT_OVERLAP")) {
          return {
            code: "CONFLICT",
            message: "Isti radnik ili mašina su već na ovom projektu u periodu koji se preklapa.",
          } as ServiceError;
        }
      }
      throw error;
    }

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: input.workerId ? "project.worker_assigned" : "project.machine_assigned",
      entityType: "project_assignment",
      entityId: id,
      metadata: {
        projectId,
        workerId: input.workerId ?? null,
        machineId: input.machineId ?? null,
        fromDate: input.fromDate,
        toDate: input.toDate || null,
      },
    });

    const created = await client.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [id]);
    const overrides = await activeOverrides(client, id);
    return toAssignment(created.rows[0]!, obligations, overrides, today);
  });
}

function toAssignment(
  row: Record<string, unknown>,
  obligations: ObligationForCheck[],
  overrides: AssignmentOverride[],
  today: string,
): AssignmentRow {
  const check = checkAssignment(obligations, overrides, today);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    workerId: row.worker_id ? String(row.worker_id) : null,
    workerName: row.worker_name ? String(row.worker_name) : null,
    machineId: row.machine_id ? String(row.machine_id) : null,
    machineCode: row.machine_code ? String(row.machine_code) : null,
    machineName: row.machine_name ? String(row.machine_name) : null,
    fromDate: toDate(row.from_date) ?? "",
    toDate: toDate(row.to_date),
    note: row.note ? String(row.note) : null,
    blocked: [...check.blocked, ...check.overridden],
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export async function listAssignments(
  pool: Pool,
  companyId: CompanyId,
  actor: ProjectActor,
  projectId: string,
): Promise<{ assignments: AssignmentRow[]; today: string } | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const ids = visibleProjectIds({ userId: actor.userId, scope: actor.scope, projectIds: actor.projectIds ?? [] });
    if (ids !== null && !ids.includes(projectId)) {
      return { code: "FORBIDDEN", message: "Nisi dodijeljen ovom projektu." } as ServiceError;
    }

    const today = await companyToday(client, companyId);
    const result = await client.query(`${ASSIGNMENT_SELECT} WHERE a.project_id = $1 ORDER BY a.from_date DESC`, [
      projectId,
    ]);

    const assignments: AssignmentRow[] = [];
    for (const row of result.rows) {
      const obligations = await entityObligations(client, today, {
        workerId: row.worker_id ? String(row.worker_id) : null,
        machineId: row.machine_id ? String(row.machine_id) : null,
      });
      const overrides = await activeOverrides(client, String(row.id));
      assignments.push(toAssignment(row, obligations, overrides, today));
    }

    return { assignments, today };
  });
}

export async function removeAssignment(
  pool: Pool,
  companyId: CompanyId,
  actor: ProjectActor,
  projectId: string,
  assignmentId: string,
): Promise<{ ok: true } | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const ids = visibleProjectIds({ userId: actor.userId, scope: actor.scope, projectIds: actor.projectIds ?? [] });
    if (ids !== null && !ids.includes(projectId)) {
      return { code: "FORBIDDEN", message: "Nisi dodijeljen ovom projektu." } as ServiceError;
    }

    const existing = await client.query(
      "SELECT worker_id, machine_id FROM project_assignments WHERE id = $1 AND project_id = $2",
      [assignmentId, projectId],
    );
    const row = existing.rows[0];
    if (!row) return { code: "NOT_FOUND", message: "Dodjela nije pronađena." } as ServiceError;

    // Dodjela se BRIŠE, a ne deaktivira: tim na projektu je trenutno stanje, a historija je u
    // auditu. Red koji „postoji ali ne važi" pravi zabunu u svakom izvještaju koji ga zatekne.
    await client.query("DELETE FROM project_assignments WHERE id = $1", [assignmentId]);

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.assignment_removed",
      entityType: "project_assignment",
      entityId: assignmentId,
      metadata: {
        projectId,
        workerId: row.worker_id ?? null,
        machineId: row.machine_id ?? null,
      },
    });

    return { ok: true };
  });
}

/**
 * Blokade koje bi pale dodjelu — za ekran PRIJE upisa.
 *
 * Ekran tako može pokazati „ovo ne može" i tražiti razlog iznimke, umjesto da čovjek popuni formu
 * i tek onda dobije odbijenicu.
 */
export async function assignmentPreview(
  pool: Pool,
  companyId: CompanyId,
  entity: { workerId?: string | null; machineId?: string | null },
): Promise<AssignmentBlockerRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const today = await companyToday(client, companyId);
    const obligations = await entityObligations(client, today, entity);
    const check = checkAssignment(obligations, [], today);
    return check.blocked;
  });
}
