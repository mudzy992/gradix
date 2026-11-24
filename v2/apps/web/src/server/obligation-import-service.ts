/**
 * F2 — uvoz obaveza iz Excela/CSV-a (§11).
 *
 * Dvije faze, namjerno:
 *   `preview`  — parsira i provjeri, ništa ne upisuje. Vraća po redu: šta je prepoznato, šta
 *                nedostaje i šta je greška. Korisnik vidi 200 redova prije nego što ih pusti.
 *   `apply`    — upisuje SAMO redove koje je `preview` označio ispravnim, i to ponovo provjerava.
 *
 * Zašto `apply` ne vjeruje pregledu: između pregleda i primjene radnik može biti obrisan ili
 * tip deaktiviran. Uvoz koji „pamti“ odgovor pregleda upisao bi obavezu na nepostojeći entitet.
 *
 * Entitet se u fajlu zadaje ČOVJEKU čitljivo (`Vrsta` + `Entitet`), jer ured pravi tabelu u
 * Excelu, a ne programer. Prepoznavanje je po šifri mašine i po imenu/prezimenu radnika —
 * jedinstvenost u firmi je zagarantovana indeksima (vidi `resolveEntity`).
 */
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { businessDate, safeTimezone } from "@gradix/domain";
import { writeAudit } from "./audit";
import type { Actor } from "./rbac-service";
import {
  MAX_BYTES,
  MAX_ROWS,
  normaliseHeader,
  parseWorkbook,
  toIsoDate,
  toText,
  type ParseError,
  type ParsedSheet,
  type RawRow,
} from "./import-parser";

/** Kolone koje uvoz razumije. Redoslijed nije bitan — zaglavlje se normalizuje. */
const COLUMNS = {
  entityKind: ["vrsta", "vrsta entiteta", "tip entiteta"],
  entity: ["entitet", "radnik", "masina", "ime i prezime", "sifra"],
  type: ["tip obaveze", "tip", "obaveza", "vrsta obaveze"],
  number: ["broj", "broj dokumenta", "broj isprave"],
  issuer: ["izdavalac", "izdao", "ustanova"],
  issuedAt: ["izdato", "datum izdavanja", "datum izdavanja dokumenta"],
  expiresAt: ["istice", "vazi do", "rok", "datum isteka"],
  reviewAt: ["provjera", "datum provjere", "sljedeca provjera"],
  note: ["napomena", "komentar", "opis"],
} as const;

type ColumnKey = keyof typeof COLUMNS;

export type ImportRowError = {
  rowNumber: number;
  field: string;
  message: string;
};

export type ImportRow = {
  rowNumber: number;
  entityKind: "WORKER" | "MACHINE" | "PROJECT";
  entityId: string | null;
  entityLabel: string;
  typeId: string | null;
  typeLabel: string;
  number: string | null;
  issuer: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  reviewAt: string | null;
  note: string | null;
  /** `true` = red se može upisati; `false` = ima grešku i `apply` ga preskače. */
  valid: boolean;
  errors: ImportRowError[];
  /** Postojeća aktivna obaveza istog tipa na istom entitetu — uvoz bi je zamijenio. */
  conflictsWith?: { obligationId: string; expiresAt: string | null };
};

export type ImportPreview = {
  rows: ImportRow[];
  summary: { total: number; valid: number; invalid: number; conflicts: number };
  /** Kolone koje fajl nema, a uvoz ih traži — da korisnik zna zašto je sve crveno. */
  missingColumns: string[];
  today: string;
};

export type ImportFailure = { code: "PARSE_ERROR"; parse: ParseError } | { code: "EMPTY_FILE" };

function mapHeaders(sheet: ParsedSheet): Map<ColumnKey, string> {
  const normalised = new Map<string, string>();
  for (const header of sheet.headers) normalised.set(normaliseHeader(header), header);
  const mapping = new Map<ColumnKey, string>();
  for (const [key, aliases] of Object.entries(COLUMNS) as Array<[ColumnKey, readonly string[]]>) {
    for (const alias of aliases) {
      const found = normalised.get(normaliseHeader(alias));
      if (found) {
        mapping.set(key, found);
        break;
      }
    }
  }
  return mapping;
}

function cell(row: RawRow, header: string | undefined): string | number | Date | null {
  if (!header) return null;
  return row.cells[header] ?? null;
}

/**
 * Mašina i radnik se traže JEDNIM upitom za cijeli fajl, ne po redu: 200 redova po 2 upita je
 * 400 upita za jedan uvoz.
 */
