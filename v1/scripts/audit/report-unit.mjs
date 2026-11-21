#!/usr/bin/env node
// Turn Jest JSON into a bounded, redacted diagnostic. The raw report is not an artifact.
import fs from 'node:fs';
import path from 'node:path';

const [input, exitCode, coverageFile, baselineFile, markdownFile, jsonFile] = process.argv.slice(2);
if (!input || !/^(0|[1-9]\d*)$/.test(exitCode ?? '') || !coverageFile || !baselineFile || !markdownFile || !jsonFile) {
  console.error('::error::Nedostaju argumenti unit reportera.');
  process.exit(1);
}
const redact = (value) => String(value ?? '')
  .replace(/\x1b\[[0-9;]*m/g, '')
  .replace(/\b(Bearer)\s+[^\s,;"']+/gi, '$1 [REDACTED]')
  .replace(/\b(password|passwd|secret|access[_-]?token|refresh[_-]?token|authorization|api[_-]?key)\b(["']?\s*[:=]\s*["']?)([^\s,;"']+)/gi, '$1$2[REDACTED]')
  .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
  .replace(/\b(postgres(?:ql)?|redis|https?):\/\/[^\s/@]+:[^\s/@]+@/gi, '$1://[REDACTED]@')
  .replace(/\r/g, '')
  .slice(0, 16000);
const cleanName = (value) => redact(value).replace(/[\n\t]/g, ' ').slice(0, 500);
const safeMessage = (value) => redact(value).split('\n').slice(0, 20).map((line) => line.slice(0, 400)).join('\n');
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const report = readJson(input);
const valid = report && Array.isArray(report.testResults) && typeof report.success === 'boolean' &&
  ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numFailedTestSuites'].every((key) => Number.isInteger(report[key]) && report[key] >= 0) &&
  report.testResults.every((suite) => suite && typeof suite.name === 'string' && Array.isArray(suite.assertionResults));
const failures = [];
if (valid) {
  for (const suite of report.testResults) {
    const suiteName = cleanName(path.relative(process.cwd(), suite.name));
    const failed = suite.assertionResults.filter((assertion) => assertion?.status === 'failed');
    for (const item of failed) {
      failures.push({ suite: suiteName, test: cleanName(item.fullName || item.title || '(bez naziva)'), message: safeMessage((item.failureMessages ?? []).join('\n')) });
    }
    if (suite.status === 'failed' && !failed.length) {
      failures.push({ suite: suiteName, test: '(setup/teardown ili kompajliranje suitea)', message: safeMessage(suite.message || 'Jest nije naveo poruku.') });
    }
  }
}
const passedAssertions = valid ? report.testResults.reduce((sum, suite) => sum + suite.assertionResults.filter((item) => item?.status === 'passed').length, 0) : 0;
const ok = !!(valid && exitCode === '0' && report.success && report.numTotalTests > 0 && report.numPassedTests > 0 &&
  report.numFailedTests === 0 && report.numFailedTestSuites === 0 && failures.length === 0 && passedAssertions === report.numPassedTests);
const coverage = readJson(coverageFile)?.total;
const baseline = readJson(baselineFile)?.metrics;
const metrics = ['lines', 'statements', 'functions', 'branches'].map((name) => ({
  name, current: Number.isFinite(coverage?.[name]?.pct) ? coverage[name].pct : null,
  baseline: Number.isFinite(baseline?.[name]) ? baseline[name] : null,
}));
const result = { success: ok, processStatus: Number(exitCode), reportAvailable: !!valid, failures, coverage: metrics };
const md = ['## Backend unit dijagnostika', '', `Jest proces: ${exitCode}; rezultat: ${ok ? 'PASS' : 'FAIL'}.`,
  valid ? `Testovi: ${report.numPassedTests}/${report.numTotalTests}; pali testovi: ${report.numFailedTests}; pali suiteovi: ${report.numFailedTestSuites}.` : 'Jest JSON nedostupan ili neispravan; tačan uzrok nije poznat.', '', '### Pali testovi', ''];
if (!failures.length) md.push(ok ? 'Nema palih testova.' : 'Nema dostupnih pojedinačnih padova; provjeriti status procesa i dostupnost izvještaja.', '');
for (const failure of failures) {
  const title = `${failure.suite}: ${failure.test}`.replace(/[<>]/g, '');
  md.push(`- **${title}**`, '', '```text', failure.message.replace(/```/g, "'''"), '```', '');
}
md.push('### Coverage vs baseline', '', '| Metrika | Izmjereno | Baseline |', '|---|---:|---:|');
for (const metric of metrics) md.push(`| ${metric.name} | ${metric.current === null ? 'nedostupno' : `${metric.current.toFixed(2)}%`} | ${metric.baseline === null ? 'nedostupno' : `${metric.baseline.toFixed(2)}%`} |`);
md.push('');
const text = md.join('\n');
fs.writeFileSync(markdownFile, text, 'utf8');
fs.writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text, 'utf8');
for (const failure of failures.slice(0, 20)) {
  const message = `${failure.suite}: ${failure.test}\n${failure.message}`.slice(0, 3500).replace(/%/g, '%25').replace(/\n/g, '%0A').replace(/\r/g, '%0D');
  console.error(`::error::${message}`);
}
if (!ok && failures.length === 0) console.error(`::error::Unit test proces ${exitCode}; Jest izvještaj ${valid ? 'neuspješan ili nekonzistentan' : 'nedostupan ili neispravan'}.`);
const summary = metrics.map((metric) => `${metric.name} ${metric.current === null ? 'n/a' : metric.current.toFixed(2)} / ${metric.baseline === null ? 'n/a' : metric.baseline.toFixed(2)}`).join('; ');
console.log(`::notice::Backend unit ${ok ? 'PASS' : 'FAIL'}; coverage vs baseline: ${summary}`);
console.log(`Backend unit dijagnostika: ${ok ? 'PASS' : 'FAIL'}; pojedinačnih padova: ${failures.length}.`);
process.exit(ok ? 0 : 1);
