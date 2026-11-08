/**
 * Uvoz iz Excela: pregled (bez upisa) i potvrda (jedna transakcija).
 *
 * Pravila iz `docs/PLAN-R2.md` §2, i zašto su takva:
 *  - **Mašine se prepoznaju po inventarskoj oznaci.** Postoji → preskoči i prijavi; ažuriranje je
 *    izričit izbor po redu. Nijedan red se ne prepisuje tiho.
 *  - **Radnici se ne spajaju automatski.** Nema sigurnog ključa (ime nije jedinstveno, telefon se
 *    dijeli), pa se mogući duplikat prijavljuje i korisnik odlučuje po redu.
 *  - **Nepoznata kategorija se ne stvara tiho.** Red ide u greške; kategorija se dodaje svjesno
 *    (iz pregleda ili u Postavkama).
 *  - **Pregled ne piše ništa**, a potvrda je „sve ili ništa“ — djelimično uvezen fajl je gori od
 *    neuspjelog uvoza, jer se ne zna šta je unutra.
 */
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { writeAudit } from "./audit";
import { isServiceError } from "./equipment-service";
import type { ServiceError } from "./equipment-service";
import type { Actor } from "./rbac-service";
import { toIsoDate, toNumber, toText, normaliseHeader, type ParsedSheet } from "./import-parser";

export type ImportKind = "workers" | "equipment";

export type FieldSpec = {
  key: string;
  label: string;
  required: boolean;
  /** Nazivi zaglavlja koja automatski mapiraju ovo polje (normalizovani). */
  aliases: string[];
  hint?: string;
};

export const WORKER_FIELDS: FieldSpec[] = [
  { key: "firstName", label: "Ime", required: true, aliases: ["ime", "first name", "name"] },
  { key: "lastName", label: "Prezime", required: true, aliases: ["prezime", "last name", "surname"] },
  { key: "phone", label: "Telefon", required: false, aliases: ["telefon", "mobitel", "phone", "mobile", "tel"] },
  { key: "email", label: "Email", required: false, aliases: ["email", "e mail", "mail"] },
  { key: "jobTitle", label: "Zanimanje", required: false, aliases: ["zanimanje", "radno mjesto", "pozicija", "job title"] },
  { key: "engagement", label: "Angažman", required: false, aliases: ["angazman", "vrsta angazmana", "ugovor", "engagement"], hint: "STALNO / ODREĐENO / SEZONSKI / UGOVOR" },
  { key: "hiredAt", label: "Datum početka", required: true, aliases: ["datum pocetka", "pocetak rada", "zaposlen", "hired"] },
  { key: "endedAt", label: "Datum prestanka", required: false, aliases: ["datum prestanka", "kraj rada", "odjava"] },
  { key: "team", label: "Ekipa", required: false, aliases: ["ekipa", "grupa", "tim", "team"] },
  { key: "supervisor", label: "Nadređeni", required: false, aliases: ["nadredjeni", "sef", "rukovodilac", "supervisor"] },
];

export const EQUIPMENT_FIELDS: FieldSpec[] = [
  { key: "code", label: "Inventarska oznaka", required: true, aliases: ["sifra", "oznaka", "inventarski broj", "code", "reg"] },
  { key: "name", label: "Naziv", required: true, aliases: ["naziv", "opis", "name"] },
  { key: "category", label: "Kategorija", required: true, aliases: ["kategorija", "vrsta", "tip", "category"], hint: "npr. Bager, Kamion, Valjak" },
  { key: "make", label: "Marka", required: false, aliases: ["marka", "proizvodjac", "make", "brand"] },
  { key: "model", label: "Model", required: false, aliases: ["model"] },
  { key: "serialNo", label: "Serijski broj", required: false, aliases: ["serijski broj", "ser br", "serial"] },
  { key: "plate", label: "Registarska oznaka", required: false, aliases: ["registracija", "tablice", "registarska oznaka", "plate"] },
  { key: "year", label: "Godina", required: false, aliases: ["godina", "godiste", "year"] },
  { key: "ownership", label: "Vlasništvo", required: false, aliases: ["vlasnistvo", "vlasništvo", "ownership"], hint: "svoje / najam" },
  { key: "meterValue", label: "Stanje brojila", required: false, aliases: ["brojilo", "sati", "kilometri", "km", "stanje", "sat"] },
];

