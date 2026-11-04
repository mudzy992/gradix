// Test the draft strict gate in an isolated miniature workspace.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = path.dirname(fileURLToPath(import.meta.url));
const sha = 'a'.repeat(40);
const jobSuites = { audit: ['audit'], backend: ['backend'], 'backend-e2e': ['backend', 'e2e'], frontend: ['frontend'], 'web-e2e': ['e2e'], docker: ['docker'] };
const jobNames = Object.keys(jobSuites);
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'gradix-strict-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/audit', 'AUDIT/segments', 'docs', '.github/workflows']) mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ['lib.mjs', 'check-audit-gate.mjs']) copyFileSync(path.join(source, file), path.join(root, 'scripts/audit', file));
  const write = (file, value) => writeFileSync(path.join(root, file), value);
  write('scripts/audit/segments.json', JSON.stringify({ segments: [{ id: 'STD-01', layer: 'STD', status: 'done', scope: 'files' }] }));
  write('AUDIT/COVERAGE_MATRIX.csv', 'file,layer,module,segment,loc,status,findings,date\nexample.ts,STD,audit-tools,STD-01,1,pregledano,test,2026-11-04\n');
  write('AUDIT/STATE.md', '`arena/work` (remote: `example/repo`)\nTrenutno: **1/1 segmenata `done`**\n## Zadnji commit i CI\n');
  write('AUDIT/02_MASTER_AUDIT_PLAN.md', '**STD-01**\n');
  write('AUDIT/segments/STD-01.md', 'report\n');
  write('docs/CI.md', jobNames.map((name) => `\`${name}\``).join(' '));
  const trigger = "on:\n  push:\n    branches:\n      - main\n      - 'arena/work'\n  workflow_dispatch:\n";
  const jobs = 'jobs:\n' + jobNames.map((name) => `  ${name}:\n    if: \${{ !inputs.suite || inputs.suite == 'all'${jobSuites[name].map((suite) => ` || inputs.suite == '${suite}'`).join('')} }}\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@${sha}\n`).join('');
  write('.github/workflows/ci.yml', trigger + jobs);
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/audit/check-audit-gate.mjs')], { cwd: root, encoding: 'utf8' });
  return { write, run, trigger, jobs };
}

test('validno minijaturno stanje prolazi', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('otvoreni fajl u gotovom segmentu i pogrešan STATE brojač padaju', (t) => {
  const f = fixture(t);
  f.write('AUDIT/COVERAGE_MATRIX.csv', 'file,layer,module,segment,loc,status,findings,date\nexample.ts,STD,audit-tools,STD-01,1,u-toku,,\n');
  f.write('AUDIT/STATE.md', '`arena/work` (remote: `example/repo`)\nTrenutno: **0/1 segmenata `done`**\n');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /example\.ts: status `u-toku`/);
  assert.match(result.stdout, /STATE\.md tvrdi 0 segmenata/);
});

test('grana u komentaru ili drugdje ne zamjenjuje push filter', (t) => {
  const f = fixture(t);
  f.write('.github/workflows/ci.yml', f.trigger.replace("      - 'arena/work'", "      - 'arena/other' # 'arena/work'") + f.jobs + "# 'arena/work'\n");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /push branches moraju biti/);
});

test('glob, dodatan filter, PR i nedostajući dispatch ne prolaze', (t) => {
  const f = fixture(t);
  for (const trigger of [
    f.trigger.replace("'arena/work'", "'arena/**'"),
    f.trigger.replace('  workflow_dispatch:', '    paths:\n      - src/**\n  workflow_dispatch:'),
    f.trigger + '  pull_request:\n',
    f.trigger.replace('  workflow_dispatch:\n', ''),
  ]) {
    f.write('.github/workflows/ci.yml', trigger + f.jobs);
    const result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
  }
});

test('nedostajuća aktivna grana nije samo upozorenje', (t) => {
  const f = fixture(t);
  f.write('AUDIT/STATE.md', 'Trenutno: **1/1 segmenata `done`**\n');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ne mogu pročitati aktivnu granu/);
});

test('job bez timeouta ili nepinnovana akcija padaju', (t) => {
  const f = fixture(t);
  f.write('.github/workflows/ci.yml', f.trigger + f.jobs.replace('    timeout-minutes: 5\n', '').replace(sha, 'v4'));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /nema pozitivan `timeout-minutes`/);
  assert.match(result.stdout, /akcija nije pinovana/);
});


test('pogrešan suite, bezuslovni OR i nulti timeout ne prolaze', (t) => {
  const f = fixture(t);
  for (const jobs of [
    f.jobs.replace("inputs.suite == 'audit'", "inputs.suite == 'frontend'"),
    f.jobs.replace("inputs.suite == 'audit'", "inputs.suite == 'audit' || true"),
    f.jobs.replace("inputs.suite == 'audit'", "inputs.suite == 'a u d i t'"),
    f.jobs.replace('timeout-minutes: 5', 'timeout-minutes: 0'),
  ]) {
    f.write('.github/workflows/ci.yml', f.trigger + jobs);
    const result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
  }
});

test('nepoznat ili nedostajući posao zahtijeva ažuriranje matrice', (t) => {
  const f = fixture(t);
  f.write('.github/workflows/ci.yml', f.trigger + f.jobs.replace('  docker:', '  unlisted:'));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /lista poslova ne odgovara/);
});
