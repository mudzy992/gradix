// Run real inventory and scaffold in a temporary repository, never against the live audit files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = path.dirname(fileURLToPath(import.meta.url));
const header = 'file,layer,module,segment,loc,status,findings,date\n';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'gradix-inventory-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts/audit');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(path.join(root, 'AUDIT/segments'), { recursive: true });
  for (const file of ['lib.mjs', 'inventory.mjs', 'scaffold-segments.mjs']) copyFileSync(path.join(source, file), path.join(scripts, file));
  writeFileSync(path.join(scripts, 'segments.json'), JSON.stringify({ segments: [
    { id: 'STD-01', layer: 'STD', title: 'Test', status: 'in-progress', scope: 'files' },
  ] }));
  const matrix = path.join(root, 'AUDIT/COVERAGE_MATRIX.csv');
  const row = 'scripts/audit/lib.mjs,STD,audit-tools,STD-01,1,pregledano,važno,2026-11-04\n';
  writeFileSync(matrix, header + row);
  const report = path.join(root, 'AUDIT/segments/STD-01.md');
  writeFileSync(report, 'NE SMIJE BITI PREPISANO\n');
  const run = (script, ...args) => spawnSync(process.execPath, [path.join(scripts, script), ...args], { cwd: root, encoding: 'utf8' });
  return { root, matrix, row, report, run };
}

test('inventar čuva pregledane podatke i dodaje nove fajlove', (t) => {
  const f = fixture(t);
  const result = f.run('inventory.mjs');
  assert.equal(result.status, 0, result.stderr);
  const matrix = readFileSync(f.matrix, 'utf8');
  assert.match(matrix, /pregledano,važno,2026-11-04/);
  assert.match(matrix, /scripts\/audit\/inventory\.mjs/);
});

test('ne prepisuje duplikat, neispravan status, oštećen ili nepodudaran header', (t) => {
  const f = fixture(t);
  for (const input of [header + f.row + f.row, header + f.row.replace('pregledano', 'typo'), header + 'bad,row\n', header + '"open,broken\n', 'incorrect\n' + f.row]) {
    writeFileSync(f.matrix, input);
    assert.notEqual(f.run('inventory.mjs').status, 0);
    assert.equal(readFileSync(f.matrix, 'utf8'), input);
  }
});

test('ne uklanja zapis o nedostajućem fajlu automatskim osvježavanjem', (t) => {
  const f = fixture(t);
  const input = header + f.row + 'old.ts,STD,audit-tools,STD-01,3,pregledano,sačuvati,2026-11-04\n';
  writeFileSync(f.matrix, input);
  const result = f.run('inventory.mjs');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /old\.ts/);
  assert.equal(readFileSync(f.matrix, 'utf8'), input);
});

test('ne piše kada klasifikacija upućuje na nepostojeći segment', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'scripts/audit/segments.json'), JSON.stringify({ segments: [] }));
  const before = readFileSync(f.matrix, 'utf8');
  assert.notEqual(f.run('inventory.mjs').status, 0);
  assert.equal(readFileSync(f.matrix, 'utf8'), before);
});

test('statistika ne mijenja matricu', (t) => {
  const f = fixture(t);
  const before = readFileSync(f.matrix, 'utf8');
  assert.equal(f.run('inventory.mjs', '--stats').status, 0);
  assert.equal(readFileSync(f.matrix, 'utf8'), before);
});

test('scaffold nikada ne prepisuje postojeće izvještaje i odbija --force', (t) => {
  const f = fixture(t);
  const before = readFileSync(f.report, 'utf8');
  assert.equal(f.run('scaffold-segments.mjs', '--check').status, 0);
  assert.equal(f.run('scaffold-segments.mjs').status, 0);
  assert.notEqual(f.run('scaffold-segments.mjs', '--force').status, 0);
  assert.equal(readFileSync(f.report, 'utf8'), before);
});