export function fieldsFor(kind: ImportKind): FieldSpec[] {
  return kind === "workers" ? WORKER_FIELDS : EQUIPMENT_FIELDS;
}

/** Predlaže mapiranje kolona po zaglavlju; korisnik ga poslije mijenja. */
export function suggestMapping(kind: ImportKind, headers: string[]): Record<string, string | null> {
  const fields = fieldsFor(kind);
  const normalised = headers.map((header) => ({ header, key: normaliseHeader(header) }));
  const used = new Set<string>();
  const mapping: Record<string, string | null> = {};

  for (const field of fields) {
    const found = normalised.find(
      (candidate) =>
        !used.has(candidate.header) &&
        (candidate.key === normaliseHeader(field.label) || field.aliases.includes(candidate.key)),
    );
    if (found) {
      mapping[field.key] = found.header;
      used.add(found.header);
    } else {
      mapping[field.key] = null;
    }
  }
  return mapping;
}

export type RowOutcome = "import" | "skip" | "error" | "duplicate";

export type PreviewRow = {
  rowNumber: number;
  outcome: RowOutcome;
  /** Zašto je red preskočen ili odbijen — poruka koju korisnik razumije. */
  reason?: string;
  /** Prikaz ključnih vrijednosti u pregledu (ne cijeli red). */
  summary: string;
  /** Samo kad `outcome === "duplicate"`: može se uvesti kao novi. */
  values?: Record<string, string | number | null>;
};

export type PreviewResult = {
  kind: ImportKind;
  mapping: Record<string, string | null>;
  ignoredSheets: number;
  sheetName: string;
  rows: PreviewRow[];
  counts: { import: number; skip: number; error: number; duplicate: number };
  /** Razlozi zbog kojih uvoz NE MOŽE da krene (nemapirano obavezno polje). */
  blockers: string[];
  /** Ono što ne blokira, ali korisnik mora vidjeti prije potvrde (neuvežene kolone). */
  notices: string[];
};

export type ImportError =
  | ServiceError
  | { code: "VALIDATION_FAILED"; message: string };

/* ------------------------------------------------------------------ pregled */

const ENGAGEMENT_MAP: Record<string, string> = {
  stalno: "PERMANENT",
  "stalni radni odnos": "PERMANENT",
  permanent: "PERMANENT",
  neodredjeno: "PERMANENT",
  "na neodredjeno": "PERMANENT",
  odredjeno: "FIXED_TERM",
  "na odredjeno": "FIXED_TERM",
  "fixed term": "FIXED_TERM",
  sezonski: "SEASONAL",
  seasonal: "SEASONAL",
  ugovor: "CONTRACT",
  "ugovor o djelu": "CONTRACT",
  contract: "CONTRACT",
};

export function parseEngagement(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = normaliseHeader(value);
  return ENGAGEMENT_MAP[key] ?? null;
}

export function parseOwnership(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = normaliseHeader(value);
  if (["svoje", "vlastito", "own", "vlasnistvo"].includes(key)) return "OWN";
  if (["najam", "rent", "iznajmljeno", "rented"].includes(key)) return "RENT";
  return null;
}

/** Telefon se poredi po ciframa: `+387 61 123-456` i `061/123-456` su isti čovjek. */
export function phoneKey(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return null;
  // Bez pozivnog broja države, da „+387 61…“ i „061…“ budu isto.
  return digits.slice(-9);
}

function normaliseName(value: string): string {
  return normaliseHeader(value).replace(/\s+/g, " ");
}

export function equipmentCode(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase().replace(/\s+/g, "-");
  return /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code) ? code : null;
}

