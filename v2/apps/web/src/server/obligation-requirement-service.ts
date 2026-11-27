/**
 * F2 — pravila „svaki radnik mora imati ljekarski“ i lista onoga što NEDOSTAJE.
 *
 * Pravilo je podatak (`obligation_requirements`), a ne kod: firma može tražiti ljekarski za
 * sve, a „rad na visini“ samo za angažovane radnike. `missing` se računa iz pravila i
 * postojećih obaveza — nikad se ne upisuje (§1.1 tačka 2), pa ne može ostati zastario.
 *
 * Odluka „šta nedostaje“ je u `@gradix/domain` (`missingObligationsForSubject`), a ovdje su
 * upiti: jedan za pravila, jedan za entitete, jedan za postojeće obaveze — bez N+1.
 */
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import {
  groupMissingByType,
  missingObligationsForSubject,
  type ExistingObligation,
  type MissingObligation,
  type ObligationRequirement,
  type RequirementEntityKind,
  type RequirementScope,
  type RequirementSubject,
} from "@gradix/domain";
import { writeAudit } from "./audit";
import type { Actor } from "./rbac-service";
import { obligationScope, obligationTargetAllowed, type ObligationActor, type ObligationViewer } from "./obligation-scope";

export type RequirementRow = ObligationRequirement & {
  typeLabel: string;
  typeCode: string;
  /** Koliko entiteta trenutno nema tu obavezu — za prikaz u listi pravila. */
  missingCount?: number;
};

const REQUIREMENTS_SELECT = `
  SELECT r.id, r.entity_kind, r.type_id, r.applies_scope, r.applies_value,
         r.is_required, r.is_active, t.label AS type_label, t.code AS type_code
    FROM obligation_requirements r
    JOIN obligation_types t ON t.company_id = r.company_id AND t.id = r.type_id
   WHERE r.company_id = $1
`;

function toRequirement(row: Record<string, unknown>): RequirementRow {
  return {
    id: String(row.id),
    entityKind: String(row.entity_kind) as RequirementEntityKind,
    typeId: String(row.type_id),
    appliesScope: String(row.applies_scope) as RequirementScope,
    appliesValue: (row.applies_value as string | null) ?? null,
    isRequired: Boolean(row.is_required),
    isActive: Boolean(row.is_active),
    typeLabel: String(row.type_label),
    typeCode: String(row.type_code),
  };
}

export async function listRequirements(
  pool: Pool,
  companyId: CompanyId,
  filter: { entityKind?: string; includeInactive?: boolean } = {},
): Promise<RequirementRow[]> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query(
      `${REQUIREMENTS_SELECT}
         AND ($2::text IS NULL OR r.entity_kind = $2)
         AND ($3::boolean OR r.is_active)
        ORDER BY r.entity_kind, t.sort_order, t.label`,
      [companyId, filter.entityKind ?? null, filter.includeInactive === true],
    );
    return result.rows.map(toRequirement);
  });
}

export type RequirementInput = {
  entityKind: RequirementEntityKind;
  typeId: string;
  appliesScope: RequirementScope;
  appliesValue?: string | null;
  isRequired?: boolean;
  isActive?: boolean;
};

/**
 * Provjera prije upisa. Baza ima ista pravila, ali poruka iz servisa kaže ŠTA je pogrešno —
 * `violates check constraint` korisniku ne znači ništa.
 */
function validateRequirement(input: RequirementInput): string | null {
  if (input.appliesScope === "ALL" && input.appliesValue) {
    return "Opseg „svi“ ne prima vrijednost — za kategoriju ili projekat izaberite odgovarajući opseg.";
  }
  if (input.appliesScope !== "ALL" && !input.appliesValue) {
    return "Za ovaj opseg je potrebno izabrati na šta se pravilo odnosi.";
  }
  return null;
}

export type RequirementMutationResult =
  | { ok: true; requirement: RequirementRow }
  | { ok: false; status: number; code: string; message: string };

