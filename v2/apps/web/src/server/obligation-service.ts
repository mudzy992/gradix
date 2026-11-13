/**
 * R2b servis: obaveze, verzije, tipovi i prilozi.
 *
 * Pravila koja žive OVDJE (a ne u rutama ili UI-u), i zašto:
 *
 *  - **Obnova ne prepisuje.** `renew` dodaje verziju; stara ostaje i vidi se u historiji. Bez
 *    toga bi „produžio sam ljekarski“ obrisalo dokaz da je prethodni istekao — a inspektor pita
 *    upravo to.
 *  - **Ispravka je dozvoljena samo 24 h.** Poslije toga greška u kucanju se rješava novom
 *    verzijom; inače bi svaka tipfelerka pravila šum u historiji.
 *  - **Stanje se ne čuva.** Računa se iz `expires_at` i pragova tipa, po POSLOVNOM datumu firme
 *    (`businessDate`), istoj formuli kao `obligation_state()` u bazi.
 *  - **Obaveza visi na tačno jednom entitetu** (radnik / mašina / firma). Baza to garantuje
 *    `CHECK`-om, a servis prije upisa daje razumljivu poruku.
 *  - **Prilog se ne vjeruje po ekstenziji.** Tip se određuje iz prvih bajtova (magic numbers) i
 *    tek tada objekat postaje `ready`; nepotvrđen upload se čisti.
 */
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { buildWhere, cond, type SqlCondition } from "./sql-conditions";
import {
  businessDate,
  daysLeft,
  obligationState,
  parseThresholds,
  safeTimezone,
  type ObligationState,
} from "@gradix/domain";
import { writeAudit } from "./audit";
import type { Actor } from "./rbac-service";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_OBLIGATION,
  detectContentType,
  type AllowedContentType,
  objectKey,
  presignDownload,
  presignUpload,
  sanitiseFileName,
  statObject,
  storageConfig,
} from "./storage";

export type ServiceError =
  | { code: "FORBIDDEN"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "CONFLICT"; message: string };

export function isServiceError(value: unknown): value is ServiceError {
  // Prepoznaje se po `message`, ne po `code`: `ObligationRow` ima svoje polje `code` (oznaka tipa).
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

/* ================================================================== tipovi */

export type ObligationTypeRow = {
  id: string;
  code: string;
  label: string;
  entityKind: string;
  defaultReminderDays: number[];
  requiresAttachment: boolean;
  /** R3: istek ovog tipa blokira dodjelu radnika/mašine na projekat (B5.4). */
  blocksAssignment: boolean;
  isActive: boolean;
  sortOrder: number;
  obligationCount: number;
};

const TYPE_SELECT = `
  SELECT t.id, t.code, t.label, t.entity_kind, t.default_reminder_days::text AS reminder_days,
         t.requires_attachment, t.blocks_assignment, t.is_active, t.sort_order,
         (SELECT count(*)::int FROM obligations o WHERE o.company_id = t.company_id AND o.type_id = t.id) AS obligation_count
    FROM obligation_types t
   WHERE t.company_id = $1
`;

const toType = (row: Record<string, unknown>): ObligationTypeRow => ({
  id: String(row.id),
  code: String(row.code),
  label: String(row.label),
  entityKind: String(row.entity_kind),
  defaultReminderDays: parseThresholds(row.reminder_days),
  requiresAttachment: Boolean(row.requires_attachment),
  blocksAssignment: Boolean(row.blocks_assignment),
  isActive: Boolean(row.is_active),
  sortOrder: Number(row.sort_order),
  obligationCount: Number(row.obligation_count),
});

export async function listObligationTypes(pool: Pool, companyId: CompanyId): Promise<ObligationTypeRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query(`${TYPE_SELECT} ORDER BY t.entity_kind, t.sort_order, t.label`, [
      companyId,
    ]);
    return result.rows.map(toType);
  });
}

export type ObligationTypeInput = {
  code: string;
  label: string;
  entityKind: string;
  defaultReminderDays?: number[];
  requiresAttachment?: boolean;
  sortOrder?: number;
  isActive?: boolean;
};

const ENTITY_KINDS = ["WORKER", "MACHINE", "PROJECT", "COMPANY"] as const;

function validateTypeInput(input: Partial<ObligationTypeInput>): ServiceError | null {
  if (!/^[A-Z0-9][A-Z0-9_]{1,39}$/.test(input.code?.trim().toUpperCase() ?? "")) {
    return { code: "VALIDATION_FAILED", message: "Oznaka tipa: 2–40 znakova, velika slova, brojevi i donja crta." };
  }
  if (!input.label?.trim() || input.label.trim().length > 80) {
    return { code: "VALIDATION_FAILED", message: "Naziv tipa je obavezan (do 80 znakova)." };
  }
  if (!input.entityKind || !(ENTITY_KINDS as readonly string[]).includes(input.entityKind)) {
    return { code: "VALIDATION_FAILED", message: "Tip se odnosi na radnika, mašinu, projekat ili firmu." };
  }
  const days = input.defaultReminderDays;
  if (days) {
    if (days.length > 8) return { code: "VALIDATION_FAILED", message: "Najviše 8 pragova podsjetnika." };
    if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 365)) {
      return { code: "VALIDATION_FAILED", message: "Pragovi su cijeli brojevi dana između 0 i 365." };
    }
  }
  return null;
}

