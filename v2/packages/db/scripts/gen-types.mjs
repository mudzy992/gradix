#!/usr/bin/env node
/**
 * Generiše `src/schema.generated.ts` iz žive baze (kysely-codegen).
 *
 * Zašto skripta, a ne CLI direktno: `kysely-codegen` čita `DATABASE_URL`, a nama treba
 * mogućnost da u CI-ju pokažemo RAZLIKU bez prepisivanja fajla (`--check`).
 *
 *   pnpm db:types          → generiši (prepisuje fajl)
 *   pnpm db:types:check    → padni ako se generisano razlikuje od commitovanog
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const outFile = new URL("../src/schema.generated.ts", import.meta.url);
const tmpFile = new URL("../src/schema.generated.tmp.ts", import.meta.url);
const check = process.argv.includes("--check");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("GREŠKA: DATABASE_URL je obavezan (baza iz koje se čitaju tipovi).");
  process.exit(1);
}

const bin = fileURLToPath(new URL("../node_modules/.bin/kysely-codegen", import.meta.url));
const args = [
  "--dialect", "postgres",
  "--url", databaseUrl,
  "--out-file", fileURLToPath(tmpFile),
  "--include-pattern", "public.*",
  "--exclude-pattern", "public.schema_migrations",
  "--date-parser", "string",
  "--numeric-parser", "string",
];

const result = spawnSync(bin, args, { cwd: pkgDir, stdio: "inherit", env: process.env });
if (result.status !== 0) {
  rmSync(fileURLToPath(tmpFile), { force: true });
  console.error("GREŠKA: kysely-codegen nije prošao.");
  process.exit(result.status ?? 1);
}

const header = `/**
 * GENERISANO — ne mijenjati ručno. Izvor: živa baza (\`pnpm db:types\`).
 *
 * Zašto ovaj fajl postoji: baza je izvor istine (ADR 0015). Migracije su SQL i
 * naprijed-samo; tipovi se izvode iz stvarne šeme, pa se ne mogu razići sa njom.
 * CI provjerava sinhronizaciju preko \`pnpm db:types:check\`.
 */
`;
const generated = readFileSync(fileURLToPath(tmpFile), "utf8");
rmSync(fileURLToPath(tmpFile), { force: true });

const normalize = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();

if (check) {
  const current = existsSync(fileURLToPath(outFile)) ? readFileSync(fileURLToPath(outFile), "utf8") : "";
  if (normalize(current) !== normalize(header + generated)) {
    console.error(
      "GREŠKA: `schema.generated.ts` nije sinhron sa bazom.\n" +
        "Pokreni `pnpm db:types` i commitaj rezultat (baza se mijenja samo migracijama).",
    );
    process.exit(1);
  }
  console.log("OK: generisani tipovi su sinhroni sa bazom.");
  process.exit(0);
}

writeFileSync(fileURLToPath(outFile), header + generated, "utf8");
console.log(`OK: ${fileURLToPath(outFile)}`);
