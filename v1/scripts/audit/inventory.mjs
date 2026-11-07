#!/usr/bin/env node
// Generiše / osvježava AUDIT/COVERAGE_MATRIX.csv iz stvarnog stanja repozitorija.
//
//   node scripts/audit/inventory.mjs           # dodaje nove fajlove, čuva postojeće statuse
//   node scripts/audit/inventory.mjs --stats   # samo statistika (ne piše ništa)
//
// Postojeći redovi se NIKAD ne prepisuju (status/findings/date ostaju netaknuti);
// mijenjaju se samo `layer`, `module`, `segment` i `loc` ako su se kod/klasifikacija promijenili.

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, MATRIX_PATH, CSV_HEADER, STATUSES, collectFiles, classify, countLoc,
  readMatrix, csvEscape, readSegments, parseCsvLine, isValidCsvLine,
} from './lib.mjs';

const statsOnly = process.argv.includes('--stats');

// Validate before readMatrix's Map can overwrite duplicates or discard malformed rows.
if (fs.existsSync(MATRIX_PATH)) {
  const lines = fs.readFileSync(MATRIX_PATH, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const errors = [];
  if (!isValidCsvLine(lines[0]) || parseCsvLine(lines[0]).join(',') !== CSV_HEADER.join(',')) errors.push('neispravan header');
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!isValidCsvLine(line) || cells.length !== CSV_HEADER.length) { errors.push(`neispravan red ${i + 1}`); continue; }
    if (!cells[0]?.trim()) errors.push(`prazna putanja u redu ${i + 1}`);
    else if (seen.has(cells[0])) errors.push(`duplikat ${cells[0]}`);
    else seen.add(cells[0]);
    if (!STATUSES.includes(cells[5])) errors.push(`neispravan status u redu ${i + 1}`);
  }
  if (errors.length) {
    console.error('❌ Inventar nije upisan; matrica ima greške:', errors.join('; '));
    process.exit(1);
  }
}
const files = collectFiles();
const previous = readMatrix();
const segments = new Set(readSegments().map((s) => s.id));

const rows = [];
const unknownSegments = new Set();
const bySegment = new Map();
const byLayer = new Map();

for (const file of files) {
  const { layer, module, segment } = classify(file);
  if (segment !== 'UNASSIGNED' && !segments.has(segment)) unknownSegments.add(`${file} → ${segment}`);
  const old = previous.get(file);
  rows.push({
    file,
    layer,
    module,
    segment,
    loc: countLoc(file),
    status: old?.status ?? 'nepregledano',
    findings: old?.findings ?? '',
    date: old?.date ?? '',
  });
  bySegment.set(segment, (bySegment.get(segment) || 0) + 1);
  byLayer.set(layer, (byLayer.get(layer) || 0) + 1);
}

const added = rows.filter((r) => !previous.has(r.file)).length;
const removed = [...previous.keys()].filter((f) => !files.includes(f)).length;

console.log(`Fajlova u inventaru: ${rows.length} (novih: ${added}, uklonjenih: ${removed})`);
console.log('Po sloju: ' + [...byLayer.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' '));

const bySeg = [...bySegment.entries()].sort();
console.log('\nPo segmentu:');
for (const [seg, n] of bySeg) {
  const mark = segments.has(seg) ? '' : '  ← NIJE U segments.json';
  console.log(`  ${seg.padEnd(11)} ${String(n).padStart(3)}${mark}`);
}

const emptySegments = [...segments].filter((s) => !bySegment.has(s));
if (emptySegments.length) console.log(`\nSegmenti bez fajlova: ${emptySegments.join(', ')}`);
if (unknownSegments.size) {
  console.log(`\n❌ Nepoznati segmenti (${unknownSegments.size}):`);
  for (const u of unknownSegments) console.log('   ' + u);
}

if (statsOnly) process.exit(0);
if (removed > 0 || unknownSegments.size > 0) {
  console.error('❌ Inventar nije upisan: pregledaj i arhiviraj postojeće nalaze za uklonjene fajlove ili popravi klasifikaciju.');
  for (const file of previous.keys()) if (!files.includes(file)) console.error(`   - ${file}`);
  process.exit(1);
}

const lines = [CSV_HEADER.join(',')];
for (const r of rows) lines.push(CSV_HEADER.map((k) => csvEscape(r[k])).join(','));
// Write alongside the matrix and replace atomically only after a complete write.
const temporary = `${MATRIX_PATH}.tmp-${process.pid}`;
let temporaryCreated = false;
try {
  const fd = fs.openSync(temporary, 'wx');
  temporaryCreated = true;
  try {
    fs.writeFileSync(fd, lines.join('\n') + '\n', 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, MATRIX_PATH);
  temporaryCreated = false;
} finally {
  if (temporaryCreated && fs.existsSync(temporary)) fs.unlinkSync(temporary);
}
console.log(`\nUpisano: ${path.relative(ROOT, MATRIX_PATH)}`);