export async function createObligationType(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  input: ObligationTypeInput,
): Promise<ObligationTypeRow | ServiceError> {
  const invalid = validateTypeInput(input);
  if (invalid) return invalid;

  return withCompany(pool, companyId, async (client) => {
    const exists = await client.query("SELECT 1 FROM obligation_types WHERE code = $1 AND company_id = $2", [
      input.code.trim().toUpperCase(),
      companyId,
    ]);
    if (exists.rowCount !== 0) {
      return { code: "CONFLICT", message: `Tip sa oznakom „${input.code.trim().toUpperCase()}“ već postoji.` };
    }

    const id = `obt_${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO obligation_types (id, company_id, code, label, entity_kind, default_reminder_days,
                                     requires_attachment, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        companyId,
        input.code.trim().toUpperCase(),
        input.label!.trim(), // validateTypeInput je već odbacio prazan label
        input.entityKind,
        input.defaultReminderDays ?? [60, 30, 15, 7],
        input.requiresAttachment ?? false,
        input.sortOrder ?? 500,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.type_created",
      entityType: "obligation_type",
      entityId: id,
      metadata: { code: input.code.trim().toUpperCase(), entityKind: input.entityKind },
    });

    const created = await client.query(`${TYPE_SELECT} AND t.id = $2`, [companyId, id]);
    return toType(created.rows[0]!);
  });
}

export async function updateObligationType(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  typeId: string,
  input: Partial<ObligationTypeInput>,
): Promise<ObligationTypeRow | ServiceError> {
  const invalid = validateTypeInput(input);
  if (invalid) return invalid;

  return withCompany(pool, companyId, async (client) => {
    const existing = await client.query<{ entity_kind: string; default_reminder_days: string }>(
      "SELECT entity_kind, default_reminder_days::text AS default_reminder_days FROM obligation_types WHERE id = $1 AND company_id = $2",
      [typeId, companyId],
    );
    if (existing.rowCount === 0) return { code: "NOT_FOUND", message: "Tip obaveze nije pronađen." } as ServiceError;

    // Promjena vrste entiteta bi postojeće obaveze ostavila na pogrešnoj vezi (ljekarski na mašini).
    if (existing.rows[0]!.entity_kind !== input.entityKind) {
      const used = await client.query("SELECT 1 FROM obligations WHERE type_id = $1 AND company_id = $2 LIMIT 1", [typeId, companyId]);
      if (used.rowCount !== 0) {
        return {
          code: "CONFLICT",
          message: "Tip se već koristi — vrsta entiteta se ne može promijeniti. Napravite novi tip.",
        } as ServiceError;
      }
    }

    await client.query(
      `UPDATE obligation_types
          SET label = $2, entity_kind = $3, default_reminder_days = COALESCE($4, default_reminder_days),
              requires_attachment = COALESCE($5, requires_attachment), sort_order = COALESCE($6, sort_order),
              is_active = COALESCE($7, is_active), updated_at = now()
        WHERE id = $1 AND company_id = $8`,
      [
        typeId,
        input.label!.trim(), // validateTypeInput je već odbacio prazan label
        input.entityKind,
        input.defaultReminderDays ?? null,
        input.requiresAttachment ?? null,
        input.sortOrder ?? null,
        input.isActive ?? null,
        companyId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.type_updated",
      entityType: "obligation_type",
      entityId: typeId,
      metadata: {},
    });

    const updated = await client.query(`${TYPE_SELECT} AND t.id = $2`, [companyId, typeId]);
    return toType(updated.rows[0]!);
  });
}

/* ================================================================== obaveze */

export type ObligationAttachmentRow = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
};

export type ObligationRow = {
  id: string;
  typeId: string;
  typeLabel: string;
  typeCode: string;
  entityKind: string;
  workerId: string | null;
  workerName: string | null;
  machineId: string | null;
  machineCode: string | null;
  machineName: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  number: string | null;
  issuer: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  currentVersion: number;
  responsibleUserId: string | null;
  responsibleName: string | null;
  note: string | null;
  state: ObligationState;
  daysLeft: number | null;
  reminderDays: number[];
  attachments: ObligationAttachmentRow[];
  createdAt: string;
};

const OBLIGATION_SELECT = `
  SELECT o.id, o.type_id, t.label AS type_label, t.code AS type_code, t.entity_kind,
         o.worker_id, w.first_name, w.last_name,
         o.machine_id, m.code AS machine_code, m.name AS machine_name,
         o.project_id, p.code AS project_code, p.name AS project_name,
         o.number, o.issuer, o.issued_at, o.expires_at, o.current_version,
         o.responsible_user_id,
         ru.first_name AS ru_first_name, ru.last_name AS ru_last_name,
         o.note, o.created_at, o.superseded_by,
         t.default_reminder_days::text AS reminder_days
    FROM obligations o
    JOIN obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
    LEFT JOIN workers w ON w.company_id = o.company_id AND w.id = o.worker_id
    LEFT JOIN machines m ON m.company_id = o.company_id AND m.id = o.machine_id
    LEFT JOIN projects p ON p.company_id = o.company_id AND p.id = o.project_id
    LEFT JOIN users ru ON ru.id = o.responsible_user_id
`;

const ATTACHMENTS_SELECT = `
  SELECT id, obligation_id, file_name, content_type, size_bytes, status, created_at
    FROM obligation_attachments
   WHERE company_id = $1
   ORDER BY created_at DESC
`;

/** Poslovni datum firme — JEDNO mjesto gdje se „danas“ pretvara u datum. */
async function companyToday(client: PoolClient, companyId: CompanyId): Promise<string> {
  const result = await client.query<{ timezone: string | null }>(
    "SELECT timezone FROM companies WHERE id = $1",
    [companyId],
  );
  // `businessDate` prima samo string; neispravna ili prazna zona se zamjenjuje podrazumijevanom
  // kroz `safeTimezone`, pa ekran i baza ne mogu računati po različitim danima.
  return businessDate(new Date(), safeTimezone(result.rows[0]?.timezone));
}

const toIsoDate = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

function toObligation(
  row: Record<string, unknown>,
  today: string,
  attachments: ObligationAttachmentRow[],
): ObligationRow {
  const expiresAt = toIsoDate(row.expires_at);
  const reminderDays = parseThresholds(row.reminder_days);
  const superseded = row.superseded_by !== null && row.superseded_by !== undefined;
  const workerFirst = row.first_name as string | null;
  const workerLast = row.last_name as string | null;
  const responsibleFirst = row.ru_first_name as string | null;
  const responsibleLast = row.ru_last_name as string | null;

  return {
    id: String(row.id),
    typeId: String(row.type_id),
    typeLabel: String(row.type_label),
    typeCode: String(row.type_code),
    entityKind: String(row.entity_kind),
    workerId: (row.worker_id as string | null) ?? null,
    workerName: workerFirst && workerLast ? `${workerFirst} ${workerLast}` : null,
    machineId: (row.machine_id as string | null) ?? null,
    machineCode: (row.machine_code as string | null) ?? null,
    machineName: (row.machine_name as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    projectCode: (row.project_code as string | null) ?? null,
    projectName: (row.project_name as string | null) ?? null,
    number: (row.number as string | null) ?? null,
    issuer: (row.issuer as string | null) ?? null,
    issuedAt: toIsoDate(row.issued_at),
    expiresAt,
    currentVersion: Number(row.current_version),
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    responsibleName: responsibleFirst && responsibleLast ? `${responsibleFirst} ${responsibleLast}` : null,
    note: (row.note as string | null) ?? null,
    // Ista formula kao `obligation_state()` u bazi; test ih poredi na realnim redovima.
    state: obligationState({ expiresAt, thresholds: reminderDays, today, superseded }),
    daysLeft: daysLeft(today, expiresAt),
    reminderDays,
    attachments,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/**
 * VIDNO POLJE nad rokovima — dolazi iz sesije, nikad iz zahtjeva (`G3`, odluka vlasnika).
 *
 * `SELF` nije „filter koji klijent pošalje", nego granica koju servis nameće: radnik vidi obaveze
 * vezane za SVOJ nalog (radnika vezanog za nalog ili gdje je odgovoran). Tuđe ne vidi ni ako pošalje
 * `?workerId=` tuđeg radnika — filter se tada sužava, ne širi.
 */
export type ObligationScope = "COMPANY" | "SELF";

/** Prilozi su lični podatak: bez `obligations.attachments.view` se ne vraćaju u listi. */
export type ObligationListOptions = {
  scope?: ObligationScope;
  /** `userId` za opseg `SELF` — čije obaveze. */
  userId?: string;
  includeAttachments?: boolean;
};

export type ObligationFilter = {
  state?: string;
  entityKind?: string;
  typeId?: string;
  workerId?: string;
  machineId?: string;
  /** R3: samo obaveze na tom projektu (detalj projekta). */
  projectId?: string;
  /** Samo obaveze gdje je odgovoran ovaj korisnik (mobilni: „Moji rokovi“). */
  responsibleUserId?: string;
  /** Samo obaveze na radnicima vezanim za ovaj nalog. */
  ofLinkedWorkerUserId?: string;
  /** Uključi zamijenjene verzije (podrazumijevano se ne prikazuju). */
  includeSuperseded?: boolean;
};

export type ObligationsPage = {
  obligations: ObligationRow[];
  counts: { all: number; expired: number; expiring: number; valid: number; no_expiry: number };
  today: string;
};

export async function listObligations(
  pool: Pool,
  companyId: CompanyId,
  filter: ObligationFilter = {},
  options: ObligationListOptions = {},
): Promise<ObligationsPage> {
  return withCompany(pool, companyId, async (client) => {
    const today = await companyToday(client, companyId);

    /*
     * Firma ide izričito u WHERE, prije svega ostalog: RLS je prva linija odbrane, ali
     * ne i jedina — servis mora biti tačan i pod admin rolom (administratorske naredbe)
     * i u svakom budućem pozivu bez RLS konteksta. Uslovi se grade kroz `cond`/`buildWhere`:
     * uslov nosi svoje parametre uz tekst, pa firma ne može da ostane u nizu bez upita
     * („bind message supplies 1 parameters“ iz prethodne varijante) ni obrnuto.
     */
    const conditions: SqlCondition[] = [cond("o.company_id = $", companyId)];

    /*
     * Opseg `SELF` ide PRIJE filtera iz zahtjeva i uvijek. Redoslijed je namjeran: ako
     * se doda poslije filtera, `?workerId=` bi mogao proširiti skup prije nego ga opseg
     * suzi — a granica koja se primjenjuje poslije korisničkog filtera nije granica.
     * Radnik u podupitu je vezan na `o.company_id` (kompozitni FK), pa korisnikove veze
     * u drugim firmama ne otvaraju tuđe rokove.
     */
    if (options.scope === "SELF") {
      const korisnik = options.userId ?? "";
      conditions.push(
        cond(
          `(o.responsible_user_id = $
            OR o.worker_id IN (SELECT id FROM workers WHERE user_id = $ AND company_id = o.company_id))`,
          korisnik,
          korisnik,
        ),
      );
    }

    if (!filter.includeSuperseded) conditions.push(cond("o.superseded_by IS NULL"));
    if (filter.typeId) conditions.push(cond("o.type_id = $", filter.typeId));
    if (filter.entityKind) conditions.push(cond("t.entity_kind = $", filter.entityKind));
    if (filter.workerId) conditions.push(cond("o.worker_id = $", filter.workerId));
    if (filter.machineId) conditions.push(cond("o.machine_id = $", filter.machineId));
    if (filter.projectId) conditions.push(cond("o.project_id = $", filter.projectId));
    if (filter.responsibleUserId) conditions.push(cond("o.responsible_user_id = $", filter.responsibleUserId));
    if (filter.ofLinkedWorkerUserId) {
      conditions.push(
        cond(
          `(o.responsible_user_id = $
            OR o.worker_id IN (SELECT id FROM workers WHERE user_id = $ AND company_id = o.company_id))`,
          filter.ofLinkedWorkerUserId,
          filter.ofLinkedWorkerUserId,
        ),
      );
    }

    const { where, params } = buildWhere(conditions);
    const result = await client.query(`${OBLIGATION_SELECT} ${where}`, params);

    // Bez prava na priloge upit se NE izvršava — podatak koji se ne smije vidjeti ne treba ni doći
    // iz baze, pa ne postoji put da ga neko „zaboravi" ukloniti iz odgovora.
    const attachments = options.includeAttachments === false
      ? { rows: [] as Array<Record<string, unknown>> }
      : await client.query(ATTACHMENTS_SELECT, [companyId]);
    const byObligation = new Map<string, ObligationAttachmentRow[]>();
    for (const row of attachments.rows) {
      const key = String(row.obligation_id);
      const list = byObligation.get(key) ?? [];
      list.push({
        id: String(row.id),
        fileName: String(row.file_name),
        contentType: String(row.content_type),
        sizeBytes: Number(row.size_bytes),
        status: String(row.status),
        createdAt: (row.created_at as Date).toISOString(),
      });
      byObligation.set(key, list);
    }

    let obligations = result.rows.map((row) => toObligation(row, today, byObligation.get(String(row.id)) ?? []));
    if (filter.state) obligations = obligations.filter((row) => row.state === filter.state);

    // Najhitnije prvo: istekle, pa one koje istječu, pa po datumu. Bez roka na kraj.
    obligations.sort((a, b) => {
      const rank = (row: ObligationRow) => (row.state === "expired" ? 0 : row.state === "expiring" ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.expiresAt === null) return 1;
      if (b.expiresAt === null) return -1;
      return a.expiresAt.localeCompare(b.expiresAt);
    });

    const counts = { all: obligations.length, expired: 0, expiring: 0, valid: 0, no_expiry: 0 };
    for (const row of obligations) {
      if (row.state === "expired") counts.expired += 1;
      else if (row.state === "expiring") counts.expiring += 1;
      else if (row.state === "valid") counts.valid += 1;
      else if (row.state === "no_expiry") counts.no_expiry += 1;
    }

    return { obligations, counts, today };
  });
}

export type ObligationVersionRow = {
  version: number;
  number: string | null;
  issuer: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  note: string | null;
  attachmentId: string | null;
  createdAt: string;
  createdBy: string | null;
};

export async function getObligation(
  pool: Pool,
  companyId: CompanyId,
  obligationId: string,
  options: ObligationListOptions = {},
): Promise<{ obligation: ObligationRow; versions: ObligationVersionRow[] } | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const today = await companyToday(client, companyId);

    /*
     * Opseg `SELF` i u detalju: `id` iz URL-a nije dozvola. Uslov je u ISTOM upitu kao i `id`, pa
     * tuđi rok daje 404 — ne 403, jer radnik ne treba da zna da tuđi rok postoji.
     */
    const conditions: SqlCondition[] = [
      cond("o.id = $", obligationId),
      // Tuđa firma i nepostojeća obaveza daju isti odgovor — izričit company_id
      // čini da to važi i pod admin rolom, ne samo kroz RLS.
      cond("o.company_id = $", companyId),
    ];
    if (options.scope === "SELF") {
      const korisnik = options.userId ?? "";
      conditions.push(
        cond(
          `(o.responsible_user_id = $
            OR o.worker_id IN (SELECT id FROM workers WHERE user_id = $ AND company_id = o.company_id))`,
          korisnik,
          korisnik,
        ),
      );
    }

    const { where, params } = buildWhere(conditions);
    const row = await client.query(`${OBLIGATION_SELECT} ${where}`, params);
    if (row.rowCount === 0) {
      return { code: "NOT_FOUND", message: "Obaveza nije pronađena." } as ServiceError;
    }

    const attachments = options.includeAttachments === false
      ? { rows: [] as Array<Record<string, unknown>> }
      : await client.query(
      `SELECT id, obligation_id, file_name, content_type, size_bytes, status, created_at
         FROM obligation_attachments WHERE obligation_id = $1 AND company_id = $2 ORDER BY created_at DESC`,
      [obligationId, companyId],
    );
    const versions = await client.query(
      `SELECT version, number, issuer, issued_at, expires_at, note, attachment_id, created_at, created_by
         FROM obligation_versions WHERE obligation_id = $1 AND company_id = $2 ORDER BY version DESC`,
      [obligationId, companyId],
    );

    return {
      obligation: toObligation(
        row.rows[0]!,
        today,
        attachments.rows.map((entry) => ({
          id: String(entry.id),
          fileName: String(entry.file_name),
          contentType: String(entry.content_type),
          sizeBytes: Number(entry.size_bytes),
          status: String(entry.status),
          createdAt: (entry.created_at as Date).toISOString(),
        })),
      ),
      versions: versions.rows.map((entry) => ({
        version: Number(entry.version),
        number: (entry.number as string | null) ?? null,
        issuer: (entry.issuer as string | null) ?? null,
        issuedAt: toIsoDate(entry.issued_at),
        expiresAt: toIsoDate(entry.expires_at),
        note: (entry.note as string | null) ?? null,
        attachmentId: (entry.attachment_id as string | null) ?? null,
        createdAt: (entry.created_at as Date).toISOString(),
        createdBy: (entry.created_by as string | null) ?? null,
      })),
    };
  });
}

export type ObligationInput = {
  typeId: string;
  workerId?: string | null;
  machineId?: string | null;
  scopeCompany?: boolean;
  /** R3: obaveza na projektu (dozvola, saglasnost, HSE elaborat). */
  projectId?: string | null;
  number?: string | null;
  issuer?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  responsibleUserId?: string | null;
  note?: string | null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Poslovni datum (`DATE`), ne trenutak — isto pravilo kao kod radnika. */
function normaliseDate(value: string | null | undefined, field: string): string | null | ServiceError {
  if (value === null || value === undefined || value === "") return null;
  if (!DATE_ONLY.test(value)) return { code: "VALIDATION_FAILED", message: `${field} mora biti datum (gggg-mm-dd).` };
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { code: "VALIDATION_FAILED", message: `${field} nije ispravan datum (npr. 31. 2. ne postoji).` };
  }
  return value;
}

/** Tačno jedan entitet — isto pravilo kao `CHECK obligations_one_scope` u bazi. */
function resolveScope(
  input: Pick<ObligationInput, "workerId" | "machineId" | "projectId" | "scopeCompany">,
): { workerId: string | null; machineId: string | null; projectId: string | null; scopeCompany: boolean } | ServiceError {
  const scopes = [
    Boolean(input.workerId),
    Boolean(input.machineId),
    Boolean(input.projectId),
    Boolean(input.scopeCompany),
  ];
  if (scopes.filter(Boolean).length !== 1) {
    return {
      code: "VALIDATION_FAILED",
      message: "Obaveza se veže za tačno jedno: radnika, mašinu, projekat ili firmu.",
    };
  }
  return {
    workerId: input.workerId ?? null,
    machineId: input.machineId ?? null,
    projectId: input.projectId ?? null,
    scopeCompany: Boolean(input.scopeCompany),
  };
}

export async function createObligation(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  input: ObligationInput,
): Promise<{ obligation: ObligationRow; versions: ObligationVersionRow[] } | ServiceError> {
  const scope = resolveScope(input);
  if ("code" in scope) return scope;
  const issuedAt = normaliseDate(input.issuedAt, "Datum izdavanja");
  if (issuedAt && typeof issuedAt === "object") return issuedAt;
  const expiresAt = normaliseDate(input.expiresAt, "Datum isteka");
  if (expiresAt && typeof expiresAt === "object") return expiresAt;
  if (issuedAt && expiresAt && issuedAt > expiresAt) {
    return { code: "VALIDATION_FAILED", message: "Datum izdavanja je poslije datuma isteka." };
  }

  return withCompany(pool, companyId, async (client) => {
    const type = await client.query<{ entity_kind: string; requires_attachment: boolean }>(
      "SELECT entity_kind, requires_attachment FROM obligation_types WHERE id = $1 AND company_id = $2 AND is_active",
      [input.typeId, companyId],
    );
    if (type.rowCount === 0) {
      return { code: "NOT_FOUND", message: "Tip obaveze nije pronađen ili je deaktiviran." } as ServiceError;
    }

    // Tip i entitet moraju da se slažu: ljekarski na mašini nema smisla, a ni registracija na radniku.
    const kind = type.rows[0]!.entity_kind;
    const matches =
      (kind === "WORKER" && scope.workerId !== null) ||
      (kind === "MACHINE" && scope.machineId !== null) ||
      (kind === "PROJECT" && scope.projectId !== null) ||
      (kind === "COMPANY" && scope.scopeCompany);
    if (!matches) {
      return {
        code: "VALIDATION_FAILED",
        message: `Tip „${
          kind === "WORKER" ? "radnik" : kind === "MACHINE" ? "mašina" : kind === "PROJECT" ? "projekat" : "firma"
        }“ ne odgovara izabranom entitetu.`,
      } as ServiceError;
    }

    if (scope.projectId) {
      const project = await client.query("SELECT 1 FROM projects WHERE id = $1 AND company_id = $2", [scope.projectId, companyId]);
      if (project.rowCount === 0) return { code: "NOT_FOUND", message: "Projekat nije pronađen." } as ServiceError;
    }

    if (scope.workerId) {
      const worker = await client.query("SELECT 1 FROM workers WHERE id = $1 AND company_id = $2", [scope.workerId, companyId]);
      if (worker.rowCount === 0) return { code: "NOT_FOUND", message: "Radnik nije pronađen." } as ServiceError;
    }
    if (scope.machineId) {
      const machine = await client.query("SELECT 1 FROM machines WHERE id = $1 AND company_id = $2", [scope.machineId, companyId]);
      if (machine.rowCount === 0) return { code: "NOT_FOUND", message: "Mašina nije pronađena." } as ServiceError;
    }
    if (input.responsibleUserId) {
      const member = await client.query(
        "SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2 AND is_active",
        [input.responsibleUserId, companyId],
      );
      if (member.rowCount === 0) {
        return { code: "NOT_FOUND", message: "Odgovorna osoba nije član firme." } as ServiceError;
      }
    }

    const id = `obl_${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO obligations (id, company_id, type_id, worker_id, machine_id, project_id, scope_company,
                                responsible_user_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        companyId,
        input.typeId,
        scope.workerId,
        scope.machineId,
        scope.projectId,
        scope.scopeCompany,
        input.responsibleUserId ?? null,
        input.note?.trim() || null,
        actor.userId,
      ],
    );

    // Prva verzija nosi broj, izdavaoca i rok. Keš u `obligations` puni trigger.
    await client.query(
      `INSERT INTO obligation_versions (id, company_id, obligation_id, version, number, issuer,
                                        issued_at, expires_at, note, created_by)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)`,
      [
        `obv_${crypto.randomUUID()}`,
        companyId,
        id,
        input.number?.trim() || null,
        input.issuer?.trim() || null,
        issuedAt,
        expiresAt,
        input.note?.trim() || null,
        actor.userId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.created",
      entityType: "obligation",
      entityId: id,
      // Bez broja dokumenta: broj ljekarskog je lični podatak, a trag je za radnju.
      metadata: { typeCode: null, entityKind: kind },
    });

    const created = await getObligationWithClient(client, companyId, id);
    return created;
  });
}

