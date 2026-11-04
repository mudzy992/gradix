#!/usr/bin/env node
// CI-05 — audit gate: dokumentacija i stanje ne smiju biti u raskoraku sa kodom.
//
//   node scripts/audit/check-audit-gate.mjs            # gate (exit 1 na svaki problem)
//   node scripts/audit/check-audit-gate.mjs --verbose  # + detalji po provjeri
//
// `check-coverage.mjs` gleda fajlove ↔ matricu. Ovaj gate gleda **dosije o auditu**:
//   1. AUDIT/STATE.md tvrdi isti broj `done` segmenata koji stvarno stoji u segments.json
//   2. svaki `done` segment ima svoj izvještaj AUDIT/segments/<ID>.md (i obratno: nema izvještaja za
//      segment koji ne postoji / nije `done`, osim ako je eksplicitno `planned`+izvještaj)
//   3. svaki fajl u `done` segmentu mora biti pregledan; bez izuzetaka
//   4. svaki segment iz segments.json postoji u master planu (i plan ne obećava segmente kojih nema)
//   5. CI invarijante koje su segmenti već uveli (CI-01/CI-02/CI-03) ne smiju tiho nestati:
//      nema `pull_request` trigera, `push` ide na granu iz STATE.md, svaki job ima `if:` za `suite`
//      i `timeout-minutes`, svaki `uses:` je pinovan na 40-znakovni SHA
//   6. svaki job iz `ci.yml` je dokumentovan u `docs/CI.md` (tabela poslova)
//
// Prototip samo čita; još nije uključen u `check:all` ni CI. Prvo treba dovršiti pregled duga i testove.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PLAN_PATH, readMatrix, readSegments, REVIEWED } from './lib.mjs';

const verbose = process.argv.includes('--verbose');
const CI_PATH = path.join(ROOT, '.github/workflows/ci.yml');
const STATE_PATH = path.join(ROOT, 'AUDIT/STATE.md');
const SEG_DIR = path.join(ROOT, 'AUDIT/segments');
const CI_DOC_PATH = path.join(ROOT, 'docs/CI.md');

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

let segments = [];
try {
  segments = readSegments();
} catch (e) {
  fail(`segments.json se ne može pročitati: ${e.message}`);
}
const rows = readMatrix();
const done = segments.filter((s) => s.status === 'done');
const planned = segments.filter((s) => s.status !== 'done');

// --- 1. STATE.md tvrdi tačan broj -------------------------------------------------------------
const state = read(STATE_PATH);
if (state === null) {
  fail('nema AUDIT/STATE.md');
} else {
  const m = state.match(/Trenutno:\s*\*\*(\d+)\/(\d+)\s+segmenata\s+`done`\*\*/);
  if (!m) {
    fail('AUDIT/STATE.md: nema rečenicu „Trenutno: **N/59 segmenata `done`**“ (živi brojač je obavezan)');
  } else {
    const [, n, total] = m;
    if (Number(n) !== done.length) {
      fail(`AUDIT/STATE.md tvrdi ${n} segmenata \`done\`, segments.json ima ${done.length} — uskladi (docs u raskoraku)`);
    }
    if (Number(total) !== segments.length) {
      fail(`AUDIT/STATE.md tvrdi /${total}, segments.json ima ${segments.length} segmenata`);
    }
  }
  if (!state.includes('## Zadnji commit i CI')) warn('AUDIT/STATE.md: nema sekciju „Zadnji commit i CI“');
}

