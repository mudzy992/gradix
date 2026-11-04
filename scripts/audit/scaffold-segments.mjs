#!/usr/bin/env node
// Generiše AUDIT/segments/<ID>.md skeletone (10 sekcija) iz segments.json + matrice.
// Postojeći fajlovi se NE prepisuju; --force je blokiran da se ne izgubi rad.
//
//   node scripts/audit/scaffold-segments.mjs           # samo nedostajući
//   node scripts/audit/scaffold-segments.mjs --force   # odbijeno: čuva postojeće izvještaje
//   node scripts/audit/scaffold-segments.mjs --check   # exit 1 ako neki segment nema fajl

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, MATRIX_PATH, readMatrix, readSegments } from './lib.mjs';

const DIR = path.join(ROOT, 'AUDIT/segments');
if (process.argv.includes('--force')) {
  console.error('❌ --force je blokiran: postojeći audit izvještaji ne smiju biti prepisani.');
  process.exit(1);
}
const check = process.argv.includes('--check');

const segments = readSegments();
const matrix = fs.existsSync(MATRIX_PATH) ? readMatrix() : new Map();

const filesBySegment = new Map();
for (const [file, row] of matrix) {
  if (!filesBySegment.has(row.segment)) filesBySegment.set(row.segment, []);
  filesBySegment.get(row.segment).push(file);
}
for (const list of filesBySegment.values()) list.sort();

function fileList(seg) {
  const files = filesBySegment.get(seg.id) ?? [];
  if (seg.scope === 'process') {
    return [
      '> **Procesni segment** — nema vlastitih izvornih fajlova u matrici.',
      `> Razlog: ${seg.scopeReason ?? '(nije zapisan)'}`,
      '',
      'Fajlovi koje segment mijenja ili provjerava (vlasništvo drugih segmenata):',
      '',
      '- _(popuniti pri izvršavanju)_',
    ].join('\n');
  }
  if (files.length === 0) return '_(nijedan fajl — provjeri klasifikaciju u `scripts/audit/lib.mjs`)_';
  const MAX = 40;
  const shown = files.slice(0, MAX).map((f) => `- \`${f}\``);
  if (files.length > MAX) shown.push(`- … i još ${files.length - MAX} (vidi matricu)`);
  return `${files.length} fajlova (vidi \`AUDIT/COVERAGE_MATRIX.csv\`, filter \`segment=${seg.id}\`):\n\n${shown.join('\n')}`;
}

function render(seg) {
  const scopeNote = seg.scope === 'process' ? 'procesni' : 'fajlovi';
  return `# ${seg.id} — ${seg.title}

| | |
|---|---|
| Sloj | \`${seg.layer}\` |
| Obim | \`${scopeNote}\` |
| Status | \`${seg.status}\` |
| Plan | [\`AUDIT/02_MASTER_AUDIT_PLAN.md\`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [\`AUDIT/COVERAGE_MATRIX.csv\`](../COVERAGE_MATRIX.csv) (filter \`segment=${seg.id}\`) |
| Živi dnevnik | [\`AUDIT/STATE.md\`](../STATE.md) |

## 1. Svrha i obim

_Šta ovaj segment provjerava i šta izričito **ne** provjerava (granica prema susjednim segmentima)._

## 2. Ulaz

**Zavisnosti (moraju biti gotove prije):** _(popuniti iz plana §6)_

**Fajlovi:**

${fileList(seg)}

**Pretpostavke:** _(šta se uzima zdravo za gotovo i šta ako ne važi)_

## 3. Kriteriji završetka (DoD)

- [ ] Svi fajlovi segmenta pregledani; status u matrici ≥ \`pregledano\`
- [ ] Svaki nalaz ima težinu, dokaz (\`fajl:linija\`) i odluku
- [ ] Popravke imaju regression test (ili zapisano zašto test nije moguć)
- [ ] \`node scripts/audit/check-coverage.mjs\` → PASS
- [ ] Relevantni lokalni testovi zeleni
- [ ] \`docs/\` ažuriran ako se ponašanje/konfiguracija mijenja (isti commit)
- [ ] \`AUDIT/STATE.md\` ažuriran; commit + push + **zelen CI** (run ID zapisan)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja / ponašanje | Dokaz (\`fajl:linija\`) | Ocjena |
|---|---|---|---|
| 1 | _(popuniti)_ | \`...:1\` | ✅ / ⚠️ / ❌ / ❓ |

## 5. Nalazi

Format: \`F-${seg.id}-NN\` — opis, težina (blokada / visoko / srednje / nisko), dokaz, odluka.

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-${seg.id}-01 | _(popuniti)_ | | | |

## 6. Popravke

_Za svaku popravku: šta se mijenja, zašto tako, koje su alternative odbačene i zašto._
_Novi alati/zavisnosti: obrazloženje ide i u \`docs/DECISIONS.md\` (D-006)._

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| _(popuniti)_ | \`...\` | |

## 8. Rizici i rollback

- **Rizik:** _(popuniti)_ → **Rollback:** _(kako se vraća stanje)_

## 9. Dokumentacija

- [ ] \`docs/\` dokument(i): _(popuniti)_
- [ ] \`docs/DECISIONS.md\` ako je odluka arhitektonska

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | _(prazno dok se ne počne)_ |
| Commit(ovi) | |
| CI run | |
| Status | \`${seg.status}\` |
`;
}

let written = 0;
let skipped = 0;
const missing = [];

fs.mkdirSync(DIR, { recursive: true });

for (const seg of segments) {
  const file = path.join(DIR, `${seg.id}.md`);
  const exists = fs.existsSync(file);
  if (check) {
    if (!exists) missing.push(seg.id);
    continue;
  }
  if (exists) { skipped += 1; continue; }
  fs.writeFileSync(file, render(seg), 'utf8');
  written += 1;
}

if (check) {
  if (missing.length) {
    console.log(`❌ Nedostaje ${missing.length} skeleta: ${missing.join(', ')}`);
    console.log('   Pokreni: node scripts/audit/scaffold-segments.mjs');
    process.exit(1);
  }
  console.log(`✅ Svih ${segments.length} segmenata ima AUDIT/segments/<ID>.md`);
  process.exit(0);
}

console.log(`Upisano: ${written}, preskočeno (postoji): ${skipped}, ukupno segmenata: ${segments.length}`);