export async function createRequirement(
  pool: Pool,
  companyId: CompanyId,
  input: RequirementInput,
  actor: ObligationActor,
): Promise<RequirementMutationResult> {
  if (actor.scope !== "COMPANY") return { ok: false, status: 403, code: "FORBIDDEN", message: "Pravila firme zahtijevaju opseg firme." };
  const invalid = validateRequirement(input);
  if (invalid) return { ok: false, status: 400, code: "INVALID_REQUIREMENT", message: invalid };

  return withCompany(pool, companyId, async (client) => {
    // Tip mora biti istog roda kao pravilo: pravilo „ljekarski za mašine“ ne bi nikad našlo
    // obavezu, pa bi tiho stajalo u bazi i zbunjivalo.
    const type = await client.query<{ entity_kind: string }>(
      "SELECT entity_kind FROM obligation_types WHERE company_id = $1 AND id = $2",
      [companyId, input.typeId],
    );
    if (type.rowCount === 0) {
      return { ok: false as const, status: 404, code: "TYPE_NOT_FOUND", message: "Tip obaveze ne postoji." };
    }
    if (type.rows[0]!.entity_kind !== input.entityKind) {
      return {
        ok: false as const,
        status: 400,
        code: "ENTITY_KIND_MISMATCH",
        message: "Tip obaveze se odnosi na drugu vrstu entiteta.",
      };
    }

    const id = `obr_${randomId()}`;
    try {
      await client.query(
        `INSERT INTO obligation_requirements
           (id, company_id, entity_kind, type_id, applies_scope, applies_value, is_required, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          companyId,
          input.entityKind,
          input.typeId,
          input.appliesScope,
          input.appliesValue ?? null,
          input.isRequired ?? true,
          input.isActive ?? true,
          actor.userId,
        ],
      );
    } catch (error) {
      // `ON CONFLICT` ne pomaže: dva identična pravila su greška korisnika, ne stanje koje
      // treba tiho progutati — inače misli da je sačuvao izmjenu koje nema.
      if (isUniqueViolation(error)) {
        return {
          ok: false as const,
          status: 409,
          code: "REQUIREMENT_EXISTS",
          message: "Isto pravilo već postoji.",
        };
      }
      throw error;
    }

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation_requirement.created",
      entityType: "obligation_requirement",
      entityId: id,
      // Sadržaj pravila ide u audit: bez toga se ne zna šta je bilo obavezno u martu.
      metadata: { typeId: input.typeId, scope: input.appliesScope, value: input.appliesValue ?? null },
    });

    const created = await client.query(`${REQUIREMENTS_SELECT} AND r.id = $2`, [companyId, id]);
    return { ok: true as const, requirement: toRequirement(created.rows[0]!) };
  });
}

export async function updateRequirement(
  pool: Pool,
  companyId: CompanyId,
  id: string,
  patch: Partial<RequirementInput>,
  actor: ObligationActor,
): Promise<RequirementMutationResult> {
  if (actor.scope !== "COMPANY") return { ok: false, status: 403, code: "FORBIDDEN", message: "Pravila firme zahtijevaju opseg firme." };
  return withCompany(pool, companyId, async (client) => {
    const current = await client.query(`${REQUIREMENTS_SELECT} AND r.id = $2`, [companyId, id]);
    if (current.rowCount === 0) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Pravilo ne postoji." };
    }
    const existing = toRequirement(current.rows[0]!);
    const merged: RequirementInput = {
      entityKind: patch.entityKind ?? existing.entityKind,
      typeId: patch.typeId ?? existing.typeId,
      appliesScope: patch.appliesScope ?? existing.appliesScope,
      appliesValue: patch.appliesValue !== undefined ? patch.appliesValue : existing.appliesValue,
      isRequired: patch.isRequired ?? existing.isRequired,
      isActive: patch.isActive ?? existing.isActive,
    };
    const invalid = validateRequirement(merged);
    if (invalid) return { ok: false, status: 400, code: "INVALID_REQUIREMENT", message: invalid };

    await client.query(
      `UPDATE obligation_requirements
          SET entity_kind = $3, type_id = $4, applies_scope = $5, applies_value = $6,
              is_required = $7, is_active = $8, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [companyId, id, merged.entityKind, merged.typeId, merged.appliesScope,
        merged.appliesValue ?? null, merged.isRequired, merged.isActive],
    );

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation_requirement.updated",
      entityType: "obligation_requirement",
      entityId: id,
      metadata: { isActive: merged.isActive, isRequired: merged.isRequired },
    });

    const updated = await client.query(`${REQUIREMENTS_SELECT} AND r.id = $2`, [companyId, id]);
    return { ok: true as const, requirement: toRequirement(updated.rows[0]!) };
  });
}

