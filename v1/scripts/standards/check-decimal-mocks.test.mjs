import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./check-decimal-mocks.mjs', import.meta.url));
function run(t, source) {
  const root = mkdtempSync(path.join(tmpdir(), 'gradix-decimal-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'backend/src/example'); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'sample.spec.ts'), source);
  return spawnSync(process.execPath, [guard, `--root=${root}`], { encoding: 'utf8' });
}

test('dozvoljava stvarni Prisma Decimal i zajednički test helper', (t) => {
  const result = run(t, "import { decimal } from '../../../test/helpers/decimal';\nconst value = decimal('0.001');\n// FakeDecimal je zamijenjen\n");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('odbija ručnu FakeDecimal klasu, uključujući komentare između tokena', (t) => {
  for (const source of ['class FakeDecimal {}', 'class MockDecimal {}', 'class Fake /* x */ Decimal {}', 'class DecimalFake {}']) {
    const result = run(t, source); assert.equal(result.status, 1, source); assert.match(result.stdout, /sample\.spec\.ts/);
  }
});

test('odbija mock Decimal klasu, factory i jest.fn', (t) => {
  for (const source of ['const x = { Decimal: class Decimal {} }', 'const x = { Decimal: FakeDecimal }', 'const x = { Decimal: jest.fn() }', 'const x = { Decimal: () => ({}) }']) {
    assert.equal(run(t, source).status, 1, source);
  }
});

test('odbija direktni mock decimal.js modula i eksplicitni Decimal objekat', (t) => {
  for (const source of ["jest.mock('decimal.js', () => ({}));", 'const obj = { "Decimal": class Fake {} };', 'const obj = { Decimal: { isZero() { return true } } };']) {
    assert.equal(run(t, source).status, 1, source);
  }
});
