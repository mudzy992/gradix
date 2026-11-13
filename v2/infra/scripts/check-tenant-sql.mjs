#!/usr/bin/env node
/**
 * B1 — trajna zaštita izolacije tenanata (statička provjera).
 *
 * Pravilo: NIKAKAV SQL upit u web servisima ne smije dirati tenant tabelu bez
 * `company_id` u upitu. RLS ostaje glavna ograda; ovo je druga, vidljiva linija
 * odbrane koja se lako pregleda u kodu i koju CI čuva od regresija.
 *
 *   * tenant tabela = tabela sa kolonom `company_id` (lista dolje, unakrsno
 *     se provjerava s katalogom baze kad je baza dostupna — vidi kraj).
 *   * JEDINI izuzetak: `users` — globalni identitet bez company_id; sesije i
 *     članstva veju korisnika na firmu, ne obrnuto.
 *   * prekršaj = upit koji spominje tenant tabelu, a `company_id` nije u
 *     „tenant kontekstu": NAKON neke WHERE klauze, u INSERT listi kolona, ili
 *     iza neprozirne interpolacije (${where} i sl.). `company_id` samo u
 *     JOIN ON uvjetu NIJE tenant predikat i NE prolazi.
 *
 * Poznate granice (namjerno prihvaćene, RLS i dalje čuva):
 *   * interpolacije izraza (npr. `${where}`, `${table}`) tretiraju se kao
 *     neprozirne — vidi se samo statički dio; `${CONST}` konstante iz iste
 *     datoteke se razrješavaju rekurzivno.
 *   * provjera je tekstualna: `company_id` u JOIN uvjetu prolazi kao i onaj u
 *     WHERE — zato servisi drže uzorak „WHERE ... AND x.company_id = $n".
 *
 * Upotreba: pnpm check-tenant-sql   (iz v2/)
 *   s bazom:  DATABASE_ADMIN_URL=... pnpm check-tenant-sql
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const v2Root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverDir = join(v2Root, "apps", "web", "src", "server");

// MORA odgovarati katalogu baze (tabele sa kolonom company_id, šema public).
// Skripta to provjerava automatski kad je baza dostupna — vidi provjeraKataloga().
const TENANT_TABLES = [
  "audit_events",
  "equipment_categories",
  "invitations",
  "machines",
  "memberships",
  "obligation_attachments",
  "obligation_types",
  "obligation_versions",
  "obligations",
  "password_resets",
  "project_assignment_overrides",
  "project_assignments",
  "projects",
  "sessions",
  "sync_change_log",
  "sync_conflicts",
  "sync_cursor_allocators",
  "sync_cursor_slots",
  "sync_receipts",
  "work_entries",
  "workdays",
  "workers",
];

// ---------- 1. skeniranje izvora servisa ----------

/** Rekurzivni popis .ts/.tsx datoteka (bez testova i deklaracija). */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.[cm]?tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield path;
    }
  }
}