// --- 2. izvještaj po segmentu -----------------------------------------------------------------
const reports = fs.existsSync(SEG_DIR)
  ? fs.readdirSync(SEG_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  : [];
const segIds = new Set(segments.map((s) => s.id));
for (const s of done) {
  if (!reports.includes(s.id)) fail(`segment ${s.id} je \`done\` ali nema izvještaj AUDIT/segments/${s.id}.md`);
}
for (const id of reports) {
  if (!segIds.has(id)) fail(`AUDIT/segments/${id}.md postoji, ali segment ${id} nije u segments.json`);
  // (skeleton izvještaj za svih 59 segmenata je pravilo, ne problem)
}

// --- 3. done segment vs matrica ---------------------------------------------------------------
const bySeg = new Map();
for (const [file, row] of rows) {
  const acc = bySeg.get(row.segment) ?? [];
  acc.push({ file, status: row.status });
  bySeg.set(row.segment, acc);
}
for (const s of done) {
  const entries = bySeg.get(s.id) ?? [];
  if (s.scope === 'files' && entries.length === 0) fail(`segment ${s.id} je \`done\` ali nema red u matrici`);
  for (const entry of entries) {
    if (!REVIEWED.has(entry.status)) fail(`${entry.file}: status \`${entry.status}\` u segmentu ${s.id} koji je \`done\``);
  }
}

// --- 4. segments.json ↔ master plan -----------------------------------------------------------
const plan = read(PLAN_PATH);
if (plan === null) {
  fail('nema AUDIT/02_MASTER_AUDIT_PLAN.md');
} else {
  const planIds = new Set(plan.match(/\*\*(STD|CI|INF|BE|FE|MOB|TEST)-\d{2}\*\*/g)?.map((s) => s.replace(/\*/g, '')) ?? []);
  for (const s of segments) if (!planIds.has(s.id)) fail(`segment ${s.id} nije u master planu`);
  for (const id of planIds) if (!segIds.has(id)) fail(`master plan pominje ${id}, a segments.json ga nema`);
  if (verbose) console.log(`Plan: ${planIds.size} ID-eva, segments.json: ${segments.length}`);
}

// --- 5. CI invarijante ------------------------------------------------------------------------
const ci = read(CI_PATH);
if (ci === null) {
  fail('nema .github/workflows/ci.yml');
} else {
  if (/^\s{2}pull_request:/m.test(ci)) fail('ci.yml: vraćen `pull_request` trigger (CI-01 ga zabranjuje)');

  const branchLine = state?.match(/^`([^`]+)` \(remote: `([^`]+)`\)/m);
  const activeBranch = branchLine?.[1];
  if (!activeBranch) warn('AUDIT/STATE.md: ne mogu pročitati aktivnu granu (red „`grana` (remote: …)“)');
  else if (!ci.includes(`'${activeBranch}'`) && !ci.includes(`"${activeBranch}"`)) {
    fail(`ci.yml: \`push\` filter ne sadrži aktivnu granu \`${activeBranch}\` iz STATE.md (CI-01)`);
  }

  const body = ci.slice(ci.search(/^jobs:/m));
  const jobNames = [...body.matchAll(/^ {2}([a-z][\w-]*):$/gm)].map((m) => m[1]);
  if (jobNames.length < 6) fail(`ci.yml: pronađeno samo ${jobNames.length} poslova (očekivano ≥ 6)`);
  const jobBlocks = body.split(/^ {2}(?=[a-z][\w-]*:$)/m).slice(1);
  jobNames.forEach((name, i) => {
    const block = jobBlocks[i] ?? '';
    if (!/^\s{4}timeout-minutes:\s*\d+/m.test(block)) fail(`ci.yml: job \`${name}\` nema \`timeout-minutes\` (CI-03)`);
    if (!/^\s{4}if:\s*\$\{\{\s*!inputs\.suite/m.test(block)) {
      fail(`ci.yml: job \`${name}\` nema \`if:\` koji poštuje \`inputs.suite\` (CI-02)`);
    }
  });
  if (verbose) console.log(`Jobovi: ${jobNames.join(', ')}`);

  const uses = [...ci.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((m) => m[1]);
  for (const u of uses) {
    if (u.startsWith('./')) continue;
    if (!/@[0-9a-f]{40}$/.test(u)) fail(`ci.yml: akcija nije pinovana na SHA — ${u}`);
  }
  if (verbose) console.log(`Akcije: ${uses.length} (sve pinovane)`);

  // --- 6. dokumentacija poslova ---
  const ciDoc = read(CI_DOC_PATH);
  if (ciDoc === null) fail('nema docs/CI.md');
  else for (const name of jobNames) {
    if (!ciDoc.includes(`\`${name}\``)) fail(`docs/CI.md ne pominje job \`${name}\` iz ci.yml (docs u raskoraku)`);
  }
}

// --- izvještaj ---------------------------------------------------------------------------------
console.log('── AUDIT GATE (CI-05) ─────────────────────────────────────');
console.log(`Segmenti: ${segments.length}   done: ${done.length}   ostalo: ${planned.length}`);
console.log(`Izvještaji: ${reports.length} u AUDIT/segments/`);
console.log(`Matrica: ${rows.size} redova, otvorenih (nepregledano): ${[...rows.values()].filter((r) => r.status === 'nepregledano').length}`);

if (warnings.length) {
  console.log('\n⚠️  Upozorenja:');
  for (const w of warnings) console.log('   - ' + w);
}
if (errors.length) {
  console.log(`\n❌ ${errors.length} problem(a):`);
  for (const e of errors) console.log('   - ' + e);
  console.log('\nGATE: FAIL');
  process.exit(1);
}
console.log('\nGATE: PASS');
