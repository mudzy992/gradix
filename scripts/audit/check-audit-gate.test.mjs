// Test the draft strict gate in an isolated miniature workspace.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
  for (const file of ['lib.mjs', 'check-audit-gate.mjs', 'check-coverage.mjs']) copyFileSync(path.join(source, file), path.join(root, 'scripts/audit', file));
  const write = (file, value) => writeFileSync(path.join(root, file), value);
  write('scripts/audit/segments.json', JSON.stringify({ segments: [
    { id: 'STD-01', layer: 'STD', status: 'done', scope: 'files' },
    { id: 'CI-01', layer: 'CI', status: 'planned', scope: 'files' },
  ] }));
  write('AUDIT/STATE.md', '`arena/work` (remote: `example/repo`)\nTrenutno: **1/2 segmenata `done`**\n## Zadnji commit i CI\n');
  write('AUDIT/02_MASTER_AUDIT_PLAN.md', '**STD-01**\n**CI-01**\n');
  const report = (id, status) => `# ${id} — fixture\n\n| Status | \`${status}\` |\n\n## 1. Svrha i obim\n\n## 10. Zapis izvršavanja\n\n| Status | \`${status}\` |\n`;
  write('AUDIT/segments/STD-01.md', report('STD-01', 'done'));
  write('AUDIT/segments/CI-01.md', report('CI-01', 'planned'));
  write('docs/CI.md', jobNames.map((name) => `\`${name}\``).join(' '));
  const trigger = "on:\n  push:\n    branches:\n      - 'arena/work'\n  workflow_dispatch:\n";
  const jobs = 'jobs:\n' + jobNames.map((name) => `  ${name}:\n    if: \${{ !inputs.suite || inputs.suite == 'all'${jobSuites[name].map((suite) => ` || inputs.suite == '${suite}'`).join('')} }}\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@${sha}\n`).join('');
  write('.github/workflows/ci.yml', trigger + jobs);
  const files = [
    'scripts/audit/lib.mjs', 'scripts/audit/check-audit-gate.mjs',
    'scripts/audit/check-coverage.mjs', 'scripts/audit/segments.json', '.github/workflows/ci.yml',
  ];
  const rows = files.map((file) => {
    const ci = file.startsWith('.github/');
    const loc = readFileSync(path.join(root, file), 'utf8').split('\n').length;
    return `${file},${ci ? 'CI,ci,CI-01' : 'STD,audit-tools,STD-01'},${loc},pregledano,test,2026-11-04`;
  });
  const matrix = `file,layer,module,segment,loc,status,findings,date\n${rows.join('\n')}\n`;
  write('AUDIT/COVERAGE_MATRIX.csv', matrix);
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/audit/check-audit-gate.mjs')], { cwd: root, encoding: 'utf8' });
  return { root, write, run, trigger, jobs, matrix, report };
}

test('validno minijaturno stanje prolazi', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('otvoreni fajl u gotovom segmentu i pogrešan STATE brojač padaju', (t) => {
  const f = fixture(t);
  f.write('AUDIT/COVERAGE_MATRIX.csv', f.matrix.replace(/(scripts\/audit\/lib\.mjs,[^\n]*?),pregledano,test,2026-11-04/, '$1,u-toku,,'));
  f.write('AUDIT/STATE.md', '`arena/work` (remote: `example/repo`)\nTrenutno: **0/2 segmenata `done`**\n');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /scripts\/audit\/lib\.mjs: status `u-toku`/);
  assert.match(result.stdout, /STATE\.md tvrdi 0 segmenata/);
});

test('grana u komentaru ili drugdje ne zamjenjuje push filter', (t) => {
  const f = fixture(t);
  f.write('.github/workflows/ci.yml', f.trigger.replace("      - 'arena/work'", "      - 'arena/other' # 'arena/work'") + f.jobs + "# 'arena/work'\n");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /push branches moraju sadržati/);
});

test('glob, dodatan filter, PR i nedostajući dispatch ne prolaze', (t) => {
  const f = fixture(t);
  for (const trigger of [
    f.trigger.replace("'arena/work'", "'arena/**'"),
    f.trigger.replace("      - 'arena/work'", "      - 'arena/work'\n      - main"),
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
  f.write('AUDIT/STATE.md', 'Trenutno: **1/2 segmenata `done`**\n');
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

test('stvarni workflow poštuje provjere okidača i suite matrice bez nametanja review gatea', () => {
  const result = spawnSync(process.execPath, [path.join(source, 'check-audit-gate.mjs')], { encoding: 'utf8' });
  // Review debt is tracked separately; this test enforces only workflow invariants.
  assert.ok(result.status === 0 || result.status === 1, result.stdout + result.stderr);
  assert.match(result.stdout, /GATE: (PASS|FAIL)/);
  assert.doesNotMatch(result.stdout, /ci\.yml:/);
});


test('strogi gate odbija duplikate, nestale i izostavljene redove matrice', (t) => {
  const f = fixture(t);
  const lines = f.matrix.trimEnd().split('\n');
  for (const bad of [
    f.matrix + lines[1] + '\n',
    f.matrix + 'old.ts,STD,audit-tools,STD-01,1,pregledano,test,2026-11-04\n',
    [lines[0], ...lines.slice(2), ''].join('\n'),
    f.matrix + 'bad,row\n',
    f.matrix.replace('test,2026-11-04', 'test,"2026-11-04'),
  ]) {
    f.write('AUDIT/COVERAGE_MATRIX.csv', bad);
    const result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /check-coverage nije prošao/);
  }
});

test('neispravan segments.json ne može rezultirati zelenim gateom', (t) => {
  const f = fixture(t);
  f.write('scripts/audit/segments.json', '{}');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /segments mora biti niz/);
  assert.match(result.stdout, /GATE: FAIL/);
});


test('izvještaji moraju postojati i odražavati status registra u zaglavlju i završnom zapisu', (t) => {
  const f = fixture(t);
  const cases = [
    ['STD-01', f.report('STD-01', 'done').replace('| Status | `done` |', '| Status | `planned` |')],
    ['STD-01', f.report('STD-01', 'done').replace(/\| Status \| `done` \|\n$/, '| Status | `in-progress` |\n')],
    ['STD-01', f.report('STD-01', 'done').replace('| Status | `done` |\n', '')],
    ['STD-01', f.report('STD-01', 'done').replace('## 10. Zapis izvršavanja', '## 10. Bez zapisa')],
    ['STD-01', f.report('CI-01', 'done')],
    ['CI-01', f.report('CI-01', 'done')],
  ];
  for (const [id, report] of cases) {
    f.write('AUDIT/segments/STD-01.md', f.report('STD-01', 'done'));
    f.write('AUDIT/segments/CI-01.md', f.report('CI-01', 'planned'));
    f.write(`AUDIT/segments/${id}.md`, report);
    const result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`izvještaj ${id}:`));
  }
  rmSync(path.join(f.root, 'AUDIT/segments/CI-01.md'));
  const missing = f.run();
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /segment CI-01 nema izvještaj/);
});


test('alternativni uses ključ i inline korak se odbijaju umjesto da zaobiđu pinning', (t) => {
  const f = fixture(t);
  for (const step of ['- uses : action@v4', "- 'uses': action@v4", '- "uses": action@v4', '- { uses: action@v4 }']) {
    f.write('.github/workflows/ci.yml', f.trigger + f.jobs.replace(`- uses: actions/checkout@${sha}`, step));
    const result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /nepodržan format uses/);
  }
});