/** `const NAME = \`...\`` konstante iz datoteke (za razrješavanje ${NAME}). */
function collectTemplateConstants(source) {
  const consts = new Map();
  const re = /(?:^|\n)[ \t]*(?:export[ \t]+)?const[ \t]+([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*`([^`]*)`/g;
  for (const m of source.matchAll(re)) consts.set(m[1], m[2]);
  return consts;
}

/** Zamijeni ${CONST} vrijednošću konstante iz iste datoteke, rekurzivno. */
function resolveConstants(sql, consts, seen = new Set()) {
  return sql.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (whole, name) => {
    if (!consts.has(name) || seen.has(name)) return whole; // nepoznato/ciklus → ostavi
    seen.add(name);
    return resolveConstants(consts.get(name), consts, seen);
  });
}

/**
 * Je li `company_id` u „tenant kontekstu" razriješenog SQL teksta?
 *   1. NAKON bilo koje WHERE klauze (klasični predikat);
 *   2. u INSERT listi kolona (red dobija company_id iz parametra);
 *   3. iza neprozirne interpolacije — ${where}/${cond(...)} gradi uslove
 *      run-time, a servisi ih uvijek počinju company_id uslovom;
 *   4. `token_hash = $n` u WHERE — pre-login tokovi (pregled pozivnice,
 *      potrošnja linka) nemaju firmu iz sesije: tenant se saznaje IZ reda,
 *      a hash nepogodljivog tokena sidri red isto čvrsto kao company_id.
 * `company_id` isključivo u JOIN ON uvjetu NIJE tenant predikat — ne prolazi.
 */
function companyInTenantContext(sql) {
  const whereIdx = sql.search(/\bWHERE\b/i);
  // 4. sidro tokenom — eksplicitan token_hash predikat u WHERE klauzi
  if (whereIdx !== -1 && /\btoken_hash\s*=\s*\$\d/.test(sql.slice(whereIdx))) return true;
  if (!/\bcompany_id\b/i.test(sql)) return false;
  // 3. neprozirna interpolacija iz koje se gradi WHERE
  if (/\$\{(?![A-Z][A-Z0-9_]*\})/.test(sql)) return true;
  // 1. company_id u/iza WHERE klauze
  if (whereIdx !== -1 && /\bcompany_id\b/i.test(sql.slice(whereIdx))) return true;
  // 2. INSERT INTO t (..., company_id, ...) — kolone prije VALUES/SELECT
  const ins = sql.match(/\bINSERT\s+INTO\s+[\w.]+\s*\(([^)]*)\)/i);
  if (ins && /\bcompany_id\b/i.test(ins[1])) return true;
  return false;
}

/** Svi .query<T...>(`SQL` / "SQL") pozivi — generika do jedne razine ugniježđenja. */
function extractQueries(source) {
  const queries = [];
  const re = /\.query(?:<(?:[^<>]|<[^<>]*>)*>)?\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gs;
  for (const m of source.matchAll(re)) {
    const line = source.slice(0, m.index).split("\n").length; // 1-bazirano
    queries.push({ line, sql: m[1] });
  }
  return queries;
}

const violations = [];
let scanned = 0;

for (const path of walk(serverDir)) {
  const source = readFileSync(path, "utf8");
  const consts = collectTemplateConstants(source);
  for (const q of extractQueries(source)) {
    scanned += 1;
    const sql = resolveConstants(q.sql, consts);
    const tables = TENANT_TABLES.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(sql));
    if (tables.length > 0 && !companyInTenantContext(sql)) {
      const preview = sql.replace(/\s+/g, " ").slice(0, 110);
      violations.push({ path: path.slice(v2Root.length + 1), line: q.line, tables, preview });
    }
  }
}

// ---------- 2. katalog baze (kad je dostupan) drži listu tabelu iskrenom ----------

/** Katalog iz baze preko node-postgres (pg je dependency web aplikacije). */
async function catalogFromDb() {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) return null;
  try {
    // pg ne razumije Prisma `?schema=public` — ostatak query stringa ostaje.
    const clean = url.replace(/[?&]schema=[^&]*/g, "").replace(/\?$/, "");
    const { createRequire } = await import("node:module");
    const require = createRequire(join(v2Root, "apps", "web", "package.json"));
    const { Client } = require("pg");
    const client = new Client({ connectionString: clean });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'company_id'
          GROUP BY table_name ORDER BY table_name`,
      );
      return result.rows.map((row) => row.table_name);
    } finally {
      await client.end();
    }
  } catch {
    return null; // baza nedostupna — statička provjera se i dalje izvršava
  }
}

const catalog = await catalogFromDb();
// Poređenje kao SKUPOVI: kolacija baze može drugačije redati imena (npr. zanemariti `_`).
const sameSet = (a, b) => a.length === b.length && a.every((t) => b.includes(t));
const catalogMismatch = catalog && !sameSet(catalog, TENANT_TABLES);

// ---------- izvještaj ----------

const rel = (p) => p;
if (catalog) {
  console.log(`katalog baze: ${catalog.length} tenant tabela — lista u skripti ${TENANT_TABLES.length}`);
} else {
  console.log("katalog baze: nedostupan (nema URL-a ili psql-a) — preskočena unakrsna provjera");
}
console.log(`skeniranih .query poziva: ${scanned} u ${rel("apps/web/src/server")}`);

let failed = false;

if (catalogMismatch) {
  failed = true;
  const inDb = catalog.filter((t) => !TENANT_TABLES.includes(t));
  const inScript = TENANT_TABLES.filter((t) => !catalog.includes(t));
  console.error("\nB1: lista tenant tabela u skripti NE odgovara katalogu baze:");
  if (inDb.length) console.error(`  u bazi, a ne u skripti: ${inDb.join(", ")}`);
  if (inScript.length) console.error(`  u skripti, a ne u bazi: ${inScript.join(", ")}`);
  console.error("  → ažurirajte TENANT_TABLES u infra/scripts/check-tenant-sql.mjs");
}

if (violations.length > 0) {
  failed = true;
  console.error(`\nB1 IZOLACIJA TENANATA — ${violations.length} upit(a) bez company_id:`);
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line}`);
    console.error(`    tabele: ${v.tables.join(", ")}`);
    console.error(`    upit:   ${v.preview}`);
  }
  console.error("\nSvaki upit nad tenant tabelom mora nositi company_id (RLS je ograda,");
  console.error("ovo je vidljiva druga linija). Jedini izuzetak: users (globalni identitet).");
} else {
  console.log("B1: svi upiti nad tenant tabelama nose company_id ✓ (izuzetak: users — globalni identitet)");
}

process.exit(failed ? 1 : 0);
