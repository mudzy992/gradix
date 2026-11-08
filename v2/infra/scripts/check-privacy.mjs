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
 *  2. Lični podaci u poljima koja ih po imenu traže (`jmbg`, `broj_licne`, `bankovni_racun`) —
 *     u R2a tih kolona nema, pa pojava imena polja znači da se nešto vratilo.
 *  3. Email adrese van dopuštenih domena za fikciju.
 *
 * Ne traži imena i prezimena: „Amina Karić“ je sintetičko ime koje se ne razlikuje od stvarnog,
 * i takva provjera bi davala lažne pogotke bez ijedne koristi.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "target",
  ".venv",
  "__pycache__",
  "demo-dizajn",
  "dist-web",
  // Skripta sama sadrži obrasce koje traži — ne provjeravati sebe.
  "scripts",
]);
/**
 * Dopušteni domeni: demo domen iz seeda, `*.test` (rezervisan za testove, RFC 2606) i
 * dokumentacija. Stvarni domeni — uključujući `@druga.ba` za testnu firmu — nisu dopušteni.
 */
const ALLOWED_EMAIL =
  /^[A-Za-z0-9._%+-]+@([a-z0-9-]+\.)*(test|example)$|^[A-Za-z0-9._%+-]+@(demo\.ba|example\.com|example\.org|example\.net|localhost)$/i;

const findings = [];

/** JMBG: DDMMGGG RR BBB K, gdje je K kontrolna cifra (mod 11). */
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

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full);
      continue;
    }
    if (info.size > 2_000_000) continue;
    // Zaključani fajl paketa i generisani dokument nisu izvor podataka o ljudima.
    if (entry === "pnpm-lock.yaml" || entry === "openapi.json") continue;
    if (!/\.(ts|tsx|js|mjs|cjs|json|md|sql|ya?ml|html|css|txt|csv)$/.test(entry)) continue;

    const text = readFileSync(full, "utf8");
    const path = relative(root, full);
    const lines = text.split("\n");

    lines.forEach((line, index) => {
      const where = `${path}:${index + 1}`;
      for (const match of line.matchAll(/\b\d{13}\b/g)) {
        if (isJmbg(match[0])) findings.push(`${where} JMBG (13 cifara, ispravna kontrolna cifra)`);
      }
      // Polja ličnih podataka su zabranjena; rečenica koja ih zabranjuje nije nalaz.
      if (
        /\b(jmbg|broj_licne|licna_karta|bankovni_racun|iban)\b/i.test(line) &&
        !/ne unose|Ne unose|bez JMBG|JMBG, adresa|ne postoje kao kolone|JMBG, bankovni račun|na JMBG|pravilo se sužava/i.test(line)
      ) {
        findings.push(`${where} polje ličnog podatka koje R2a ne smije imati`);
      }
      for (const match of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.?[A-Za-z]{2,}/g)) {
        const address = match[0];
        // `LOZINKA@HOST` u dokumentaciji je oznaka za unos, ne adresa.
        // Oznake za unos iz dokumentacije (`LOZINKA@HOST`, `+@all` u Redis ACL-u) nisu adrese.
        if (/^[A-Z]+@[A-Z]+$/.test(address) || !address.includes(".")) continue;
        // Punjači paketa i primjeri iz Zod dokumentacije nisu lični podaci.
        if (/@(jsr\.io|npmjs\.com|schema\.org|github\.com|anthropic\.com)$/i.test(address)) continue;
        if (!ALLOWED_EMAIL.test(address)) findings.push(`${where} email van dopuštenih domena: ${address}`);
      }
    });
  }
}

walk(root);

if (findings.length > 0) {
  console.error("Nađeni lični podaci (vlasnička odluka: repo sadrži samo sintetičke podatke):");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error("\nIspravite ili, ako je pogodak lažan, suzite pravilo u infra/scripts/check-privacy.mjs.");
  process.exit(1);
}

console.log("Privatnost: nema JMBG-a, polja ličnih podataka ni stranih email adresa.");