/**
 * Brisanje se dopušta samo za pravilo koje nikad nije ništa značilo: pogrešno uneseno.
 * Inače se pravilo DEAKTIVIRA — brisanje bi iz historije uklonilo zašto je neko tražio
 * dokument, a audit bi pokazivao na red koji ne postoji.
 */
export async function deleteRequirement(
  pool: Pool,
  companyId: CompanyId,
  id: string,
  actor: ObligationActor,
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  if (actor.scope !== "COMPANY") return { ok: false, status: 403, code: "FORBIDDEN", message: "Pravila firme zahtijevaju opseg firme." };
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query(
      "DELETE FROM obligation_requirements WHERE company_id = $1 AND id = $2",
      [companyId, id],
    );
    if (result.rowCount === 0) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Pravilo ne postoji." };
    }
    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation_requirement.deleted",
      entityType: "obligation_requirement",
      entityId: id,
    });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------------------
// „Nedostaje“
// ---------------------------------------------------------------------------

export type MissingListOptions = {
  entityKind?: RequirementEntityKind;
  typeId?: string;
  /** Ograniči na jedan entitet (detalj radnika/mašine). */
  entityId?: string;
  /** Samo entiteti vezani na taj projekat. */
  projectId?: string;
};

export type MissingItem = MissingObligation & {
  typeLabel: string;
  typeCode: string;
  entityName: string;
  entityCode: string | null;
  requiresAttachment: boolean;
};

export type MissingPage = {
  items: MissingItem[];
  groups: ReturnType<typeof groupMissingByType>;
  counts: { total: number; workers: number; machines: number; projects: number };
  today: string;
};

/**
 * Učitava entitete, pravila i postojeće obaveze, pa pušta domensku funkciju da odluči.
 *
 * Entiteti se čitaju sa`is_active`: deaktiviran radnik ili mašina ne ulazi u listu. Radnik bez
 * korisničkog naloga ulazi — spisak nedostataka je stvar ureda, ne prijave.
 */
