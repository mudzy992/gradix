#!/usr/bin/env node
// CI gate za pokrivenost audita. Exit 1 na svaki problem; ispisuje se tačno šta je problem.
//
//   node scripts/audit/check-coverage.mjs           # gate
//   node scripts/audit/check-coverage.mjs --verbose # + lista segmenata bez ijednog pregledanog fajla
//
// Provjere:
//  1. matrica postoji, header je tačan, nema duplikata
//  2. svaki izvorni fajl iz repozitorija ima red u matrici
//  3. nema redova za nepostojeće fajlove (stale matrica)
//  4. layer/module/segment se poklapaju sa klasifikacijom (drift)
//  5. status je iz dozvoljene liste; `pregledano`/`popravljeno`/`pokriveno-testom` traže `findings` + ISO `date`
//  6. svaki segment sa scope=files ima ≥1 red; svaki segment u matrici postoji u segments.json
//  7. segments.json je validan (unikatan ID, ispravan sloj, poznat status)

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, MATRIX_PATH, CSV_HEADER, STATUSES, REVIEWED, collectFiles, classify,
  readMatrix, readSegments, parseCsvLine,
} from './lib.mjs';

const verbose = process.argv.includes('--verbose');
const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// --- 7. segments.json ---
let segments = [];
try {
  segments = readSegments();
} catch (e) {
  fail(`segments.json se ne može pročitati: ${e.message}`);
}
const segById = new Map();
const VALID_SEG_STATUS = new Set(['planned', 'in-progress', 'done']);
const VALID_LAYER = new Set(['STD', 'CI', 'INF', 'BE', 'FE', 'MOB', 'TEST']);
for (const s of segments) {
  if (segById.has(s.id)) fail(`segments.json: duplikat ID ${s.id}`);
  segById.set(s.id, s);
  if (!/^(STD|CI|INF|BE|FE|MOB|TEST)-\d{2}$/.test(s.id)) fail(`segments.json: neispravan ID "${s.id}"`);
  if (!VALID_LAYER.has(s.layer)) fail(`segments.json: ${s.id} neispravan sloj "${s.layer}"`);
  if (!s.id.startsWith(`${s.layer}-`)) fail(`segments.json: ${s.id} sloj "${s.layer}" ne odgovara ID-u`);
  if (!VALID_SEG_STATUS.has(s.status)) fail(`segments.json: ${s.id} neispravan status "${s.status}"`);
  if (!['files', 'process'].includes(s.scope)) fail(`segments.json: ${s.id} neispravan scope "${s.scope}"`);
  if (s.scope === 'process' && !s.scopeReason) warn(`segments.json: ${s.id} scope=process bez scopeReason`);
}

// --- 1. matrica ---
let rows = new Map();
if (!fs.existsSync(MATRIX_PATH)) {
  fail(`nema matrice: ${path.relative(ROOT, MATRIX_PATH)} (pokreni: node scripts/audit/inventory.mjs)`);
} else {
  const firstLine = fs.readFileSync(MATRIX_PATH, 'utf8').split('\n')[0];
  const header = parseCsvLine(firstLine);
  if (header.join(',') !== CSV_HEADER.join(',')) {
    fail(`matrica: header je "${header.join(',')}", očekivano "${CSV_HEADER.join(',')}"`);
  }
  rows = readMatrix();
}

// --- 2/3. fajlovi vs matrica ---
const files = collectFiles();
const fileSet = new Set(files);
for (const f of files) if (!rows.has(f)) fail(`nije u matrici: ${f}`);
for (const f of rows.keys()) if (!fileSet.has(f)) fail(`matrica ima red za nepostojeći fajl: ${f} (pokreni inventory --write)`);

// --- 4/5. red po red ---
const byStatus = new Map(STATUSES.map((s) => [s, 0]));
const bySegment = new Map();
const byLayer = new Map();
for (const [file, row] of rows) {
  if (!fileSet.has(file)) continue;
  const cls = classify(file);
  for (const key of ['layer', 'module', 'segment']) {
    if (row[key] !== cls[key]) fail(`drift: ${file} ${key}="${row[key]}" (kod kaže "${cls[key]}") — pokreni inventory`);
  }
  if (!STATUSES.includes(row.status)) fail(`${file}: neispravan status "${row.status}"`);
  else byStatus.set(row.status, (byStatus.get(row.status) || 0) + 1);
  if (REVIEWED.has(row.status)) {
    if (!row.findings || !row.findings.trim()) fail(`${file}: status "${row.status}" bez zapisa u findings`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) fail(`${file}: status "${row.status}" bez ISO datuma (date)`);
  }
  bySegment.set(row.segment, (bySegment.get(row.segment) || 0) + 1);
  byLayer.set(row.layer, (byLayer.get(row.layer) || 0) + 1);
}

// --- 6. segmenti vs matrica ---
for (const seg of segments) {
  if (seg.scope === 'files' && !bySegment.has(seg.id)) fail(`segment ${seg.id} (scope=files) nema nijedan fajl u matrici`);
}
for (const seg of bySegment.keys()) if (!segById.has(seg)) fail(`matrica koristi nepoznat segment "${seg}"`);

// --- izvještaj ---
const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
const reviewed = [...byStatus.entries()].filter(([s]) => REVIEWED.has(s)).reduce((a, [, n]) => a + n, 0);
const pct = total ? ((reviewed / total) * 100).toFixed(1) : '0.0';

console.log('── AUDIT COVERAGE ─────────────────────────────────────────');
console.log(`Fajlova: ${total}   Pregledano: ${reviewed} (${pct} %)   Segmenata: ${segments.length}`);
console.log('Po sloju:   ' + [...byLayer.entries()].sort().map(([k, v]) => `${k}=${v}`).join('  '));
console.log('Po statusu: ' + [...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
const untouched = segments.filter((s) => s.scope === 'files' && (bySegment.get(s.id) || 0) > 0 &&
  ![...rows.values()].some((r) => r.segment === s.id && REVIEWED.has(r.status))).map((s) => s.id);
console.log(`Segmenti bez ijednog pregledanog fajla: ${untouched.length}/${segments.filter((s) => s.scope === 'files').length}`);
if (verbose && untouched.length) console.log('  ' + untouched.join(' '));

if (warnings.length) {
  console.log('\n⚠️  Upozorenja:');
  for (const w of warnings) console.log('   - ' + w);
}
if (errors.length) {
  console.log(`\n❌ ${errors.length} problem(a):`);
  for (const e of errors.slice(0, 50)) console.log('   - ' + e);
  if (errors.length > 50) console.log(`   … i još ${errors.length - 50}`);
  console.log('\nGATE: FAIL');
  process.exit(1);
}
console.log('\nGATE: PASS');