export async function previewImport(
  pool: Pool,
  companyId: CompanyId,
  kind: ImportKind,
  sheet: ParsedSheet,
  mapping: Record<string, string | null>,
): Promise<PreviewResult | ImportError> {
  const fields = fieldsFor(kind);
  const blockers: string[] = [];

  for (const field of fields) {
    if (field.required && !mapping[field.key]) blockers.push(`Polje „${field.label}“ nije mapirano.`);
  }

  // Neuvežene kolone ne blokiraju uvoz — ali se prijavljuju, jer korisnik mora znati šta od
  // njegovog fajla nije ušlo. Lični podaci su tu samo naglašeniji slučaj istog pravila.
  const notices: string[] = [];
  const mappedColumns = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const ignoredColumns = sheet.headers.filter((header) => !mappedColumns.has(header));
  for (const column of ignoredColumns) {
    const normalised = normaliseHeader(column);
    const knownPersonal = ["jmbg", "licna karta", "broj licne", "adresa", "iban", "bankovni racun", "racun"];
    notices.push(
      knownPersonal.some((pattern) => normalised.includes(pattern))
        ? `Kolona „${column}“ nije podržana i nije uvezena: lični podaci se u R2 ne unose.`
        : `Kolona „${column}“ nije mapirana i nije uvezena.`,
    );
  }

  if (blockers.length > 0) {
    return {
      kind,
      mapping,
      ignoredSheets: sheet.ignoredSheets,
      sheetName: sheet.sheetName,
      rows: [],
      counts: { import: 0, skip: 0, error: 0, duplicate: 0 },
      blockers,
      notices,
    };
  }

  return withCompany(pool, companyId, async (client) => {
    const rows =
      kind === "workers"
        ? await previewWorkers(client, sheet, mapping)
        : await previewEquipment(client, sheet, mapping);

    const counts = { import: 0, skip: 0, error: 0, duplicate: 0 };
    for (const row of rows) counts[row.outcome] += 1;

    return {
      kind,
      mapping,
      ignoredSheets: sheet.ignoredSheets,
      sheetName: sheet.sheetName,
      rows,
      counts,
      blockers: [],
      notices,
    };
  });
}

async function previewWorkers(
  client: PoolClient,
  sheet: ParsedSheet,
  mapping: Record<string, string | null>,
): Promise<PreviewRow[]> {
  const existing = await client.query<{ first_name: string; last_name: string; phone: string | null }>(
    "SELECT first_name, last_name, phone FROM workers WHERE is_active",
  );
  const byName = new Map<string, number>();
  const byPhone = new Map<string, number>();
  for (const row of existing.rows) {
    byName.set(normaliseName(`${row.first_name} ${row.last_name}`), 1);
    const phone = phoneKey(row.phone);
    if (phone) byPhone.set(phone, 1);
  }

  // Duplikati unutar istog fajla se takođe prijavljuju — inače bi dvije iste osobe ušle dvaput.
  const seenInFile = new Map<string, number>();

  return sheet.rows.map((row) => {
    const value = (key: string) => toText(row.cells[mapping[key] ?? ""] ?? null);
    const firstName = value("firstName");
    const lastName = value("lastName");
    const summary = `${firstName ?? "?"} ${lastName ?? "?"}`.trim();

    if (!firstName || !lastName) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Ime i prezime su obavezni.", summary };
    }

    const hiredAt = toIsoDate(row.cells[mapping["hiredAt"] ?? ""] ?? null);
    if (!hiredAt) {
      const raw = toText(row.cells[mapping["hiredAt"] ?? ""] ?? null);
      return {
        rowNumber: row.rowNumber,
        outcome: "error",
        reason: `Datum početka nije datum: „${raw ?? "prazno"}“.`,
        summary,
      };
    }

    const endedRaw = mapping["endedAt"] ? row.cells[mapping["endedAt"]] ?? null : null;
    const endedAt = endedRaw === null || endedRaw === "" ? null : toIsoDate(endedRaw);
    if (endedAt && endedAt < hiredAt) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Datum prestanka je prije početka rada.", summary };
    }

    const engagementRaw = value("engagement");
    const engagement = parseEngagement(engagementRaw);
    if (engagementRaw && !engagement) {
      return {
        rowNumber: row.rowNumber,
        outcome: "error",
        reason: `Angažman „${engagementRaw}“ nije prepoznat (STALNO / ODREĐENO / SEZONSKI / UGOVOR).`,
        summary,
      };
    }

    const phone = value("phone");
    const email = value("email");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: `Email „${email}“ nije ispravan.`, summary };
    }

    const nameKey = normaliseName(`${firstName} ${lastName}`);
    const phoneKeyValue = phoneKey(phone);
    const sameName = byName.has(nameKey);
    const samePhone = phoneKeyValue ? byPhone.has(phoneKeyValue) : false;
    const earlierRow = seenInFile.get(nameKey) ?? (phoneKeyValue ? seenInFile.get(`tel:${phoneKeyValue}`) : undefined);

    const values = {
      firstName,
      lastName,
      phone,
      email,
      jobTitle: value("jobTitle"),
      engagement: engagement ?? "PERMANENT",
      hiredAt,
      endedAt,
      team: value("team"),
      supervisor: value("supervisor"),
    };

    if (earlierRow) {
      return {
        rowNumber: row.rowNumber,
        outcome: "error",
        reason: `Isti radnik se pojavljuje i u redu ${earlierRow} — uvezite jedan od ta dva.`,
        summary,
      };
    }
    seenInFile.set(nameKey, row.rowNumber);
    if (phoneKeyValue) seenInFile.set(`tel:${phoneKeyValue}`, row.rowNumber);

    if (sameName || samePhone) {
      return {
        rowNumber: row.rowNumber,
        outcome: "duplicate",
        reason: sameName ? "Isto ime i prezime već postoji u firmi." : "Isti telefon već postoji u firmi.",
        summary,
        values,
      };
    }

    return { rowNumber: row.rowNumber, outcome: "import", summary, values };
  });
}

