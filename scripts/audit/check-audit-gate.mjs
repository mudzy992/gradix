#!/usr/bin/env node
// CI-05 — audit gate: dokumentacija i stanje ne smiju biti u raskoraku sa kodom.
//
//   node scripts/audit/check-audit-gate.mjs            # gate (exit 1 na svaki problem)
//   node scripts/audit/check-audit-gate.mjs --verbose  # + detalji po provjeri
//
// `check-coverage.mjs` gleda fajlove ↔ matricu. Ovaj gate gleda **dosije o auditu**:
//   1. AUDIT/STATE.md tvrdi isti broj `done` segmenata koji stvarno stoji u segments.json
//   2. svaki segment ima izvještaj AUDIT/segments/<ID>.md s usklađenim statusom u zaglavlju
//      i zapisu izvršavanja; nema izvještaja za nepostojeći segment
//   3. svaki fajl u `done` segmentu mora biti pregledan; bez izuzetaka
//   4. svaki segment iz segments.json postoji u master planu (i plan ne obećava segmente kojih nema)
//   5. CI invarijante koje su segmenti već uveli (CI-01/CI-02/CI-03) ne smiju tiho nestati:
//      nema `pull_request` trigera, `push` ide na granu iz STATE.md, svaki job ima `if:` za `suite`
//      i `timeout-minutes`, prepoznate vanjske `uses:` akcije su pinovane na 40-znakovni SHA
//   6. svaki job iz `ci.yml` je dokumentovan u `docs/CI.md` (tabela poslova)
//
// Prototip samo čita; još nije uključen u `check:all` ni CI. Prvo treba dovršiti pregled duga i testove.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

// The strict checks depend on a complete, valid inventory. readMatrix() alone
// silently discards duplicate paths and does not detect missing/stale files.
const coverage = spawnSync(process.execPath, [path.join(ROOT, 'scripts/audit/check-coverage.mjs')], {
  cwd: ROOT, encoding: 'utf8',
});
if (coverage.status !== 0) {
  fail(`check-coverage nije prošao; strogi gate ne može vjerovati matrici:\n${coverage.stdout || coverage.stderr || coverage.error?.message || 'nepoznata greška'}`);
}

