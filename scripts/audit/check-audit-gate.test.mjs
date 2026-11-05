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
  for (const file of ['lib.mjs', 'check-audit-gate.mjs', 'check-coverage.mjs', 'verify-ci-evidence.mjs']) copyFileSync(path.join(source, file), path.join(root, 'scripts/audit', file));
  const write = (file, value) => writeFileSync(path.join(root, file), value);
  write('scripts/audit/segments.json', JSON.stringify({ segments: [
    { id: 'STD-01', layer: 'STD', status: 'done', scope: 'files' },
    { id: 'CI-01', layer: 'CI', status: 'planned', scope: 'files' },
  ] }));
  write('AUDIT/STATE.md', '`arena/work` (remote: `example/repo`)\nTrenutno: **1/2 segmenata `done`**\n## Zadnji commit i CI\n');
  write('AUDIT/02_MASTER_AUDIT_PLAN.md', '**STD-01**\n**CI-01**\n');
  const report = (id, status) => `# ${id} — fixture\n\n| Status | \`${status}\` |\n${status === 'done' ? '| Potvrđeni puni CI | [12345678](https://github.com/example/repo/actions/runs/12345678) — success |\n' : ''}\n## 1. Svrha i obim\n\n## 10. Zapis izvršavanja\n\n| Status | \`${status}\` |\n`;
  write('AUDIT/segments/STD-01.md', report('STD-01', 'done'));
  write('AUDIT/segments/CI-01.md', report('CI-01', 'planned'));
  write('docs/CI.md', jobNames.map((name) => `\`${name}\``).join(' '));
  const trigger = "on:\n  push:\n    branches:\n      - 'arena/work'\n  workflow_dispatch:\n";
  const jobs = 'jobs:\n' + jobNames.map((name) => `  ${name}:\n    if: \${{ !inputs.suite || inputs.suite == 'all'${jobSuites[name].map((suite) => ` || inputs.suite == '${suite}'`).join('')} }}\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@${sha}\n`).join('');
  write('.github/workflows/ci.yml', trigger + jobs);
  const files = [
    'scripts/audit/lib.mjs', 'scripts/audit/check-audit-gate.mjs',
    'scripts/audit/check-coverage.mjs', 'scripts/audit/verify-ci-evidence.mjs', 'scripts/audit/segments.json', '.github/workflows/ci.yml',
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


test('done traži izričit dokaz uspješnog CI-ja u izvještaju, ostali segmenti ne', (t) => {
  const f = fixture(t)
  for (const ci of [
    '',
    '| Potvrđeni puni CI | 12345678 — success |\n',
    '| Potvrđeni puni CI | [12345678](https://github.com/example/repo/actions/runs/12345678) — failure |\n',
    '| Potvrđeni puni CI | [12345678](https://github.com/example/repo/actions/runs/99999999) — success |\n',
  ]) {
    const report = f.report('STD-01', 'done').replace(/^\| Potvrđeni puni CI .*\n/m, ci)
    f.write('AUDIT/segments/STD-01.md', report)
    const result = f.run()
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /izvještaj STD-01:.*CI/)
  }
  f.write('AUDIT/segments/STD-01.md', f.report('STD-01', 'done'))
  assert.equal(f.run().status, 0)
})

test('nepregledano i u-toku nisu prihvatljivi za done, ali jesu za planirani segment', (t) => {
  const f = fixture(t)
  for (const status of ['nepregledano', 'u-toku']) {
    f.write('AUDIT/COVERAGE_MATRIX.csv', f.matrix.replace(/(scripts\/audit\/lib\.mjs,[^\n]*?),pregledano,test,2026-11-04/, `$1,${status},,`))
    assert.equal(f.run().status, 1)
    f.write('AUDIT/COVERAGE_MATRIX.csv', f.matrix.replace(/(\.github\/workflows\/ci\.yml,[^\n]*?),pregledano,test,2026-11-04/, `$1,${status},,`))
    assert.equal(f.run().status, 0)
  }
})

test('CI audit posao obavezno pokreće strogi gate', () => {
  const ci = readFileSync(path.join(source, '../../.github/workflows/ci.yml'), 'utf8')
  const audit = ci.match(/^  audit:\n([\s\S]*?)(?=^  backend:\n)/m)?.[1] ?? ''
  assert.match(audit, /^      - name: Strogi audit gate\n        env:\n          GITHUB_TOKEN: \$\{\{ github\.token \}\}\n        run: node scripts\/audit\/check-audit-gate\.mjs --verify-ci$/m)
})

test('GitHub provjera odbija neuspješan ili nepotpun run i prihvata samo šest uspješnih poslova', async () => {
  const { verifyRun } = await import('./verify-ci-evidence.mjs')
  const jobs = ['Audit (guardrail + matrica pokrivenosti)', 'Backend (lint + unit + build)', 'Backend (e2e)', 'Frontend (lint + typecheck + test + build)', 'Web E2E (Playwright)', 'Docker build (Coolify gate)'].map((name) => ({ name, conclusion: 'success' }))
  const api = (run, resultJobs = jobs) => async (path) => path.endsWith('/jobs?per_page=100') ? { total_count: resultJobs.length, jobs: resultJobs } : run
  const success = { status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml' }
  await verifyRun('example/repo', '12345678', api(success))
  for (const bad of [api({ ...success, conclusion: 'failure' }), api({ ...success, status: 'in_progress' }), api({ ...success, path: '.github/workflows/drugi.yml' }), api(success, jobs.slice(1)), api(success, jobs.map((j, i) => i ? j : { ...j, conclusion: 'skipped' }))]) {
    await assert.rejects(() => verifyRun('example/repo', '12345678', bad))
  }
  await assert.rejects(() => verifyRun('example/repo', '12345678', async () => { throw new Error('API nedostupan') }))
})