async function previewEquipment(
  client: PoolClient,
  sheet: ParsedSheet,
  mapping: Record<string, string | null>,
): Promise<PreviewRow[]> {
  const categories = await client.query<{ id: string; code: string; name: string }>(
    "SELECT id, code, name FROM equipment_categories",
  );
  const categoryIndex = new Map<string, { id: string; code: string; name: string }>();
  for (const category of categories.rows) {
    categoryIndex.set(normaliseHeader(category.code), category);
    categoryIndex.set(normaliseHeader(category.name), category);
  }

  const machines = await client.query<{ code: string }>("SELECT code FROM machines");
  const existingCodes = new Set(machines.rows.map((row) => row.code));
  const seenInFile = new Map<string, number>();

  return sheet.rows.map((row) => {
    const value = (key: string) => toText(row.cells[mapping[key] ?? ""] ?? null);
    const rawCode = value("code");
    const code = equipmentCode(rawCode);
    const name = value("name");
    const summary = `${code ?? rawCode ?? "?"} · ${name ?? "?"}`;

    if (!code) {
      return {
        rowNumber: row.rowNumber,
        outcome: "error",
        reason: `Inventarska oznaka „${rawCode ?? "prazno"}“ nije ispravna (2–20 znakova: slova, brojevi, crtica).`,
        summary,
      };
    }
    if (!name) return { rowNumber: row.rowNumber, outcome: "error", reason: "Naziv je obavezan.", summary };

    const categoryText = value("category");
    const category = categoryText ? categoryIndex.get(normaliseHeader(categoryText)) : undefined;
    if (!category) {
      return {
        rowNumber: row.rowNumber,
        outcome: "error",
        reason: `Nepoznata kategorija „${categoryText ?? "prazno"}“. Dodajte je u Postavke → Kategorije mašina ili ispravite kolonu.`,
        summary,
      };
    }

    const year = mapping["year"] ? toNumber(row.cells[mapping["year"]!] ?? null) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1)) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: `Godina „${year}“ nije ispravna.`, summary };
    }

    const meterValue = mapping["meterValue"] ? toNumber(row.cells[mapping["meterValue"]!] ?? null) : null;
    if (mapping["meterValue"] && row.cells[mapping["meterValue"]!] != null && meterValue === null) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Stanje brojila nije broj.", summary };
    }
    if (meterValue !== null && meterValue < 0) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Stanje brojila ne može biti negativno.", summary };
    }

    const ownershipRaw = value("ownership");
    const ownership = parseOwnership(ownershipRaw);
    if (ownershipRaw && !ownership) {
      return {
        rowNumber: row.rowNumber,
        outcome: "error",
        reason: `Vlasništvo „${ownershipRaw}“ nije prepoznato (svoje / najam).`,
        summary,
      };
    }

    const values = {
      code,
      name,
      categoryId: category.id,
      make: value("make"),
      model: value("model"),
      serialNo: value("serialNo"),
      plate: value("plate"),
      year: year === null ? null : Math.trunc(year),
      ownership: ownership ?? "OWN",
      meterValue,
    };

    const earlierRow = seenInFile.get(code);
    if (earlierRow) {
      return {
        rowNumber: row.rowNumber,
        outcome: "error",
        reason: `Oznaka ${code} se pojavljuje i u redu ${earlierRow}.`,
        summary,
      };
    }
    seenInFile.set(code, row.rowNumber);

    if (existingCodes.has(code)) {
      return {
        rowNumber: row.rowNumber,
        outcome: "skip",
        reason: `Oznaka ${code} već postoji — preskočeno (ažuriranje nije izabrano).`,
        summary,
        // Vrijednosti ostaju uz red: bez njih „ažuriraj“ ne bi imao šta da upiše.
        values,
      };
    }

    return { rowNumber: row.rowNumber, outcome: "import", summary, values };
  });
}