async function loadLookups(
  client: PoolClient,
  companyId: CompanyId,
): Promise<{
  types: Map<string, { id: string; entityKind: string }>;
  workers: Map<string, string>;
  machines: Map<string, string>;
  projects: Map<string, string>;
}> {
  const types = await client.query<{ id: string; code: string; label: string; entity_kind: string }>(
    "SELECT id, code, label, entity_kind FROM obligation_types WHERE company_id = $1 AND is_active",
    [companyId],
  );
  // Tip se prepoznaje po šifri ILI nazivu: ured u tabelu upiše „Ljekarski pregled“, ne `MEDICAL`.
  const typeMap = new Map<string, { id: string; entityKind: string }>();
  for (const row of types.rows) {
    const value = { id: String(row.id), entityKind: String(row.entity_kind) };
    typeMap.set(normaliseHeader(String(row.code)), value);
    typeMap.set(normaliseHeader(String(row.label)), value);
  }

  // Ime i prezime spajaju se u isti ključ; dva radnika istog imena su greška korisnika i
  // rješavaju se unosom broja, ne nagađanjem koji je koji.
  const workers = await client.query<{ id: string; first_name: string; last_name: string }>(
    "SELECT id, first_name, last_name FROM workers WHERE company_id = $1 AND is_active",
    [companyId],
  );
  const workerMap = new Map<string, string>();
  for (const row of workers.rows) {
    workerMap.set(normaliseHeader(`${row.first_name} ${row.last_name}`), String(row.id));
  }

  const machines = await client.query<{ id: string; code: string }>(
    "SELECT id, code FROM machines WHERE company_id = $1 AND is_active",
    [companyId],
  );
  const machineMap = new Map<string, string>();
  for (const row of machines.rows) machineMap.set(normaliseHeader(String(row.code)), String(row.id));

  const projects = await client.query<{ id: string; code: string; name: string }>(
    "SELECT id, code, name FROM projects WHERE company_id = $1 AND status <> 'CANCELLED'",
    [companyId],
  );
  const projectMap = new Map<string, string>();
  for (const row of projects.rows) {
    projectMap.set(normaliseHeader(String(row.code)), String(row.id));
    projectMap.set(normaliseHeader(String(row.name)), String(row.id));
  }

  return { types: typeMap, workers: workerMap, machines: machineMap, projects: projectMap };
}