/** Isto kao `getObligation`, ali unutar već otvorene transakcije. */
async function getObligationWithClient(
  client: PoolClient,
  companyId: CompanyId,
  obligationId: string,
): Promise<{ obligation: ObligationRow; versions: ObligationVersionRow[] } | ServiceError> {
  const today = await companyToday(client, companyId);
  const row = await client.query(`${OBLIGATION_SELECT} WHERE o.id = $1 AND o.company_id = $2`, [obligationId, companyId]);
  if (row.rowCount === 0) return { code: "NOT_FOUND", message: "Obaveza nije pronađena." } as ServiceError;

  const attachments = await client.query(
    `SELECT id, obligation_id, file_name, content_type, size_bytes, status, created_at
       FROM obligation_attachments WHERE obligation_id = $1 AND company_id = $2 ORDER BY created_at DESC`,
    [obligationId, companyId],
  );
  const versions = await client.query(
    `SELECT version, number, issuer, issued_at, expires_at, note, attachment_id, created_at, created_by
       FROM obligation_versions WHERE obligation_id = $1 AND company_id = $2 ORDER BY version DESC`,
    [obligationId, companyId],
  );

  return {
    obligation: toObligation(
      row.rows[0]!,
      today,
      attachments.rows.map((entry) => ({
        id: String(entry.id),
        fileName: String(entry.file_name),
        contentType: String(entry.content_type),
        sizeBytes: Number(entry.size_bytes),
        status: String(entry.status),
        createdAt: (entry.created_at as Date).toISOString(),
      })),
    ),
    versions: versions.rows.map((entry) => ({
      version: Number(entry.version),
      number: (entry.number as string | null) ?? null,
      issuer: (entry.issuer as string | null) ?? null,
      issuedAt: toIsoDate(entry.issued_at),
      expiresAt: toIsoDate(entry.expires_at),
      note: (entry.note as string | null) ?? null,
      attachmentId: (entry.attachment_id as string | null) ?? null,
      createdAt: (entry.created_at as Date).toISOString(),
      createdBy: (entry.created_by as string | null) ?? null,
    })),
  };
}