/* ------------------------------------------------------------------ potvrda */

export type ApplyDecision = { rowNumber: number; action: "import" | "skip" | "update" };

export type ApplyResult = {
  imported: number;
  skipped: number;
  failed: number;
  updated: number;
  errors: { rowNumber: number; message: string }[];
};

/**
 * Potvrda: jedan red = jedna odluka. `values` se NE primaju iz klijenta — ponovo se parsiraju iz
 * istog fajla, da klijent ne može podmetnuti sadržaj koji pregled nije vidio.
 */
export async function applyImport(
  pool: Pool,
  companyId: CompanyId,
  actor: Actor,
  kind: ImportKind,
  sheet: ParsedSheet,
  mapping: Record<string, string | null>,
  decisions: ApplyDecision[],
  fileName: string,
): Promise<ApplyResult | ImportError> {
  const preview = await previewImport(pool, companyId, kind, sheet, mapping);
  if (isServiceError(preview)) return preview;
  if (preview.blockers.length > 0) {
    return { code: "VALIDATION_FAILED", message: preview.blockers.join(" ") };
  }

  const byRow = new Map(preview.rows.map((row) => [row.rowNumber, row]));
  const chosen = decisions.filter((decision) => decision.action !== "skip");

  for (const decision of chosen) {
    const row = byRow.get(decision.rowNumber);
    if (!row) return { code: "VALIDATION_FAILED", message: `Red ${decision.rowNumber} nije u pregledu.` };
    if (row.outcome === "error") {
      return { code: "VALIDATION_FAILED", message: `Red ${decision.rowNumber} ima grešku: ${row.reason ?? ""}` };
    }
    if (row.outcome === "skip" && decision.action !== "update") {
      return {
        code: "VALIDATION_FAILED",
        message: `Red ${decision.rowNumber} je preskočen u pregledu i ne može se uvesti bez izbora „ažuriraj“.`,
      };
    }
    if (decision.action === "update" && row.outcome !== "skip") {
      return { code: "VALIDATION_FAILED", message: `Red ${decision.rowNumber} nema postojeći zapis za ažuriranje.` };
    }
    if (row.outcome === "duplicate" && decision.action !== "import") {
      return { code: "VALIDATION_FAILED", message: `Red ${decision.rowNumber}: izaberite „uvezi kao novog“ ili preskočite.` };
    }
  }

  return withCompany(pool, companyId, async (client) => {
    // Sve ili ništa: `withCompany` drži transakciju, pa greška na jednom redu vraća sve.
    // Uvoz je jedna radnja sa jednim zapisom u tragu (vidi audit niže), pa se pojedinačni
    // `equipment.updated` ovdje ne piše — inače bi jedan uvoz ostavio stotine zapisa.
    const result: ApplyResult = { imported: 0, skipped: 0, failed: 0, updated: 0, errors: [] };
    const supervisors = await loadSupervisorIndex(client);

    for (const decision of decisions) {
      const row = byRow.get(decision.rowNumber);
      if (!row || decision.action === "skip") {
        result.skipped += 1;
        continue;
      }

      try {
        if (kind === "workers") {
          if (decision.action === "update") {
            const existing = await findExistingWorker(client, row.summary);
            if (!existing) throw new Error("Radnik za ažuriranje nije pronađen.");
            await updateWorkerRow(client, existing, row, supervisors);
            result.updated += 1;
          } else {
            await insertWorkerRow(client, companyId, row, supervisors);
            result.imported += 1;
          }
        } else if (decision.action === "update") {
          await updateMachineRow(client, row);
          result.updated += 1;
        } else {
          await insertMachineRow(client, companyId, row);
          result.imported += 1;
        }
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ rowNumber: decision.rowNumber, message });
        // Transakcija se prekida namjerno: djelimično uvezen fajl je gori od neuspjelog uvoza.
        throw new ImportAbort(message, result);
      }
    }

    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "import.applied",
      entityType: kind === "workers" ? "worker" : "equipment",
      entityId: fileName,
      // Bez imena, telefona i emailova: trag je za radnju, ne za kopiju ličnih podataka.
      metadata: {
        kind,
        fileName,
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
      },
    });

    return result;
  }).catch((error: unknown) => {
    if (error instanceof ImportAbort) return error.result;
    throw error;
  });
}

