import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./report-unit.mjs', import.meta.url));
const good = () => ({ success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numFailedTestSuites: 0, testResults: [{ name: '/repo/a.spec.ts', status: 'passed', assertionResults: [{ status: 'passed', fullName: 'radi' }] }] });
function run(t, report, status = '0', cov = { total: { lines: { pct: 80 }, statements: { pct: 81 }, functions: { pct: 82 }, branches: { pct: 83 } } }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gradix-unit-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const raw = path.join(dir, 'raw.json'), coverage = path.join(dir, 'coverage.json'), baseline = path.join(dir, 'baseline.json'), out = path.join(dir, 'summary.md'), json = path.join(dir, 'summary.json'), step = path.join(dir, 'step.md');
  if (report !== null) writeFileSync(raw, typeof report === 'string' ? report : JSON.stringify(report));
  if (cov !== null) writeFileSync(coverage, JSON.stringify(cov));
  writeFileSync(baseline, JSON.stringify({ metrics: { lines: 10, statements: 11, functions: 12, branches: 13 } }));
  const result = spawnSync(process.execPath, [script, raw, status, coverage, baseline, out, json], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: step } });
  return { ...result, md: readFileSync(out, 'utf8'), json: JSON.parse(readFileSync(json, 'utf8')), step: readFileSync(step, 'utf8') };
}

test('uspješan izvještaj sadrži baseline tabelu i ide u step summary i sigurni artefakt', (t) => {
  const r = run(t, good());
  assert.equal(r.status, 0, r.stderr); assert.match(r.md, /lines.*80\.00.*10\.00/); assert.match(r.step, /Coverage/); assert.equal(r.json.success, true); assert.deepEqual(r.json.failures, []);
});

test('pad testa i suitea dobija ime, poruku, ograničen stack i anotaciju', (t) => {
  const report = good(); report.success = false; report.numFailedTests = 1; report.numPassedTests = 0; report.numFailedTestSuites = 1;
  report.testResults[0] = { name: '/repo/a.spec.ts', status: 'failed', message: 'suite failed', assertionResults: [{ status: 'failed', fullName: 'test A', failureMessages: [Array.from({length: 25}, (_, i) => `stack-${i}`).join('\n')] }] };
  const r = run(t, report, '1'); assert.equal(r.status, 1); assert.match(r.md, /test A/); assert.match(r.md, /stack-19/); assert.doesNotMatch(r.md, /stack-20/); assert.match(r.stdout + r.stderr, /::error::/);
  const setup = good(); setup.success = false; setup.numFailedTestSuites = 1; setup.testResults[0] = { name: '/repo/b.spec.ts', status: 'failed', message: 'compile failed', assertionResults: [] };
  assert.match(run(t, setup, '1').md, /compile failed/);
});

test('nedostajući ili oštećeni JSON i neuspješan proces nikad nisu uspjeh', (t) => {
  for (const input of [null, '{', {}]) { const r = run(t, input, '1', null); assert.equal(r.status, 1); assert.match(r.md, /nedostupan|neispravan/i); }
  assert.equal(run(t, good(), '1').status, 1);
  const empty = good(); empty.numTotalTests = 0; empty.numPassedTests = 0; empty.testResults = [];
  assert.equal(run(t, empty).status, 1);
});

test('poznati tokeni i tajne nisu u summary-ju, anotacijama niti JSON artefaktu', (t) => {
  const report = good(); report.success = false; report.numFailedTests = 1; report.numPassedTests = 0; report.numFailedTestSuites = 1;
  report.testResults[0] = { name: '/repo/a.spec.ts', status: 'failed', assertionResults: [{ status: 'failed', fullName: 'Authorization: Bearer secret-abc', failureMessages: ['password=secret-123\nrefreshToken: secret-456\nAuthorization: Bearer secret-abc'] }] };
  const r = run(t, report, '1'); const text = r.md + r.step + r.stdout + r.stderr + JSON.stringify(r.json);
  assert.doesNotMatch(text, /secret-(abc|123|456)/); assert.match(text, /REDACTED/);
});

test('CI uvijek objavljuje sigurnu unit dijagnostiku i pokreće reporter nakon Jest pada', () => {
  const ci = readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
  const backend = ci.match(/^  backend:\n([\s\S]*?)(?=^  backend-e2e:\n)/m)?.[1] ?? '';
  assert.match(backend, /npm run test:cov -- --passWithNoTests --json --outputFile=/);
  assert.match(backend, /node \.\.\/scripts\/audit\/report-unit\.mjs/);
  assert.match(backend, /name: Backend unit dijagnostika\n\s+if: always\(\)/);
  assert.match(ci, /scripts\/audit\/report-unit\.test\.mjs/);
});

test('uspješan rezultat i coverage dostupni su kao check-run anotacija bez raw loga', (t) => {
  const r = run(t, good());
  assert.match(r.stdout + r.stderr, /::notice::.*lines.*80\.00.*10\.00/);
});
