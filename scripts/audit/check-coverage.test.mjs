// CI-05 regression tests: run the real checker in an isolated miniature workspace.
// Node built-ins only; no dependency on or writes to the real audit matrix.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const source = path.dirname(fileURLToPath(import.meta.url));

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'gradix-audit-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts/audit');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(path.join(root, 'AUDIT'));
  for (const file of ['lib.mjs', 'check-coverage.mjs']) copyFileSync(path.join(source, file), path.join(scripts, file));
  writeFileSync(path.join(scripts, 'segments.json'), JSON.stringify({ segments: [
    { id: 'STD-01', layer: 'STD', status: 'in-progress', scope: 'files' },
  ] }));
  const lib = await import(pathToFileURL(path.join(scripts, 'lib.mjs')).href);
  const header = lib.CSV_HEADER.join(',');
  const lines = lib.collectFiles().map((file) => {
    const { layer, module, segment } = lib.classify(file);
    return [file, layer, module, segment, lib.countLoc(file), 'nepregledano', '', ''].map(lib.csvEscape).join(',');
  });
  const matrix = path.join(root, 'AUDIT/COVERAGE_MATRIX.csv');
  writeFileSync(matrix, [header, ...lines, ''].join('\n'));
  function run() {
    return spawnSync(process.execPath, [path.join(scripts, 'check-coverage.mjs')], { cwd: root, encoding: 'utf8' });
  }
  return { root, matrix, lines, run };
}

test('valid matrix passes, duplicate file path fails instead of silently overwriting', async (t) => {
  const f = await fixture(t);
  assert.equal(f.run().status, 0);
  writeFileSync(f.matrix, readFileSync(f.matrix, 'utf8') + `${f.lines[0]}\n`);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /duplikat fajla/);
});

test('malformed row and missing file path fail explicitly', async (t) => {
  const f = await fixture(t);
  writeFileSync(f.matrix, readFileSync(f.matrix, 'utf8') + 'bad,row\n,STD,audit-tools,STD-01,1,nepregledano,,\n');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /2 kolona/);
  assert.match(result.stdout, /nema putanju fajla/);
});

test('missing, stale and changed source files fail the gate', async (t) => {
  const f = await fixture(t);
  const original = readFileSync(f.matrix, 'utf8');
  mkdirSync(path.join(f.root, 'frontend/src'), { recursive: true });
  writeFileSync(path.join(f.root, 'frontend/src/index.css'), 'new\n');
  let result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /nije u matrici: frontend\/src\/index\.css/);
  writeFileSync(f.matrix, original + 'missing.ts,STD,audit-tools,STD-01,1,nepregledano,,\n');
  result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /red za nepostojeći fajl: missing\.ts/);
  writeFileSync(path.join(f.root, 'scripts/audit/lib.mjs'), '\n', { flag: 'a' });
  result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /drift: scripts\/audit\/lib\.mjs loc=/);
});

test('CSV citiranje je validno čak i kad oštećeni red ima tačno osam kolona', async (t) => {
  const f = await fixture(t);
  const original = readFileSync(f.matrix, 'utf8');
  const first = f.lines[0];
  const valid = first.replace(',nepregledano,,', ',pregledano,"nalaz, sa ""navodnicima""",2026-11-04');
  writeFileSync(f.matrix, original.replace(first, valid));
  assert.equal(f.run().status, 0);
  for (const broken of [
    valid.replace('2026-11-04', '"2026-11-04'), // unclosed last cell; still eight parsed columns
    valid.replace('2026-11-04', '20"26"-11-04'), // quote inside an unquoted field
    valid.replace('"nalaz, sa ""navodnicima"""', '"nalaz, sa ""navodnicima"""x'), // text after closing quote
  ]) {
    writeFileSync(f.matrix, original.replace(first, broken));
    const result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /neispravno CSV citiranje/);
  }
});