class ImportAbort extends Error {
  constructor(
    message: string,
    readonly result: ApplyResult,
  ) {
    super(message);
    this.name = "ImportAbort";
  }
}

async function loadSupervisorIndex(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<{ id: string; first_name: string; last_name: string }>(
    "SELECT id, first_name, last_name FROM workers WHERE is_active",
  );
  const index = new Map<string, string>();
  for (const row of result.rows) {
    index.set(normaliseName(`${row.first_name} ${row.last_name}`), row.id);
  }
  return index;
}

async function findExistingWorker(client: PoolClient, summary: string): Promise<string | null> {
  const [firstName, ...rest] = summary.split(" ");
  const lastName = rest.join(" ");
  const result = await client.query<{ id: string }>(
    "SELECT id FROM workers WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2) LIMIT 1",
    [firstName, lastName],
  );
  return result.rows[0]?.id ?? null;
}

type RowValues = Record<string, string | number | null>;

async function insertWorkerRow(
  client: PoolClient,
  companyId: CompanyId,
  row: PreviewRow,
  supervisors: Map<string, string>,
): Promise<void> {
  const values = row.values as RowValues;
  const supervisor = values.supervisor ? supervisors.get(normaliseName(String(values.supervisor))) : null;
  await client.query(
    `INSERT INTO workers (id, company_id, first_name, last_name, phone, email, job_title, engagement,
                          hired_at, ended_at, team, supervisor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      `wrk_${crypto.randomUUID()}`,
      companyId,
      values.firstName,
      values.lastName,
      values.phone,
      values.email,
      values.jobTitle,
      values.engagement,
      values.hiredAt,
      values.endedAt,
      values.team,
      supervisor,
    ],
  );
}

async function updateWorkerRow(
  client: PoolClient,
  workerId: string,
  row: PreviewRow,
  supervisors: Map<string, string>,
): Promise<void> {
  const values = row.values as RowValues;
  const supervisor = values.supervisor ? supervisors.get(normaliseName(String(values.supervisor))) : null;
  await client.query(
    `UPDATE workers
        SET phone = $2, email = $3, job_title = $4, engagement = $5,
            hired_at = $6, ended_at = $7, team = $8, supervisor_id = $9, updated_at = now()
      WHERE id = $1`,
    [
      workerId,
      values.phone,
      values.email,
      values.jobTitle,
      values.engagement,
      values.hiredAt,
      values.endedAt,
      values.team,
      supervisor,
    ],
  );
}

async function insertMachineRow(client: PoolClient, companyId: CompanyId, row: PreviewRow): Promise<void> {
  const values = row.values as RowValues;
  const meterValue = values.meterValue as number | null;
  // Vrsta brojila se nasljeđuje iz kategorije: kamion mjeri kilometre, bager sate.
  const category = await client.query<{ meter: string }>("SELECT meter FROM equipment_categories WHERE id = $1", [
    values.categoryId,
  ]);
  if (category.rowCount === 0) throw new Error("Kategorija mašine nije pronađena.");

  await client.query(
    `INSERT INTO machines (id, company_id, code, name, category_id, make, model, serial_no, plate,
                           year, ownership, meter, meter_value, meter_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      `mch_${crypto.randomUUID()}`,
      companyId,
      values.code,
      values.name,
      values.categoryId,
      values.make,
      values.model,
      values.serialNo,
      values.plate,
      values.year,
      values.ownership,
      category.rows[0]!.meter,
      meterValue,
      meterValue === null ? null : new Date(),
    ],
  );
}

async function updateMachineRow(client: PoolClient, row: PreviewRow): Promise<void> {
  const values = row.values as RowValues;
  await client.query(
    `UPDATE machines
        SET name = $2, category_id = $3, make = $4, model = $5, serial_no = $6, plate = $7,
            year = $8, ownership = $9, updated_at = now()
      WHERE code = $1`,
    [
      values.code,
      values.name,
      values.categoryId,
      values.make,
      values.model,
      values.serialNo,
      values.plate,
      values.year,
      values.ownership,
    ],
  );
}