let segments = [];
try {
  segments = readSegments();
  if (!Array.isArray(segments)) throw new Error('segments mora biti niz');
} catch (e) {
  fail(`segments.json se ne može pročitati: ${e.message}`);
  segments = [];
}
let rows = new Map();
try { rows = readMatrix(); } catch (e) { fail(`matrica se ne može pročitati: ${e.message}`); }
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
for (const s of segments) {
  if (!reports.includes(s.id)) {
    fail(`segment ${s.id} nema izvještaj AUDIT/segments/${s.id}.md`);
    continue;
  }
  const report = read(path.join(SEG_DIR, `${s.id}.md`));
  if (!report.startsWith(`# ${s.id} `)) fail(`izvještaj ${s.id}: zaglavlje ne označava odgovarajući segment`);
  const header = report.split(/^## 1\. /m)[0];
  const log = report.split(/^## \d+\. Zapis izvršavanja[^\n]*$/m);
  const statusRows = (text) => [...text.matchAll(/^\|\s*Status\s*\|\s*`([^`]+)`[^\n]*\|\s*$/gm)].map((m) => m[1]);
  const headerStatuses = statusRows(header);
  const logStatuses = log.length === 2 ? statusRows(log[1]) : [];
  if (headerStatuses.length !== 1 || logStatuses.length === 0) {
    fail(`izvještaj ${s.id}: obavezni su status u zaglavlju i zapisu izvršavanja`);
  }
  if ([...headerStatuses, ...logStatuses].some((status) => status !== s.status)) {
    fail(`izvještaj ${s.id}: status nije usklađen sa segments.json (očekivano \`${s.status}\`)`);
  }
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
  // Fail closed for the documented block-style trigger format. Checking for the
  // branch anywhere in the workflow can be fooled by comments or other jobs.
  const branchLine = state?.match(/^`([^`]+)` \(remote: `([^`]+)`\)/m);
  const activeBranch = branchLine?.[1];
  if (!activeBranch) fail('AUDIT/STATE.md: ne mogu pročitati aktivnu granu');
  const onBlocks = [...ci.matchAll(/^on:\s*(?:#.*)?\n([\s\S]*?)(?=^[^\s#][^\n]*:|$(?![\s\S]))/gm)];
  if (onBlocks.length !== 1) fail('ci.yml: očekuje se jedan blok okidača `on:`');
  else {
    const onBlock = onBlocks[0][1];
    const eventNames = [...onBlock.matchAll(/^ {2}([\w-]+):/gm)].map((m) => m[1]);
    if (eventNames.length !== 2 || !eventNames.includes('push') || !eventNames.includes('workflow_dispatch')) {
      fail('ci.yml: dozvoljeni okidači su samo `push` i `workflow_dispatch`');
    }
    const pushes = [...onBlock.matchAll(/^ {2}push:\s*(?:#.*)?\n([\s\S]*?)(?=^ {2}[\w-]+:|$(?![\s\S]))/gm)];
    if (pushes.length !== 1) fail('ci.yml: očekuje se jedan push blok');
    else {
      const lines = pushes[0][1].split('\n').map((line) => line.replace(/\s+#.*$/, '')).filter((line) => line.trim());
      if (lines[0] !== '    branches:' || lines.slice(1).some((line) => !/^ {6}- (?:[A-Za-z0-9_./-]+|'[A-Za-z0-9_./-]+'|"[A-Za-z0-9_./-]+")$/.test(line))) {
        fail('ci.yml: očekuje se jednostavna push branches lista bez globova ili dodatnih filtera');
      } else {
        const branches = lines.slice(1).map((line) => line.slice(8).replace(/^['"]|['"]$/g, ''));
        const expected = new Set([activeBranch].filter(Boolean));
        if (!activeBranch || branches.length !== expected.size || branches.some((b) => !expected.has(b))) {
          fail('ci.yml: push branches moraju sadržati samo aktivnu granu iz STATE.md');
        }
      }
    }
  }

  const body = ci.slice(ci.search(/^jobs:/m));
  const jobNames = [...body.matchAll(/^ {2}([a-z][\w-]*):$/gm)].map((m) => m[1]);
  const jobSuites = {
    audit: ['audit'],
    backend: ['backend'],
    'backend-e2e': ['backend', 'e2e'],
    frontend: ['frontend'],
    'web-e2e': ['e2e'],
    docker: ['docker'],
  };
  const expectedJobs = Object.keys(jobSuites);
  if (jobNames.length !== expectedJobs.length || new Set(jobNames).size !== expectedJobs.length || expectedJobs.some((name) => !jobNames.includes(name))) {
    fail('ci.yml: lista poslova ne odgovara dokumentovanoj suite matrici');
  }
  const jobBlocks = body.split(/^ {2}(?=[a-z][\w-]*:$)/m).slice(1);
  jobNames.forEach((name, i) => {
    const block = jobBlocks[i] ?? '';
    if (!/^ {4}timeout-minutes:\s*[1-9]\d*\s*$/m.test(block)) fail(`ci.yml: job \`${name}\` nema pozitivan \`timeout-minutes\` (CI-03)`);
    const suites = jobSuites[name];
    if (!suites) return;
    const conditions = [...block.matchAll(/^ {4}if:\s*([^\n]+)$/gm)];
    const expected = `\${{ !inputs.suite || inputs.suite == 'all'${suites.map((suite) => ` || inputs.suite == '${suite}'`).join('')} }}`;
    if (conditions.length !== 1 || conditions[0][1].trim() !== expected) {
      fail(`ci.yml: job \`${name}\` nema tačnu suite selekciju (CI-02)`);
    }
  });
  if (verbose) console.log(`Jobovi: ${jobNames.join(', ')}`);

  // Refuse common alternate YAML spellings that would otherwise evade the line-based scan.
  // This is still not a YAML parser and cannot prove arbitrary workflow syntax safe.
  if (/^\s*(?:-\s+)?(?:uses\s+:|['"]uses['"]\s*:)/m.test(ci) || /^\s*-\s*\{/m.test(ci)) {
    fail('ci.yml: nepodržan format uses ključa ili inline koraka; ažuriraj provjeru');
  }
  const uses = [...ci.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((m) => m[1]);
  for (const u of uses) {
    if (u.startsWith('./')) continue;
    if (!/@[0-9a-f]{40}$/.test(u)) fail(`ci.yml: akcija nije pinovana na SHA — ${u}`);
  }
  if (verbose) console.log(`Akcije: ${uses.length} (prepoznate vanjske pinovane)`);

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
