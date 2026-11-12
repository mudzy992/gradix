/**
 * Administratorska naredba: puni demo firmu podacima iz sintetičkih fajlova
 * u `v2/docs/demo-podaci/` (izmišljeni podaci, bez ličnih podataka).
 *
 * Šta radi:
 *  - radnike i mašine uvozi kroz ISTI servis kao Uvoz iz aplikacije
 *    (previewImport + applyImport) — vrijede ista pravila duplikata:
 *    radnik = isto ime i prezime ili isti telefon; mašina = ista
 *    inventarska oznaka (preskače se, ne ažurira se tiho);
 *  - rokove uvozi kao obaveze s verzijama (createObligation), povezane po
 *    oznaci mašine, imenu radnika ili šifri projekta; što se ne može
 *    povezati prijavi se i preskoči — ništa se ne uvozi tiho pogrešno;
 *  - datumi rokova su podešeni prema 12. 11. 2026; naredba ih pomjera
 *    relativno prema današnjem danu, pa uvijek postoje stanja: isteklo,
 *    ističe u 30 dana, ističe za 31–90 dana i važi.
 *
 * Sigurnost: radi samo za demo firmu (slug `niskogradnja-demo`), pod
 * administratorskom rolom baze, nikad iz aplikacije. Idempotentno: drugi
 * poziv sve prijavi kao duplikate/preskočeno.
 *
 * Pokretanje (vidi docs/COOLIFY.md):
 *   DATABASE_URL=... pnpm --filter @gradix/web exec tsx scripts/seed-demo-podaci.ts
 *
 * Baza se otvara APLIKACIJSKOM rolom (DATABASE_URL), ne administratorskom:
 * servis uvoza se oslanja na RLS opseg firme (s administratorskom rolom bi
 * pregled vidio kategorije i radnike svih firmi i pogriješio firmu).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { parseWorkbook, toIsoDate } from "../src/server/import-parser";
import {
  applyImport, previewImport, suggestMapping, equipmentCode,
  type ApplyDecision,
} from "../src/server/import-service";
import {
  createObligation, createObligationType, isServiceError,
} from "../src/server/obligation-service";
import { DEMO_COMPANY_SLUG } from "./demo-sukobi";

const FILES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "demo-podaci");
/** Datum prema kojem su podešeni rokovi u fajlu (relativno pomjeranje). */
export const ROKOVI_ANCHOR = "2026-11-12";

export type DemoPodaciReport = {
  workers: { imported: number; duplicates: number; errors: number; skipped: number };
  machines: { imported: number; duplicates: number; errors: number; skipped: number };
  obligations: {
    created: number;
    duplicates: number;
    skipped: { rowNumber: number; reason: string }[];
  };
  dateShiftDays: number;
};

function sarajevoToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

function typeCode(label: string, kind: string, ambiguous: boolean): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return ambiguous ? `${base}_${kind}` : base;
}

const KIND_MAP: Record<string, "WORKER" | "MACHINE" | "PROJECT" | "COMPANY"> = {
  radnik: "WORKER",
  masina: "MACHINE",
  projekat: "PROJECT",
  firma: "COMPANY",
};