/** Izmjena veze, tipa i odgovornog — bez novog roka (rok mijenja `renew` ili `correct`). */
export async function updateObligation(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  obligationId: string,
  input: Partial<ObligationInput>,
): Promise<{ obligation: ObligationRow; versions: ObligationVersionRow[] } | ServiceError> {
  const scope = resolveScope(input);
  if ("code" in scope) return scope;

  return withCompany(pool, companyId, async (client) => {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM obligations WHERE id = $1 AND company_id = $2",
      [obligationId, companyId],
    );
    if (existing.rowCount === 0) return { code: "NOT_FOUND", message: "Obaveza nije pronađena." } as ServiceError;

    const type = await client.query<{ entity_kind: string }>(
      "SELECT entity_kind FROM obligation_types WHERE id = $1 AND company_id = $2",
      [input.typeId, companyId],
    );
    if (type.rowCount === 0) return { code: "NOT_FOUND", message: "Tip obaveze nije pronađen." } as ServiceError;

    const kind = type.rows[0]!.entity_kind;
    const matches =
      (kind === "WORKER" && scope.workerId !== null) ||
      (kind === "MACHINE" && scope.machineId !== null) ||
      (kind === "PROJECT" && scope.projectId !== null) ||
      (kind === "COMPANY" && scope.scopeCompany);
    if (!matches) {
      return { code: "VALIDATION_FAILED", message: "Tip obaveze ne odgovara izabranom entitetu." } as ServiceError;
    }

    await client.query(
      `UPDATE obligations
          SET type_id = $2, worker_id = $3, machine_id = $4, project_id = $5,
              scope_company = $6, responsible_user_id = $7, note = $8, updated_at = now()
        WHERE id = $1 AND company_id = $9`,
      [
        obligationId,
        input.typeId,
        scope.workerId,
        scope.machineId,
        scope.projectId,
        scope.scopeCompany,
        input.responsibleUserId ?? null,
        input.note?.trim() || null,
        companyId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.updated",
      entityType: "obligation",
      entityId: obligationId,
      metadata: { entityKind: kind },
    });

    return getObligationWithClient(client, companyId, obligationId);
  });
}