async function previewRows(
  client: PoolClient,
  companyId: CompanyId,
  sheet: ParsedSheet,
  today: string,
): Promise<{ rows: ImportRow[]; missingColumns: string[] }> {
  const headers = mapHeaders(sheet);
  const lookups = await loadLookups(client, companyId);

  const missingColumns: string[] = [];
  if (!headers.has("entityKind")) missingColumns.push("Vrsta");
  if (!headers.has("entity")) missingColumns.push("Entitet");
  if (!headers.has("type")) missingColumns.push("Tip obaveze");

  const rows: ImportRow[] = [];
  for (const raw of sheet.rows) {
    const errors: ImportRowError[] = [];
    const entityKindRaw = normaliseHeader(String(toText(cell(raw, headers.get("entityKind"))) ?? ""));
    const kind =
      entityKindRaw === "" || entityKindRaw.startsWith("radnik")
        ? "WORKER"
        : entityKindRaw.startsWith("masin") || entityKindRaw.startsWith("vozil")
          ? "MACHINE"
          : entityKindRaw.startsWith("projekt")
            ? "PROJECT"
            : null;
    if (!kind) {
      errors.push({
        rowNumber: raw.rowNumber,
        field: "Vrsta",
        message: `Nepoznata vrsta „${entityKindRaw}“ — očekuje se Radnik, Mašina ili Projekat.`,
      });
    }

    const entityText = String(toText(cell(raw, headers.get("entity"))) ?? "").trim();
    let entityId: string | null = null;
    if (entityText === "") {
      errors.push({ rowNumber: raw.rowNumber, field: "Entitet", message: "Entitet je obavezan." });
    } else if (kind === "WORKER") {
      entityId = lookups.workers.get(normaliseHeader(entityText)) ?? null;
      if (!entityId) {
        errors.push({
          rowNumber: raw.rowNumber,
          field: "Entitet",
          message: `Radnik „${entityText}“ nije pronađen.`,
        });
      }
    } else if (kind === "MACHINE") {
      entityId = lookups.machines.get(normaliseHeader(entityText)) ?? null;
      if (!entityId) {
        errors.push({
          rowNumber: raw.rowNumber,
          field: "Entitet",
          message: `Mašina „${entityText}“ nije pronađena.`,
        });
      }
    } else if (kind === "PROJECT") {
      entityId = lookups.projects.get(normaliseHeader(entityText)) ?? null;
      if (!entityId) {
        errors.push({
          rowNumber: raw.rowNumber,
          field: "Entitet",
          message: `Projekat „${entityText}“ nije pronađen.`,
        });
      }
    }

    const typeText = String(toText(cell(raw, headers.get("type"))) ?? "").trim();
    const typeInfo = typeText === "" ? null : lookups.types.get(normaliseHeader(typeText)) ?? null;
    if (typeText === "") {
      errors.push({ rowNumber: raw.rowNumber, field: "Tip obaveze", message: "Tip je obavezan." });
    } else if (!typeInfo) {
      errors.push({
        rowNumber: raw.rowNumber,
        field: "Tip obaveze",
        message: `Tip „${typeText}“ nije pronađen.`,
      });
    } else if (kind && typeInfo.entityKind !== kind) {
      errors.push({
        rowNumber: raw.rowNumber,
        field: "Tip obaveze",
        message: "Tip se odnosi na drugu vrstu entiteta.",
      });
    }

    const expiresAt = toIsoDate(cell(raw, headers.get("expiresAt")));
    const reviewAt = toIsoDate(cell(raw, headers.get("reviewAt")));
    const issuedAt = toIsoDate(cell(raw, headers.get("issuedAt")));

    // Trajna obaveza bez datuma provjere je stanje koje baza odbija; bolje reći to na pregledu
    // nego pustiti korisnika da primijeni 200 redova i dobije 40 grešaka.
    if (!expiresAt && !reviewAt) {
      errors.push({
        rowNumber: raw.rowNumber,
        field: "Ističe",
        message: "Red mora imati datum isteka ili datum provjere (za trajne obaveze).",
      });
    }
    if (expiresAt && reviewAt && reviewAt < expiresAt) {
      errors.push({
        rowNumber: raw.rowNumber,
        field: "Provjera",
        message: "Datum provjere je prije datuma isteka.",
      });
    }
    if (issuedAt && expiresAt && issuedAt > expiresAt) {
      errors.push({
        rowNumber: raw.rowNumber,
        field: "Izdato",
        message: "Datum izdavanja je poslije datuma isteka.",
      });
    }

    rows.push({
      rowNumber: raw.rowNumber,
      entityKind: kind ?? "WORKER",
      entityId,
      entityLabel: entityText,
      typeId: typeInfo?.id ?? null,
      typeLabel: typeText,
      number: toText(cell(raw, headers.get("number"))),
      issuer: toText(cell(raw, headers.get("issuer"))),
      issuedAt,
      expiresAt,
      reviewAt,
      note: toText(cell(raw, headers.get("note"))),
      valid: errors.length === 0,
      errors,
    });
  }

  // Sukobi sa postojećim obavezama — jedan upit za sve valjane redove.
  const validRows = rows.filter((row) => row.valid && row.entityId && row.typeId);
  if (validRows.length > 0) {
    const existing = await client.query<{
      id: string;
      type_id: string;
      worker_id: string | null;
      machine_id: string | null;
      project_id: string | null;
      expires_at: string | null;
    }>(
      `SELECT id, type_id, worker_id, machine_id, project_id,
              to_char(expires_at, 'YYYY-MM-DD') AS expires_at
         FROM obligations
        WHERE company_id = $1 AND superseded_by IS NULL
          AND type_id = ANY($2)`,
      [companyId, [...new Set(validRows.map((row) => row.typeId!))]],
    );
    const key = (kind: string, entityId: string, typeId: string) => `${kind}:${entityId}:${typeId}`;
    const byKey = new Map<string, { id: string; expiresAt: string | null }>();
    for (const row of existing.rows) {
      const kind = row.worker_id ? "WORKER" : row.machine_id ? "MACHINE" : row.project_id ? "PROJECT" : null;
      const entityId = row.worker_id ?? row.machine_id ?? row.project_id;
      if (!kind || !entityId) continue;
      byKey.set(key(kind, entityId, String(row.type_id)), {
        id: String(row.id),
        expiresAt: row.expires_at,
      });
    }
    for (const row of validRows) {
      const conflict = byKey.get(key(row.entityKind, row.entityId!, row.typeId!));
      if (conflict) row.conflictsWith = { obligationId: conflict.id, expiresAt: conflict.expiresAt };
    }
  }

  // Datum isteka u prošlosti NIJE greška — firma uvozi i stari arhiv. Ali se prijavljuje, jer
  // je najčešći uzrok pogrešno upisana godina.
  void today;
  return { rows, missingColumns };
}