async function loadMissing(
  client: PoolClient,
  companyId: CompanyId,
  today: string,
  options: MissingListOptions,
  actor: ObligationViewer,
): Promise<MissingItem[]> {
  const requirements = await client.query(`${REQUIREMENTS_SELECT} AND r.is_active`, [companyId]);
  const rules = requirements.rows.map(toRequirement);
  if (rules.length === 0) return [];

  const types = await client.query<{
    id: string;
    label: string;
    code: string;
    requires_attachment: boolean;
  }>(
    "SELECT id, label, code, requires_attachment FROM obligation_types WHERE company_id = $1",
    [companyId],
  );
  const typeInfo = new Map(types.rows.map((row) => [String(row.id), row]));

  const subjects: Array<RequirementSubject & { name: string; code: string | null }> = [];
  const kinds = options.entityKind ? [options.entityKind] : ["WORKER", "MACHINE", "PROJECT"] as RequirementEntityKind[];

  if (kinds.includes("WORKER")) {
    /*
     * Radnik ulazi sa svojom vrstom angažmana i (ako postoji) projektom na koji je dodijeljen.
     * Projekt ide kroz `LATERAL ... LIMIT 1`: radnik može biti na više projekata, ali pravilo
     * `PROJECT` traži „je li na TOM projektu“ — za listu je dovoljna trenutna dodjela.
     */
    const workers = await client.query<{
      id: string;
      first_name: string;
      last_name: string;
      engagement_kind: string | null;
      category_id: string | null;
      project_id: string | null;
    }>(
      `SELECT w.id, w.first_name, w.last_name, w.engagement::text AS engagement_kind, NULL::text AS category_id,
              (SELECT pa.project_id FROM project_assignments pa
                WHERE pa.company_id = w.company_id AND pa.worker_id = w.id
                  -- Dodjela je aktivna dok nije ponistena i dok joj nije prosao to_date.
                  AND pa.voided_at IS NULL
                  AND pa.from_date <= $2::date AND (pa.to_date IS NULL OR pa.to_date >= $2::date)
                  AND ($3::text[] IS NULL OR pa.project_id=ANY($3::text[])) AND ($4::text IS NULL OR pa.project_id=$4)
                ORDER BY pa.from_date DESC LIMIT 1) AS project_id
         FROM workers w
        WHERE w.company_id = $1 AND w.is_active`,
      [companyId, today, actor.scope === "PROJECTS" ? actor.projectIds ?? [] : null, options.projectId ?? null],
    );
    for (const row of workers.rows) {
      subjects.push({
        id: String(row.id),
        kind: "WORKER",
        isActive: true,
        engagementKind: row.engagement_kind,
        projectId: row.project_id,
        name: `${row.first_name} ${row.last_name}`,
        code: null,
      });
    }
  }

  if (kinds.includes("MACHINE")) {
    const machines = await client.query<{
      id: string;
      code: string;
      name: string;
      category_id: string | null;
      project_id: string | null;
    }>(
      `SELECT m.id, m.code, m.name, m.category_id,
              (SELECT pa.project_id FROM project_assignments pa
                WHERE pa.company_id = m.company_id AND pa.machine_id = m.id
                  AND pa.voided_at IS NULL
                  AND pa.from_date <= $2::date AND (pa.to_date IS NULL OR pa.to_date >= $2::date)
                  AND ($3::text[] IS NULL OR pa.project_id=ANY($3::text[])) AND ($4::text IS NULL OR pa.project_id=$4)
                ORDER BY pa.from_date DESC LIMIT 1) AS project_id
         FROM machines m
        WHERE m.company_id = $1 AND m.is_active`,
      [companyId, today, actor.scope === "PROJECTS" ? actor.projectIds ?? [] : null, options.projectId ?? null],
    );
    for (const row of machines.rows) {
      subjects.push({
        id: String(row.id),
        kind: "MACHINE",
        isActive: true,
        categoryId: row.category_id,
        projectId: row.project_id,
        name: String(row.name),
        code: String(row.code),
      });
    }
  }

  if (kinds.includes("PROJECT")) {
    const projects = await client.query<{ id: string; code: string; name: string; status: string }>(
      // Zatvoreni (otkazani) projekti ne traže dokumente: nema radova, nema ni obaveze.
      // Završen projekat OSTAJE — arhiva dokumentacije je razlog da sistem postoji.
      "SELECT id, code, name, status FROM projects WHERE company_id = $1 AND status <> 'CANCELLED'",
      [companyId],
    );
    for (const row of projects.rows) {
      subjects.push({
        id: String(row.id),
        kind: "PROJECT",
        isActive: true,
        projectId: String(row.id),
        name: String(row.name),
        code: String(row.code),
      });
    }
  }

  // Do not return or calculate missing counts for subjects outside the session scope.
  if (actor.scope !== "COMPANY") {
    for (let i = subjects.length - 1; i >= 0; i--) {
      const subject = subjects[i]!;
      const target = subject.kind === "WORKER" ? {workerId:subject.id} : subject.kind === "MACHINE" ? {machineId:subject.id} : {projectId:subject.id};
      if (!await obligationTargetAllowed(client, companyId, actor, target)) subjects.splice(i, 1);
    }
  }
  if (subjects.length === 0) return [];

  // Postojeće obaveze za SVE entitete jednim upitom — bez ovoga bi lista od 80 radnika
  // napravila 80 upita.
  const existingParams: unknown[] = [companyId];
  const existingScope = obligationScope(actor, existingParams, "o");
  const existing = await client.query<{
    type_id: string;
    worker_id: string | null;
    machine_id: string | null;
    project_id: string | null;
    expires_at: string | null;
    superseded_by: string | null;
  }>(
    `SELECT type_id, worker_id, machine_id, project_id,
            to_char(expires_at, 'YYYY-MM-DD') AS expires_at, superseded_by
       FROM obligations o
      WHERE company_id = $1 AND ${existingScope}`,
    existingParams,
  );
  const bySubject = new Map<string, ExistingObligation[]>();
  for (const row of existing.rows) {
    const key = row.worker_id
      ? `WORKER:${row.worker_id}`
      : row.machine_id
        ? `MACHINE:${row.machine_id}`
        : row.project_id
          ? `PROJECT:${row.project_id}`
          : null;
    if (!key) continue;
    const list = bySubject.get(key) ?? [];
    list.push({
      typeId: String(row.type_id),
      expiresAt: row.expires_at,
      superseded: row.superseded_by !== null,
    });
    bySubject.set(key, list);
  }

  const items: MissingItem[] = [];
  for (const subject of subjects) {
    if (options.entityId && subject.id !== options.entityId) continue;
    if (options.projectId && subject.projectId !== options.projectId) continue;

    const missing = missingObligationsForSubject({
      subject,
      requirements: rules,
      existing: bySubject.get(`${subject.kind}:${subject.id}`) ?? [],
    });

    for (const item of missing) {
      if (options.typeId && item.typeId !== options.typeId) continue;
      const info = typeInfo.get(item.typeId);
      items.push({
        ...item,
        typeLabel: String(info?.label ?? item.typeId),
        typeCode: String(info?.code ?? ""),
        entityName: subject.name,
        entityCode: subject.code,
        requiresAttachment: Boolean(info?.requires_attachment),
      });
    }
  }

  items.sort(
    (a, b) =>
      a.typeLabel.localeCompare(b.typeLabel) || a.entityName.localeCompare(b.entityName),
  );
  return items;
}