function normalise(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Slug → id demo firme, pod administratorskom rolom (firme su izvan RLS
 * dosega aplikacijske role prije postavljanja tenant konteksta). Ovdje je
 * i sigurnosna kapija: svaki slug osim demo slug-a se odbija prije upisa.
 */
export async function resolveDemoCompany(adminPool: Pool, slug: string): Promise<string> {
  if (slug !== DEMO_COMPANY_SLUG) {
    throw new Error(
      `Odbijeno: naredba radi samo za demo firmu (slug ${DEMO_COMPANY_SLUG}), traženo je „${slug}". Ništa nije mijenjano.`,
    );
  }
  const company = await adminPool.query<{ id: string }>(
    "SELECT id FROM public.companies WHERE slug = $1",
    [slug],
  );
  const found = company.rows[0]?.id;
  if (!found) throw new Error(`Demo firma (slug ${slug}) ne postoji. Prvo pokrenite seed.`);
  return found;
}

export async function seedDemoPodaci(
  pool: Pool,
  companyIdValue: string,
  filesDir: string = FILES_DIR,
): Promise<DemoPodaciReport> {
  const tenant = companyId(companyIdValue);

  const actorUserId = await withCompany(pool, tenant, async (client) => {
    const owner = await client.query<{ user_id: string }>(
      `SELECT user_id FROM public.memberships
        WHERE company_id = $1 AND is_active AND 'OWNER' = ANY(roles) LIMIT 1`,
      [companyIdValue],
    );
    return owner.rows[0]?.user_id;
  });
  if (!actorUserId) throw new Error("Demo firma nema vlasnika (OWNER) za audit zapis uvoza.");
  const actor = { userId: actorUserId, roles: ["OWNER"] };

  const report: DemoPodaciReport = {
    workers: { imported: 0, duplicates: 0, errors: 0, skipped: 0 },
    machines: { imported: 0, duplicates: 0, errors: 0, skipped: 0 },
    obligations: { created: 0, duplicates: 0, skipped: [] },
    dateShiftDays: dayDiff(ROKOVI_ANCHOR, sarajevoToday()),
  };

  // --- Radnici i mašine: isti servis kao Uvoz iz aplikacije. ---
  for (const [kind, fileName] of [["workers", "radnici-popunjeno.xlsx"], ["equipment", "masine-popunjeno.xlsx"]] as const) {
    const sheet = await parseWorkbook(readFileSync(join(filesDir, fileName)), fileName);
    if ("code" in sheet) throw new Error(`${fileName}: ${sheet.message}`);
    const mapping = suggestMapping(kind, sheet.headers);
    const preview = await previewImport(pool, tenant, kind, sheet, mapping);
    if ("code" in preview) throw new Error(`${fileName}: ${preview.message}`);
    const decisions: ApplyDecision[] = preview.rows.map((row) => ({
      rowNumber: row.rowNumber,
      action: row.outcome === "import" ? "import" : "skip",
    }));
    const applied = await applyImport(pool, tenant, actor, kind, sheet, mapping, decisions, fileName);
    if ("code" in applied) throw new Error(`${fileName}: ${applied.message}`);
    const bucket = kind === "workers" ? report.workers : report.machines;
    bucket.imported = applied.imported;
    bucket.skipped = applied.skipped;
    bucket.duplicates = preview.counts.duplicate + (kind === "equipment" ? preview.counts.skip : 0);
    bucket.errors = preview.counts.error;
  }

  // --- Rokovi: obaveze s verzijama, povezane po entitetu. ---
  const rokovi = await parseWorkbook(readFileSync(join(filesDir, "rokovi-popunjeno.xlsx")), "rokovi-popunjeno.xlsx");
  if ("code" in rokovi) throw new Error(`rokovi-popunjeno.xlsx: ${rokovi.message}`);

  await withCompany(pool, tenant, async (client) => {
    const machines = await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM public.machines WHERE company_id = $1",
      [companyIdValue],
    );
    const machineByCode = new Map(machines.rows.map((row) => [equipmentCode(row.code) ?? row.code, row.id]));
    const workers = await client.query<{ id: string; first_name: string; last_name: string }>(
      "SELECT id, first_name, last_name FROM public.workers WHERE company_id = $1 AND is_active",
      [companyIdValue],
    );
    const workerByName = new Map(
      workers.rows.map((row) => [normalise(`${row.first_name} ${row.last_name}`), row.id]),
    );
    const projects = await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM public.projects WHERE company_id = $1",
      [companyIdValue],
    );
    const projectByCode = new Map(projects.rows.map((row) => [row.code, row.id]));

    // Tipovi obaveza po (naziv iz fajla, vrsta entiteta); isti naziv za dvije
    // vrste (npr. Osiguranje firme i mašine) dobija sufiks vrste u oznaci.
    const labelsByName = new Map<string, Set<string>>();
    for (const row of rokovi.rows) {
      const label = String(row.cells["Tip obaveze"] ?? "");
      const kind = KIND_MAP[normalise(String(row.cells["Vrsta entiteta"] ?? ""))];
      if (label && kind) {
        const set = labelsByName.get(label) ?? new Set<string>();
        set.add(kind);
        labelsByName.set(label, set);
      }
    }
    const typeIdByKey = new Map<string, string>();
    const existingTypes = await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM public.obligation_types WHERE company_id = $1",
      [companyIdValue],
    );
    const existingByCode = new Map(existingTypes.rows.map((row) => [row.code, row.id]));
    for (const [label, kinds] of labelsByName) {
      for (const kind of kinds) {
        const code = typeCode(label, kind, kinds.size > 1);
        const key = `${label}|${kind}`;
        const existing = existingByCode.get(code);
        if (existing) {
          typeIdByKey.set(key, existing);
          continue;
        }
        const created = await createObligationType(pool, tenant, actor, {
          code, label, entityKind: kind,
        });
        if (isServiceError(created)) throw new Error(`Tip obaveze ${code}: ${created.message}`);
        typeIdByKey.set(key, created.id);
      }
    }

    for (const row of rokovi.rows) {
      const kindText = String(row.cells["Vrsta entiteta"] ?? "");
      const kind = KIND_MAP[normalise(kindText)];
      const label = String(row.cells["Tip obaveze"] ?? "");
      const ref = String(row.cells["Oznaka ili ime"] ?? "").trim();
      const skip = (reason: string) => report.obligations.skipped.push({ rowNumber: row.rowNumber, reason });
      if (!kind || !label) {
        skip(`Red ${row.rowNumber}: nepoznata vrsta entiteta ili tip obaveze.`);
        continue;
      }
      const typeId = typeIdByKey.get(`${label}|${kind}`);
      if (!typeId) {
        skip(`Red ${row.rowNumber}: tip „${label}" nije napravljen.`);
        continue;
      }

      let entity: { workerId?: string; machineId?: string; projectId?: string; scopeCompany?: boolean } | null = null;
      if (kind === "COMPANY") entity = { scopeCompany: true };
      if (kind === "MACHINE") {
        const id = machineByCode.get(equipmentCode(ref) ?? ref);
        if (id) entity = { machineId: id };
      }
      if (kind === "WORKER") {
        const id = workerByName.get(normalise(ref));
        if (id) entity = { workerId: id };
      }
      if (kind === "PROJECT") {
        const id = projectByCode.get(ref);
        if (id) entity = { projectId: id };
      }
      if (!entity) {
        skip(`Red ${row.rowNumber}: „${ref}" (${kindText}) se ne može povezati — nema takve oznake/imena u firmi.`);
        continue;
      }

      const issuedRaw = toIsoDate(row.cells["Datum izdavanja"] ?? null);
      const expiresRaw = toIsoDate(row.cells["Datum isteka"] ?? null);
      if (!expiresRaw) {
        skip(`Red ${row.rowNumber}: datum isteka nije ispravan datum.`);
        continue;
      }
      const issuedAt = issuedRaw ? shiftIsoDate(issuedRaw, report.dateShiftDays) : null;
      const expiresAt = shiftIsoDate(expiresRaw, report.dateShiftDays);
      const number = String(row.cells["Broj isprave"] ?? "").trim() || null;

      const duplicate = await client.query(
        `SELECT 1 FROM public.obligations
          WHERE company_id = $1 AND type_id = $2
            AND COALESCE(worker_id, '') = COALESCE($3, '')
            AND COALESCE(machine_id, '') = COALESCE($4, '')
            AND COALESCE(project_id, '') = COALESCE($5, '')
            AND COALESCE(number, '') = COALESCE($6, '')
            AND expires_at IS NOT DISTINCT FROM $7::date`,
        [
          companyIdValue, typeId, entity.workerId ?? null, entity.machineId ?? null,
          entity.projectId ?? null, number, expiresAt,
        ],
      );
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        report.obligations.duplicates += 1;
        continue;
      }

      const created = await createObligation(pool, tenant, actor, {
        typeId,
        ...entity,
        number,
        issuer: String(row.cells["Izdavalac"] ?? "").trim() || null,
        issuedAt,
        expiresAt,
        note: String(row.cells["Napomena"] ?? "").trim() || null,
      });
      if (isServiceError(created)) {
        skip(`Red ${row.rowNumber}: ${created.message}`);
        continue;
      }
      report.obligations.created += 1;
    }
  });

  return report;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const dbUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("Potreban DATABASE_ADMIN_URL (za pronalazak demo firme)");
  if (!dbUrl) throw new Error("Potreban DATABASE_URL (aplikacijska rola, za servis uvoza)");
  const adminPool = new Pool({ connectionString: adminUrl });
  const pool = new Pool({ connectionString: dbUrl });
  try {
    const companyIdValue = await resolveDemoCompany(adminPool, process.argv[2] ?? DEMO_COMPANY_SLUG);
    const result = await seedDemoPodaci(pool, companyIdValue);
    console.log("Seed demo podataka — izvještaj:");
    console.log(`  radnici:  uvezeno=${result.workers.imported} duplikati=${result.workers.duplicates} greške=${result.workers.errors} preskočeno=${result.workers.skipped}`);
    console.log(`  mašine:   uvezeno=${result.machines.imported} duplikati=${result.machines.duplicates} greške=${result.machines.errors} preskočeno=${result.machines.skipped}`);
    console.log(`  obaveze:  napravljeno=${result.obligations.created} duplikati=${result.obligations.duplicates} preskočeno=${result.obligations.skipped.length}`);
    for (const item of result.obligations.skipped) console.log(`    - ${item.reason}`);
    console.log(`  datumi rokova pomjereni za ${result.dateShiftDays} dana (sidro ${ROKOVI_ANCHOR} → danas).`);
    console.log("Pravilo duplikata: radnik = isto ime+prezime ili isti telefon; mašina = ista inventarska oznaka; obaveza = isti tip + entitet + broj isprave + datum isteka.");
  } finally {
    await pool.end();
    await adminPool.end();
  }
}