export async function previewImport(
  pool: Pool,
  companyId: CompanyId,
  bytes: Buffer,
  fileName: string,
): Promise<ImportPreview | ImportFailure> {
  if (bytes.byteLength === 0) return { code: "EMPTY_FILE" };
  if (bytes.byteLength > MAX_BYTES) {
    return {
      code: "PARSE_ERROR",
      parse: { code: "FILE_TOO_LARGE", message: `Fajl je veći od ${MAX_BYTES / 1024 / 1024} MB.` },
    };
  }

  const sheet = await parseWorkbook(bytes, fileName);
  if ("code" in sheet) return { code: "PARSE_ERROR", parse: sheet };
  if (sheet.rows.length > MAX_ROWS) {
    return {
      code: "PARSE_ERROR",
      parse: { code: "TOO_MANY_ROWS", message: `Fajl ima više od ${MAX_ROWS} redova.` },
    };
  }

  return withCompany(pool, companyId, async (client) => {
    const today = await companyToday(client, companyId);
    const { rows, missingColumns } = await previewRows(client, companyId, sheet, today);
    return {
      rows,
      summary: {
        total: rows.length,
        valid: rows.filter((row) => row.valid).length,
        invalid: rows.filter((row) => !row.valid).length,
        conflicts: rows.filter((row) => row.conflictsWith).length,
      },
      missingColumns,
      today,
    };
  });
}

export type ImportApplyResult = {
  /** Upisane NOVE obaveze. */
  created: number;
  /** Redovi koji su zamijenili postojeću obavezu (`replaceExisting`). */
  replaced: number;
  skipped: number;
  errors: ImportRowError[];
};

/**
 * Primjena. `replaceExisting` odlučuje šta sa redom koji ima postojeću obavezu:
 * `false` (podrazumijevano) — preskače se i prijavljuje; `true` — stara obaveza se označava
 * kao zamijenjena i upisuje se nova verzija.
 *
 * Zašto ne „ažuriraj postojeću“: obnova je nova verzija, a ne prepisivanje (§5). Uvoz koji bi
 * prepisao red izbrisao bi historiju na kojoj se zasniva dokaz da je radnik imao važeći nalaz.
 */
export async function applyImport(
  pool: Pool,
  companyId: CompanyId,
  bytes: Buffer,
  fileName: string,
  options: { replaceExisting: boolean; responsibleUserId?: string | null },
  actor: Actor,
): Promise<ImportApplyResult | ImportFailure> {
  const preview = await previewImport(pool, companyId, bytes, fileName);
  if ("code" in preview) return preview;

  return withCompany(pool, companyId, async (client) => {
    const result: ImportApplyResult = { created: 0, replaced: 0, skipped: 0, errors: [] };

    for (const row of preview.rows) {
      if (!row.valid) {
        result.skipped += 1;
        result.errors.push(...row.errors);
        continue;
      }

      try {
        if (row.conflictsWith) {
          if (!options.replaceExisting) {
            result.skipped += 1;
            result.errors.push({
              rowNumber: row.rowNumber,
              field: "Entitet",
              message: "Obaveza tog tipa već postoji — izaberite zamjenu ili preskočite red.",
            });
            continue;
          }
          // Stara obaveza NIJE obrisana: označena je kao zamijenjena, pa ostaje u historiji.
          const newId = `obl_${randomId()}`;
          await client.query(
            `UPDATE obligations SET superseded_by = $3, updated_at = now()
              WHERE company_id = $1 AND id = $2`,
            [companyId, row.conflictsWith.obligationId, newId],
          );
          await insertObligation(client, companyId, newId, row, options.responsibleUserId ?? actor.userId);
          result.replaced += 1;
          continue;
        }

        const id = `obl_${randomId()}`;
        await insertObligation(client, companyId, id, row, options.responsibleUserId ?? actor.userId);
        result.created += 1;
      } catch (error) {
        result.skipped += 1;
        result.errors.push({
          rowNumber: row.rowNumber,
          field: "",
          message: error instanceof Error ? error.message.slice(0, 200) : "Nepoznata greška",
        });
      }
    }

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "obligation.imported",
      entityType: "obligation_batch",
      entityId: `import_${randomId()}`,
      metadata: {
        fileName,
        created: result.created,
        replaced: result.replaced,
        skipped: result.skipped,
      },
    });

    return result;
  });
}

async function insertObligation(
  client: PoolClient,
  companyId: CompanyId,
  id: string,
  row: ImportRow,
  responsibleUserId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO obligations
       (id, company_id, type_id, worker_id, machine_id, project_id,
        number, issuer, issued_at, expires_at, review_at, note, responsible_user_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      companyId,
      row.typeId,
      row.entityKind === "WORKER" ? row.entityId : null,
      row.entityKind === "MACHINE" ? row.entityId : null,
      row.entityKind === "PROJECT" ? row.entityId : null,
      row.number,
      row.issuer,
      row.issuedAt,
      row.expiresAt,
      row.reviewAt,
      row.note,
      responsibleUserId,
      id,
    ],
  );
}

async function companyToday(client: PoolClient, companyId: CompanyId): Promise<string> {
  const result = await client.query<{ timezone: string | null }>(
    "SELECT timezone FROM companies WHERE id = $1",
    [companyId],
  );
  return businessDate(new Date(), safeTimezone(result.rows[0]?.timezone));
}

function randomId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}