export async function listMissing(
  pool: Pool,
  companyId: CompanyId,
  options: MissingListOptions,
  actor: ObligationViewer,
): Promise<MissingPage> {
  return withCompany(pool, companyId, async (client) => {
    const today = await companyDate(client, companyId);
    const items = await loadMissing(client, companyId, today, options, actor);
    const counts = {
      total: items.length,
      workers: items.filter((item) => item.entityKind === "WORKER").length,
      machines: items.filter((item) => item.entityKind === "MACHINE").length,
      projects: items.filter((item) => item.entityKind === "PROJECT").length,
    };
    return { items, groups: groupMissingByType(items), counts, today };
  });
}

/** Poslovni datum firme — isti izvor kao u ostalim servisima. */
async function companyDate(client: PoolClient, companyId: CompanyId): Promise<string> {
  const result = await client.query<{ timezone: string | null }>(
    "SELECT timezone FROM companies WHERE id = $1",
    [companyId],
  );
  const { businessDate, safeTimezone } = await import("@gradix/domain");
  return businessDate(new Date(), safeTimezone(result.rows[0]?.timezone));
}

// ---------------------------------------------------------------------------
// „Kreiraj sve nedostajuće“
// ---------------------------------------------------------------------------

export type CreateMissingResult = {
  created: number;
  /** Entiteti na koje nije bilo moguće upisati (npr. nema dozvole za tip). */
  skipped: Array<{ entityKind: string; entityId: string; typeId: string; reason: string }>;
  /** Id-jevi novih obaveza — ekran ih odmah prikaže bez ponovnog učitavanja. */
  ids: string[];
};

/**
 * Upisuje obaveze za sve nedostatke odjednom.
 *
 * Zašto je ovo jedna transakcija: „kreiraj sve“ koje stane na pola ostavlja korisnika u stanju
 * u kojem ne zna šta je prošlo. Ako ijedan upis padne, ne upisuje se ništa i poruka kaže zašto.
 *
 * Nove obaveze NEMAJU rok (`expires_at NULL`) — zato im je `review_at` obavezan. To je namjerno:
 * „nedostaje“ se rješava time što se unese broj i datum, a ne time što se izmisli rok. Red bez
 * roka i sa datumom provjere je pošten zapis „ovo još nemamo, provjeri do tada“.
 * Prelazak u `pending_review` je posao unosa dokumenta, ne ove akcije.
 */
export async function createMissingObligations(
  pool: Pool,
  companyId: CompanyId,
  options: MissingListOptions & { reviewAt: string; responsibleUserId?: string | null },
  actor: ObligationActor,
): Promise<CreateMissingResult> {
  return withCompany(pool, companyId, async (client) => {
    const today = await companyDate(client, companyId);
    const items = await loadMissing(client, companyId, today, options, actor);
    const result: CreateMissingResult = { created: 0, skipped: [], ids: [] };

    for (const item of items) {
      const id = `obl_${randomId()}`;
      try {
        await client.query(
          `INSERT INTO obligations
             (id, company_id, type_id, worker_id, machine_id, project_id,
              expires_at, review_at, responsible_user_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)`,
          [
            id,
            companyId,
            item.typeId,
            item.entityKind === "WORKER" ? item.entityId : null,
            item.entityKind === "MACHINE" ? item.entityId : null,
            item.entityKind === "PROJECT" ? item.entityId : null,
            options.reviewAt,
            options.responsibleUserId ?? actor.userId,
            actor.userId,
          ],
        );
        result.ids.push(id);
        result.created += 1;
      } catch (error) {
        // Jedan neuspjeh ne smije sakriti ostale, ali se ne smije ni progutati: razlog ide u
        // odgovor da korisnik zna koji entitet treba ručno.
        result.skipped.push({
          entityKind: item.entityKind,
          entityId: item.entityId,
          typeId: item.typeId,
          reason: error instanceof Error ? error.message.slice(0, 200) : "Nepoznata greška",
        });
      }
    }

    // Grupna radnja nema jedan red: `entityId` je prazna oznaka serije, a brojevi su u metadata.
    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.missing_created",
      entityType: "obligation_batch",
      entityId: `batch_${randomId()}`,
      metadata: { created: result.created, skipped: result.skipped.length, reviewAt: options.reviewAt },
    });

    return result;
  });
}

