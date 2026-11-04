import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reporter = fileURLToPath(new URL('./report-e2e.mjs', import.meta.url));
const clean = () => ({
  success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numFailedTestSuites: 0,
  testResults: [{ name: '/repo/auth.e2e-spec.ts', status: 'passed', assertionResults: [{ status: 'passed' }] }],
});
function run(t, report, status = '0') {
  const dir = mkdtempSync(path.join(tmpdir(), 'gradix-e2e-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'report.json');
  if (report !== null) writeFileSync(file, typeof report === 'string' ? report : JSON.stringify(report));
  return spawnSync(process.execPath, [reporter, file, status], { encoding: 'utf8' });
}

test('prihvata samo uspješan proces i neprazan izvještaj', (t) => {
  assert.equal(run(t, clean()).status, 0);
  assert.notEqual(run(t, clean(), '1').status, 0);
  assert.notEqual(run(t, clean(), 'invalid').status, 0);
  assert.notEqual(run(t, { ...clean(), numTotalTests: 0, numPassedTests: 0 }).status, 0);
  assert.notEqual(run(t, { ...clean(), testResults: [] }).status, 0);
  assert.notEqual(run(t, { ...clean(), numPassedTests: 2 }).status, 0);
});

test('pada kada setup/teardown ili kompajliranje obori cijeli suite bez palog testa', (t) => {
  const report = clean();
  report.success = false;
  report.numFailedTestSuites = 1;
  report.testResults[0].status = 'failed';
  report.testResults[0].message = 'Exceeded timeout';
  const result = run(t, report);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /auth\.e2e-spec\.ts.*timeout/);
});

test('pada na assertion, inkonzistentan suite i prijavljen pad', (t) => {
  const assertion = clean();
  assertion.testResults[0].assertionResults[0].status = 'failed';
  assert.notEqual(run(t, assertion).status, 0);
  const suite = clean();
  suite.testResults[0].status = 'failed';
  assert.notEqual(run(t, suite).status, 0);
  assert.notEqual(run(t, { ...clean(), success: false }).status, 0);
  assert.notEqual(run(t, { ...clean(), numFailedTests: 1 }).status, 0);
  const unknown = clean();
  unknown.testResults[0].assertionResults[0].status = 'unknown';
  assert.notEqual(run(t, unknown).status, 0);
});

test('nedostajući, oštećen ili nepotpun izvještaj odbija bez ispisa sadržaja', (t) => {
  for (const invalid of [null, '{', {}, { ...clean(), testResults: [{}] }]) {
    assert.notEqual(run(t, invalid).status, 0);
  }
  const report = clean();
  report.success = false;
  report.testResults[0].status = 'failed';
  report.testResults[0].message = 'PRIVATE-CREDENTIAL';
  const result = run(t, report);
  assert.doesNotMatch(result.stderr + result.stdout, /PRIVATE-CREDENTIAL/);
});
