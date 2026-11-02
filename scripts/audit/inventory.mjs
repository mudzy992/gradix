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
  readMatrix, csvEscape, readSegments,
} from './lib.mjs';

const statsOnly = process.argv.includes('--stats');

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
    status: old?.status && STATUSES.includes(old.status) ? old.status : 'nepregledano',
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

const lines = [CSV_HEADER.join(',')];
for (const r of rows) lines.push(CSV_HEADER.map((k) => csvEscape(r[k])).join(','));
fs.writeFileSync(MATRIX_PATH, lines.join('\n') + '\n', 'utf8');
console.log(`\nUpisano: ${path.relative(ROOT, MATRIX_PATH)}`);

if (unknownSegments.size) process.exit(1);
