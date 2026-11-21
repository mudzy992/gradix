#!/usr/bin/env node
// BE-01 — Prisma šema: svaki strani ključ treba vodeći indeks.
//
// Postgres **ne** indeksira strane ključeve automatski. Prisma pravi indeks samo kad se traži
// (`@@index`/`@@unique`). Bez indeksa: spori JOIN-ovi i spora `DELETE`/`UPDATE` kaskada.
//
// Guard ne mijenja šemu (to je migracija = odluka vlasnika). On **zaključava trenutno stanje**:
//  - novi FK bez vodećeg indeksa → exit 1,
//  - baseline unos koji više ne postoji (indeks dodan) → upozorenje „skini ga iz baseline-a“.
//
//   node scripts/standards/check-schema.mjs

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, Report, finish } from './lib.mjs';

const SCHEMA_DIR = 'backend/prisma/schema';
const BASELINE = 'backend/prisma/index-baseline.json';

const report = new Report(
  'Prisma šema: indeksi na stranim ključevima',
  'Postgres ne indeksira FK kolone; bez indeksa JOIN i kaskadni DELETE skeniraju tabelu',
  `dodaj @@index([fk]) u šemu uz migraciju, ili (ako je svjesno odgođeno) upiši u ${BASELINE} sa razlogom`,
);

const files = fs
  .readdirSync(path.join(ROOT, SCHEMA_DIR))
  .filter((f) => f.endsWith('.prisma'))
  .sort();

const baselineFile = path.join(ROOT, BASELINE);
const baseline = fs.existsSync(baselineFile)
  ? new Set(Object.entries(JSON.parse(fs.readFileSync(baselineFile, 'utf8')).missing ?? {}).map(([m]) => m))
  : new Set();

const found = new Map(); // "Model.field" → fajl

for (const file of files) {
  const text = fs.readFileSync(path.join(ROOT, SCHEMA_DIR, file), 'utf8');
  for (const block of text.matchAll(/model (\w+) \{(.*?)\n\}/gs)) {
    const model = block[1];
    const body = block[2];
    const fks = [...body.matchAll(/^\s+(\w+Id)\s+String\??/gm)].map((m) => m[1]);
    if (!fks.length) continue;
    const indexed = new Set(
      [...body.matchAll(/@@(?:index|unique)\(\[([^\]]+)\]/g)].map((m) => m[1].split(',')[0].trim()),
    );
    for (const fk of fks) {
      if (indexed.has(fk)) continue;
      found.set(`${model}.${fk}`, `${SCHEMA_DIR}/${file}`);
    }
  }
}

for (const [key, where] of [...found].sort()) {
  report.bump();
  if (baseline.has(key)) continue;
  report.violation(where, `${key} nema vodeći indeks (FK)`);
}

for (const key of [...baseline].sort()) {
  report.bump();
  if (!found.has(key)) report.warning(BASELINE, `${key} više nema problem — skini unos iz baseline-a`);
}

console.log(`   FK bez indeksa: ${found.size} (u baseline-u: ${baseline.size})`);
finish(report);
