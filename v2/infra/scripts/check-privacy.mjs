#!/usr/bin/env node
/**
 * Provjera da u repou nema stvarnih ličnih podataka.
 *
 * Vlasnička odluka (2026-11-08): test i seed podaci su isključivo sintetički, u repou ne smije
 * biti stvarnih ličnih podataka. Ovo je provjera koja to drži, umjesto pravila koje se pamti.
 *
 * Šta se traži:
 *  1. JMBG — 13 cifara koje prolaze kontrolnu cifru (mod 11). Sam format nije dovoljan: bez
 *     kontrolne cifre bi svaki broj od 13 cifara (npr. vrijeme u milisekundama) bio pogodak.
 *  2. Polja ličnih podataka u KODU (`jmbg`, `broj_licne`, `bankovni_racun`, `iban`) — u R2a tih
 *     kolona nema, pa pojava imena polja znači da se nešto vratilo. U `docs/` su imena polja
 *     dozvoljena: plan mora da ih imenuje da bi ih zabranio.
 *  3. Email adrese van rezervisanih domena (`*.test`, `example.*`, `@demo.ba`).
 *
 * Ne traži imena i prezimena: „Amina Karić“ je sintetičko ime koje se ne razlikuje od stvarnog,
 * i takva provjera bi davala lažne pogotke bez ijedne koristi.
 *
 * `--self-test` provjerava da pravilo pada na stvarni podatak i propušta lažni. Pravilo koje ne
 * padne na stvarni JMBG izgleda kao zaštita, a nije — zato je samoprovjera dio CI koraka.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "dist-web",
  "build",
  "target",
  ".venv",
  "__pycache__",
  // Skripta sama sadrži obrasce koje traži — ne provjerava sebe.
  "scripts",
  "demo-dizajn",
]);

/** Zaključani fajl paketa i generisani dokument nisu izvor podataka o ljudima. */
const SKIP_FILES = new Set(["pnpm-lock.yaml", "openapi.json"]);

const CODE_FILE = /\.(ts|tsx|js|mjs|cjs|sql)$/;
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|sql|ya?ml|html|css|txt|csv)$/;

/**
 * Dopušteni domeni: `*.test` (rezervisan za testove), `example.*` (RFC 2606) i `@demo.ba`.
 */
const ALLOWED_EMAIL =
  /^[A-Za-z0-9._%+-]+@([a-z0-9-]+\.)*(test|example)$|^[A-Za-z0-9._%+-]+@(demo\.ba|example\.com|example\.org|example\.net|localhost)$/i;

/** `DDMMGGG RR BBB K`; K = 11 − (suma težina mod 11), gdje 10 → 0 i 11 → 1. */
function isJmbg(candidate) {
  if (!/^\d{13}$/.test(candidate)) return false;
  const digits = candidate.split("").map(Number);
  const day = digits[0] * 10 + digits[1];
  const month = digits[2] * 10 + digits[3];
  if (day < 1 || day > 31 || month < 1 || month > 12) return false;
  const weights = [7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, index) => acc + weight * digits[index], 0);
  const control = 11 - (sum % 11);
  const expected = control === 10 ? 0 : control === 11 ? 1 : control;
  return expected === digits[12];
}

/** Vraća listu nalaza za dati korijen; prazna lista znači da je čisto. */
export function scan(root) {
  const findings = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const info = statSync(full);
      if (info.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
        continue;
      }
      if (SKIP_FILES.has(entry) || info.size > 2_000_000 || !TEXT_FILE.test(entry)) continue;

      const text = readFileSync(full, "utf8");
      const path = relative(root, full);
      const isCode = CODE_FILE.test(entry);

      text.split("\n").forEach((line, index) => {
        const where = `${path}:${index + 1}`;

        for (const match of line.matchAll(/\b\d{13}\b/g)) {
          if (isJmbg(match[0])) findings.push(`${where} JMBG (13 cifara, ispravna kontrolna cifra)`);
        }

        if (isCode && /\b(jmbg|broj_licne|licna_karta|bankovni_racun|iban)\b/i.test(line)) {
          findings.push(`${where} polje ličnog podatka koje R2a ne smije imati`);
        }

        for (const match of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
          const address = match[0];
          if (ALLOWED_EMAIL.test(address)) continue;
          findings.push(`${where} email van dopuštenih domena: ${address}`);
        }
      });
    }
  };

  walk(root);
  return findings;
}

/* ------------------------------------------------------------------ samoprovjera */

const CASES = [
  { name: "ispravan JMBG se hvata", file: "seed.ts", body: 'const j = "0101990151238";', expect: true },
  { name: "13 cifara sa pogrešnom kontrolnom prolazi", file: "seed.ts", body: 'const t = "0101990151230";', expect: false },
  { name: "stvarni email domen se hvata", file: "a.md", body: "kontakt: pero.peric@gmail.com", expect: true },
  { name: "demo domen prolazi", file: "a.md", body: "kontakt: ured@demo.ba", expect: false },
  { name: "polje JMBG-a u kodu se hvata", file: "schema.sql", body: "CREATE TABLE workers (jmbg TEXT);", expect: true },
  { name: "imenovanje polja u dokumentaciji prolazi", file: "docs/x.md", body: "- JMBG, adresa i bankovni račun se NE unose.", expect: false },
];

export function selfTest() {
  let failed = 0;
  for (const testCase of CASES) {
    const dir = mkdtempSync(join(tmpdir(), "privacy-"));
    const target = join(dir, testCase.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${testCase.body}\n`, "utf8");

    const hit = scan(dir).length > 0;
    const ok = hit === testCase.expect;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "✓" : "✗"} ${testCase.name}${ok ? "" : ` (očekivano ${testCase.expect ? "nalaz" : "čisto"})`}`);

    rmSync(dir, { recursive: true, force: true });
  }
  return failed;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    console.log("Samoprovjera pravila:");
    process.exit(selfTest() === 0 ? 0 : 1);
  }

  const root = resolve(args.find((arg) => !arg.startsWith("--")) ?? ".");
  const findings = scan(root);

  if (findings.length > 0) {
    console.error("Nađeni lični podaci (vlasnička odluka: repo sadrži samo sintetičke podatke):");
    for (const finding of findings) console.error(`  ${finding}`);
    console.error("\nIspravite ili, ako je pogodak lažan, suzite pravilo u infra/scripts/check-privacy.mjs.");
    process.exit(1);
  }

  console.log("Privatnost: nema JMBG-a, polja ličnih podataka ni stranih email adresa.");
}
