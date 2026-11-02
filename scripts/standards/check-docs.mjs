#!/usr/bin/env node
// STD-02 — docs guard: pokvareni relativni linkovi, baneri penzionisanih dokumenata,
// potpunost indeksa (docs/README.md i docs/_retired/INDEX.md) i zabrana linkovanja u _retired/
// (dozvoljen je samo ulaz u arhivu: `_retired/INDEX.md`).
//
//   node scripts/standards/check-docs.mjs

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, Report, finish, read, walk } from './lib.mjs';

const report = new Report(
  'Dokumentacija: linkovi, baneri, indeksi',
  'pokvaren link ili dokument koji nije u indeksu znači da neko čita lažno stanje sistema',
  'popravi putanju / dodaj dokument u indeks / dodaj baner PENZIONISANO',
);

// --- 1. linkovi u živim dokumentima (retired je zamrznut) ---
const liveDocs = [
  ...walk('docs', (f) => f.endsWith('.md') && !f.startsWith('docs/_retired/')),
  ...walk('AUDIT', (f) => f.endsWith('.md')),
  ...walk('scripts', (f) => f.endsWith('README.md')),
];

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

for (const doc of liveDocs) {
  report.bump();
  const text = read(doc);
  let m;
  while ((m = LINK_RE.exec(text)) !== null) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = decodeURI(target.split('#')[0]);
    if (!clean) continue;
    const resolved = path.resolve(ROOT, path.dirname(doc), clean);
    if (!fs.existsSync(resolved)) {
      report.violation(doc, `pokvaren link → ${target}`);
    } else if (clean.includes('_retired/') && !clean.endsWith('_retired/INDEX.md') && !doc.includes('_retired/')) {
      report.violation(doc, `živ dokument linkuje penzionisani dokument → ${target}`);
    }
  }
}

// --- 2. baneri u penzionisanim dokumentima ---
const retired = walk('docs/_retired', (f) => f.endsWith('.md'));
for (const doc of retired) {
  if (doc.endsWith('INDEX.md')) continue;
  report.bump();
  const head = read(doc).split('\n').slice(0, 15).join('\n');
  if (!/PENZIONISANO/.test(head)) report.violation(doc, 'nema baner „PENZIONISANO“ u prvih 15 linija');
}

// --- 3. indeksi su potpuni ---
const retiredIndex = read('docs/_retired/INDEX.md');
for (const doc of retired) {
  const rel = doc.replace('docs/_retired/', '');
  if (rel === 'INDEX.md') continue;
  report.bump();
  if (!retiredIndex.includes(rel)) report.violation('docs/_retired/INDEX.md', `ne pominje ${rel}`);
}

const docsReadme = read('docs/README.md');
for (const doc of walk('docs', (f) => f.endsWith('.md') && !f.startsWith('docs/_retired/'))) {
  const name = doc.replace('docs/', '');
  if (name === 'README.md') continue;
  report.bump();
  if (!docsReadme.includes(name)) report.violation('docs/README.md', `ne pominje ${name}`);
}

// --- 4. obavezni fajlovi ---
for (const required of ['AUDIT/STATE.md', 'AUDIT/COVERAGE_MATRIX.csv', 'AUDIT/02_MASTER_AUDIT_PLAN.md', 'docs/README.md']) {
  report.bump();
  if (!fs.existsSync(path.join(ROOT, required))) report.violation(required, 'obavezan fajl ne postoji');
}

finish(report);