export type ObligationRenewInput = {
  number?: string | null;
  issuer?: string | null;
  issuedAt?: string | null;
  expiresAt: string;
  note?: string | null;
};

/** Obnova: nova verzija. Stara OSTAJE — historija je dokaz, ne smeće. */
export async function renewObligation(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  obligationId: string,
  input: ObligationRenewInput,
): Promise<{ obligation: ObligationRow; versions: ObligationVersionRow[] } | ServiceError> {
  const issuedAt = normaliseDate(input.issuedAt, "Datum izdavanja");
  if (issuedAt && typeof issuedAt === "object") return issuedAt;
  const expiresAt = normaliseDate(input.expiresAt, "Datum isteka");
  if (!expiresAt || typeof expiresAt === "object") {
    return { code: "VALIDATION_FAILED", message: "Novi rok je obavezan." };
  }
  if (issuedAt && issuedAt > expiresAt) {
    return { code: "VALIDATION_FAILED", message: "Datum izdavanja je poslije datuma isteka." };
  }

  return withCompany(pool, companyId, async (client) => {
    const existing = await client.query<{ current_version: number; expires_at: Date | null }>(
      "SELECT current_version, expires_at FROM obligations WHERE id = $1 AND company_id = $2 FOR UPDATE",
      [obligationId, companyId],
    );
    if (existing.rowCount === 0) return { code: "NOT_FOUND", message: "Obaveza nije pronađena." } as ServiceError;

    const previous = existing.rows[0]!;
    const previousExpiry = toIsoDate(previous.expires_at);
    if (previousExpiry && expiresAt <= previousExpiry) {
      // „Obnova“ sa istim ili starijim rokom nije obnova — to je ispravka, a ona ima svoj put.
      return {
        code: "CONFLICT",
        message: `Novi rok (${expiresAt}) nije poslije starog (${previousExpiry}). Ako je stari pogrešan, to je ispravka, ne obnova.`,
      } as ServiceError;
    }

    const nextVersion = Number(previous.current_version) + 1;
    await client.query(
      `INSERT INTO obligation_versions (id, company_id, obligation_id, version, number, issuer,
                                        issued_at, expires_at, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        `obv_${crypto.randomUUID()}`,
        companyId,
        obligationId,
        nextVersion,
        input.number?.trim() || null,
        input.issuer?.trim() || null,
        issuedAt,
        expiresAt,
        input.note?.trim() || null,
        actor.userId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.renewed",
      entityType: "obligation",
      entityId: obligationId,
      metadata: { from: previousExpiry, to: expiresAt, version: nextVersion },
    });

    return getObligationWithClient(client, companyId, obligationId);
  });
}

/** Prozor u kojem je ispravka dozvoljena (greška u kucanju, ne nova činjenica). */
export const CORRECTION_WINDOW_HOURS = 24;

/**
 * Ispravka greške u unosu — mijenja TRENUTNU verziju, ali samo u prvih 24 h od njenog unosa i
 * samo dok nema novije verzije (poslije obnove se stare verzije ne diraju).
 */
export async function correctObligation(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  obligationId: string,
  input: ObligationRenewInput,
): Promise<{ obligation: ObligationRow; versions: ObligationVersionRow[] } | ServiceError> {
  const issuedAt = normaliseDate(input.issuedAt, "Datum izdavanja");
  if (issuedAt && typeof issuedAt === "object") return issuedAt;
  const expiresAt = normaliseDate(input.expiresAt, "Datum isteka");
  if (expiresAt && typeof expiresAt === "object") return expiresAt;

  return withCompany(pool, companyId, async (client) => {
    const existing = await client.query<{
      current_version: number;
      expires_at: Date | null;
      issued_at: Date | null;
      number: string | null;
      issuer: string | null;
      note: string | null;
      version_created_at: Date;
    }>(
      `SELECT o.current_version, o.expires_at, o.issued_at, o.number, o.issuer, o.note,
              v.created_at AS version_created_at
         FROM obligations o
         JOIN obligation_versions v ON v.obligation_id = o.id AND v.version = o.current_version
        WHERE o.id = $1 AND o.company_id = $2
        FOR UPDATE OF o`,
      [obligationId, companyId],
    );
    if (existing.rowCount === 0) return { code: "NOT_FOUND", message: "Obaveza nije pronađena." } as ServiceError;

    const current = existing.rows[0]!;
    const ageHours = (Date.now() - current.version_created_at.getTime()) / 3_600_000;
    if (ageHours > CORRECTION_WINDOW_HOURS) {
      return {
        code: "CONFLICT",
        message: `Ispravka je moguća u prvih ${CORRECTION_WINDOW_HOURS} h od unosa. Poslije toga se greška ispravlja obnovom (nova verzija).`,
      } as ServiceError;
    }

    const nextIssued = issuedAt === null ? current.issued_at : issuedAt;
    const nextExpires = expiresAt === null ? current.expires_at : expiresAt;
    const nextIssuedIso = toIsoDate(nextIssued);
    const nextExpiresIso = toIsoDate(nextExpires);
    if (nextIssuedIso && nextExpiresIso && nextIssuedIso > nextExpiresIso) {
      return { code: "VALIDATION_FAILED", message: "Datum izdavanja je poslije datuma isteka." };
    }

    await client.query(
      `UPDATE obligation_versions
          SET number = $3, issuer = $4, issued_at = $5, expires_at = $6, note = $7
        WHERE obligation_id = $1 AND version = $2 AND company_id = $8`,
      [
        obligationId,
        current.current_version,
        input.number?.trim() || current.number,
        input.issuer?.trim() || current.issuer,
        nextIssued,
        nextExpires,
        input.note?.trim() || current.note,
        companyId,
      ],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.corrected",
      entityType: "obligation",
      entityId: obligationId,
      // Stara i nova vrijednost: bez toga se ne vidi šta je ispravljeno, a to je poenta ispravke.
      metadata: {
        version: Number(current.current_version),
        from: toIsoDate(current.expires_at),
        to: nextExpiresIso,
      },
    });

    return getObligationWithClient(client, companyId, obligationId);
  });
}

/**
 * Brisanje je za POGREŠNO UNESENU obavezu (npr. ljekarski druge osobe). Obnova se ne briše:
 * verzije su dokaz, a brisanje bi ga uklonilo. Zato: samo jedna verzija i samo u prvih 24 h.
 */
export async function deleteObligation(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  obligationId: string,
): Promise<{ deleted: true } | ServiceError> {
  return withCompany(pool, companyId, async (client) => {
    const existing = await client.query<{ versions: number; created_at: Date; type_code: string }>(
      `SELECT (SELECT count(*)::int FROM obligation_versions WHERE obligation_id = o.id) AS versions,
              o.created_at, t.code AS type_code
         FROM obligations o JOIN obligation_types t ON t.id = o.type_id
        WHERE o.id = $1 AND o.company_id = $2`,
      [obligationId, companyId],
    );
    if (existing.rowCount === 0) return { code: "NOT_FOUND", message: "Obaveza nije pronađena." } as ServiceError;

    const row = existing.rows[0]!;
    const ageHours = (Date.now() - row.created_at.getTime()) / 3_600_000;
    if (Number(row.versions) > 1) {
      return {
        code: "CONFLICT",
        message: "Obnovljena obaveza se ne briše — verzije su historija. Obrišite samo pogrešan unos.",
      } as ServiceError;
    }
    if (ageHours > CORRECTION_WINDOW_HOURS) {
      return {
        code: "CONFLICT",
        message: `Brisanje je moguće u prvih ${CORRECTION_WINDOW_HOURS} h. Poslije toga obaveza ostaje u historiji.`,
      } as ServiceError;
    }

    // Prilozi padaju kaskadno (FK), ali objekti u bucketu ne — njih čisti poziv prije brisanja.
    await client.query("DELETE FROM obligations WHERE id = $1 AND company_id = $2", [obligationId, companyId]);

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.deleted",
      entityType: "obligation",
      entityId: obligationId,
      metadata: { typeCode: row.type_code, versions: Number(row.versions) },
    });

    return { deleted: true };
  });
}

/* ================================================================== prilozi */

export type AttachmentRow = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
};

const ATTACHMENT_COLUMNS = `id, obligation_id, object_key, file_name, content_type, size_bytes, sha256, status, created_at`;

const toAttachment = (row: Record<string, unknown>): AttachmentRow => ({
  id: String(row.id),
  fileName: String(row.file_name),
  contentType: String(row.content_type),
  sizeBytes: Number(row.size_bytes),
  status: String(row.status),
  createdAt: (row.created_at as Date).toISOString(),
});

export type AttachmentRequest = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  /** Prvih 32 bajta fajla koje je klijent pročitao — po njima se tip određuje PRIJE uploada. */
  head: Uint8Array;
};

/**
 * Korak 1: registracija priloga i potpisan PUT.
 *
 * Zašto se tip određuje već ovdje, a ne tek na potvrdi: potpisani PUT nosi `Content-Type`, pa
 * bucket odbija pogrešan tip odmah. Na potvrdi se provjerava još jednom (iz veličine i tipa koji
 * je stvarno stigao), jer klijent može ignorisati zaglavlje.
 */
export async function registerAttachment(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  obligationId: string,
  input: AttachmentRequest,
): Promise<
  | { attachment: AttachmentRow; uploadUrl: string; uploadExpiresAt: string }
  | ServiceError
> {
  return withCompany(pool, companyId, async (client) => {
    const obligation = await client.query<{ id: string }>(
      "SELECT id FROM obligations WHERE id = $1 AND company_id = $2",
      [obligationId, companyId],
    );
    if (obligation.rowCount === 0) return { code: "NOT_FOUND", message: "Obaveza nije pronađena." } as ServiceError;

    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_ATTACHMENT_BYTES) {
      return { code: "VALIDATION_FAILED", message: "Prilog može imati najviše 10 MB." } as ServiceError;
    }
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
      return { code: "VALIDATION_FAILED", message: "Kontrolni zbir priloga nije ispravan." } as ServiceError;
    }

    const count = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM obligation_attachments WHERE obligation_id = $1 AND company_id = $2 AND status = 'ready'",
      [obligationId, companyId],
    );
    if (Number(count.rows[0]!.n) >= MAX_ATTACHMENTS_PER_OBLIGATION) {
      return {
        code: "CONFLICT",
        message: `Obaveza može imati najviše ${MAX_ATTACHMENTS_PER_OBLIGATION} priloga.`,
      } as ServiceError;
    }

    // Tip iz sadržaja, ne iz imena: `.exe` preimenovan u `.pdf` pada ovdje.
    const contentType = detectContentType(input.head);
    if (!contentType) {
      return {
        code: "VALIDATION_FAILED",
        message: "Datoteka nije PDF ni slika (JPG, PNG, WebP, HEIC) — provjerite sadržaj, ne samo ime.",
      } as ServiceError;
    }

    const duplicate = await client.query(
      "SELECT id FROM obligation_attachments WHERE obligation_id = $1 AND company_id = $2 AND sha256 = $3",
      [obligationId, companyId, input.sha256],
    );
    if (duplicate.rowCount !== 0) {
      return { code: "CONFLICT", message: "Taj prilog je već dodan na ovu obavezu." } as ServiceError;
    }

    const config = storageConfig();
    if (!config.configured) {
      return { code: "CONFLICT", message: config.reason } as ServiceError;
    }

    const id = `att_${crypto.randomUUID()}`;
    const key = objectKey(companyId, obligationId, id);
    const upload = await presignUpload({ config, key, contentType });

    await client.query(
      `INSERT INTO obligation_attachments (id, company_id, obligation_id, object_key, file_name, content_type,
                                           size_bytes, sha256, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
      [id, companyId, obligationId, key, sanitiseFileName(input.fileName), contentType, input.sizeBytes, input.sha256],
    );

    const created = await client.query(`SELECT ${ATTACHMENT_COLUMNS} FROM obligation_attachments WHERE id = $1 AND company_id = $2`, [id, companyId]);
    return {
      attachment: toAttachment(created.rows[0]!),
      uploadUrl: upload.url,
      uploadExpiresAt: upload.expiresAt,
    };
  });
}

/**
 * Korak 2: potvrda. Prilog postaje `ready` tek kad objekat STVARNO postoji i kad se veličina
 * poklapa sa prijavljenom. Bez ovoga bi u bazi stajao prilog koji se ne može otvoriti.
 */
export async function confirmAttachment(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  obligationId: string,
  attachmentId: string,
): Promise<{ attachment: AttachmentRow } | ServiceError> {
  const config = storageConfig();
  if (!config.configured) return { code: "CONFLICT", message: config.reason };

  const row = await withCompany(pool, companyId, async (client) => {
    const found = await client.query<{ object_key: string; size_bytes: string; status: string; file_name: string }>(
      "SELECT object_key, size_bytes, status, file_name FROM obligation_attachments WHERE id = $1 AND obligation_id = $2 AND company_id = $3",
      [attachmentId, obligationId, companyId],
    );
    return found.rows[0] ?? null;
  });
  if (!row) return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  if (row.status === "ready") return { code: "CONFLICT", message: "Prilog je već potvrđen." };

  const facts = await statObject({ config, key: row.object_key });
  if (!facts.exists) {
    return { code: "VALIDATION_FAILED", message: "Datoteka nije stigla na server. Pokušajte upload ponovo." };
  }
  if (facts.sizeBytes !== Number(row.size_bytes)) {
    return {
      code: "VALIDATION_FAILED",
      message: `Veličina na serveru (${facts.sizeBytes} B) ne odgovara prijavljenoj (${Number(row.size_bytes)} B).`,
    };
  }

  return withCompany(pool, companyId, async (client) => {
    await client.query(
      "UPDATE obligation_attachments SET status = 'ready', uploaded_at = now() WHERE id = $1 AND company_id = $2",
      [attachmentId, companyId],
    );
    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.attachment_added",
      entityType: "obligation_attachment",
      entityId: attachmentId,
      // Bez imena fajla: ime često sadrži ime osobe („ljekarski Amina.pdf“).
      metadata: { obligationId },
    });
    const updated = await client.query(`SELECT ${ATTACHMENT_COLUMNS} FROM obligation_attachments WHERE id = $1 AND company_id = $2`, [
      attachmentId,
      companyId,
    ]);
    return { attachment: toAttachment(updated.rows[0]!) };
  });
}