// ---------------------------------------------------------------------------
// Grupna obnova (§22)
// ---------------------------------------------------------------------------

export type BulkRenewInput = {
  /** Obaveze koje se obnavljaju. Prazan niz je greška — „obnovi sve“ mora imati izbor. */
  obligationIds: readonly string[];
  /** Novi rok; `null` znači trajna obaveza (tada je `reviewAt` obavezan). */
  expiresAt: string | null;
  reviewAt?: string | null;
  issuedAt?: string | null;
  number?: string | null;
  issuer?: string | null;
  note?: string | null;
};

export type BulkRenewResult = {
  renewed: number;
  /** Po obavezi: zašto nije obnovljena (npr. nije nađena ili je već obnovljena). */
  failed: Array<{ obligationId: string; reason: string }>;
};

/**
 * Obnova N obaveza jednim datumom — tipičan slučaj je „svih 12 radnika na projektu obnovilo
 * ljekarski istog dana“.
 *
 * Zašto poziva `renewObligation` a ne piše svoj INSERT: obnova mora ići kroz verzionisanje
 * (`obligation_versions` + trigger). Drugi put bi značio dva pravila za istu stvar, a historija
 * bi ostala bez unosa.
 */
export async function bulkRenewObligations(
  pool: Pool,
  companyId: CompanyId,
  input: BulkRenewInput,
  actor: Actor,
  renewOne: (
    id: string,
  ) => Promise<{ ok: true; id: string } | { ok: false; reason: string }>,
): Promise<BulkRenewResult> {
  const result: BulkRenewResult = { renewed: 0, failed: [] };
  const unique = [...new Set(input.obligationIds)];
  if (unique.length === 0) {
    return { renewed: 0, failed: [{ obligationId: "", reason: "Nije izabrana nijedna obaveza." }] };
  }

  for (const id of unique) {
    const outcome = await renewOne(id);
    if (outcome.ok) result.renewed += 1;
    else result.failed.push({ obligationId: id, reason: outcome.reason });
  }

  await withCompany(pool, companyId, async (client) => {
    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.bulk_renewed",
      entityType: "obligation_batch",
      entityId: `batch_${randomId()}`,
      metadata: {
        requested: unique.length,
        renewed: result.renewed,
        failed: result.failed.length,
        expiresAt: input.expiresAt,
      },
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Pomoćno
// ---------------------------------------------------------------------------

/**
 * Servis vraća svoje interne kodove (`TYPE_NOT_FOUND`, …), a API katalog je ZATVOREN
 * (`ERROR_CODES`). Prijevod je ovdje, na jednom mjestu: bez njega bi svaka ruta morala znati
 * mapiranje, pa bi se kodovi razišli.
 */
export function requirementErrorCode(
  code: string,
): "VALIDATION_FAILED" | "NOT_FOUND" | "FORBIDDEN" | "OBLIGATION_REQUIREMENT_EXISTS" {
  switch (code) {
    case "FORBIDDEN": return "FORBIDDEN";
    case "NOT_FOUND":
    case "TYPE_NOT_FOUND":
      return "NOT_FOUND";
    case "REQUIREMENT_EXISTS":
      return "OBLIGATION_REQUIREMENT_EXISTS";
    default:
      return "VALIDATION_FAILED";
  }
}

/** Kratak, ali koliziono siguran id. Isti obrazac kao ostali `TEXT` id-jevi u šemi. */
function randomId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