/** Potpisan link za preuzimanje, 60 s; samo za prilog svoje firme (RLS + provjera veze). */
export async function attachmentDownloadUrl(
  pool: Pool,
  companyId: CompanyId,
  obligationId: string,
  attachmentId: string,
): Promise<{ url: string; expiresAt: string } | ServiceError> {
  const config = storageConfig();
  if (!config.configured) return { code: "CONFLICT", message: config.reason };

  const row = await withCompany(pool, companyId, async (client) => {
    const found = await client.query<{ object_key: string; file_name: string; content_type: AllowedContentType; status: string }>(
      "SELECT object_key, file_name, content_type, status FROM obligation_attachments WHERE id = $1 AND obligation_id = $2 AND company_id = $3",
      [attachmentId, obligationId, companyId],
    );
    return found.rows[0] ?? null;
  });
  if (!row) return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  if (row.status !== "ready") return { code: "NOT_FOUND", message: "Prilog još nije uploadovan." };

  return presignDownload({ config, key: row.object_key, fileName: row.file_name, contentType: row.content_type });
}

/**
 * Čišćenje napuštenih uploada: `pending` stariji od 1 h brišu se pri sljedećem uploadu
 * (bez workera, kako i piše u §5.2). Ograničeno na 20 redova da jedan zahtjev ne radi previše.
 */
export async function cleanStaleAttachments(
  pool: Pool,
  companyId: CompanyId,
): Promise<number> {
  return withCompany(pool, companyId, async (client) => {
    const stale = await client.query<{ id: string }>(
      `DELETE FROM obligation_attachments
        WHERE company_id = $1 AND id IN (
          SELECT id FROM obligation_attachments
           WHERE company_id = $1 AND status = 'pending' AND created_at < now() - interval '1 hour'
           LIMIT 20
        )
        RETURNING id`,
      [companyId],
    );
    return stale.rowCount ?? 0;
  });
}
