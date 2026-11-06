// Fail closed on Jest process, suite and assertion failures. The old CI
// reporter inspected assertions only, missing setup/teardown and compile errors.
import fs from 'node:fs';
import path from 'node:path';

const [file, status] = process.argv.slice(2);
function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}
if (!file || !/^(0|[1-9]\d*)$/.test(status ?? '')) fail('Nedostaju izvještaj ili status Jest procesa.');
// Preserve the process failure independently of the JSON, including when Jest
// reports all assertions green but exits nonzero. Never echo arbitrary input.
if (status !== '0') console.error(`::error::Jest proces je završio sa statusom ${status}.`);
let report;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  fail('Jest JSON izvještaj nedostaje ili je neispravan.');
}
if (!report || !Array.isArray(report.testResults) ||
    !Number.isInteger(report.numTotalTests) || !Number.isInteger(report.numPassedTests) ||
    !Number.isInteger(report.numFailedTests) || !Number.isInteger(report.numFailedTestSuites) ||
    typeof report.success !== 'boolean') fail('Jest izvještaj nema obavezne podatke.');

let passedAssertions = 0;
for (const suite of report.testResults) {
  if (!suite || typeof suite.name !== 'string' || !['passed', 'failed', 'pending'].includes(suite.status) || !Array.isArray(suite.assertionResults)) {
    fail('Jest izvještaj sadrži neispravan suite.');
  }
  for (const assertion of suite.assertionResults) {
    if (!assertion || !['passed', 'failed', 'pending', 'todo', 'disabled'].includes(assertion.status)) {
      fail('Jest izvještaj sadrži neispravan test.');
    }
    if (assertion.status === 'passed') passedAssertions += 1;
  }
  if (suite.status === 'failed') {
    // Never print arbitrary test output here: it may contain credentials or tokens.
    const name = path.relative(process.cwd(), suite.name).replace(/[\r\n]/g, '');
    const text = typeof suite.message === 'string' ? suite.message : '';
    const hint = text.includes('Exceeded timeout') ? ' (timeout)' :
      text.includes('Expected database lock wait did not occur') ? ' (lock wait)' :
        /error TS\d{4}/.test(text) ? ' (TypeScript)' : '';
    console.error(`::error file=${name}::Jest suite failed${hint}; provjeri izlaz testa.`);
  }
}
const failedAssertion = report.testResults.some((suite) => suite.assertionResults.some((test) => test.status === 'failed'));
const failedSuite = report.testResults.some((suite) => suite.status === 'failed');
console.log(`Ukupno testova: ${report.numTotalTests}; prošlo: ${report.numPassedTests}; palih testova: ${report.numFailedTests}; palih suiteova: ${report.numFailedTestSuites}.`);
if (status !== '0' || !report.success || report.numTotalTests < 1 || report.numPassedTests < 1 ||
    report.numFailedTests !== 0 || report.numFailedTestSuites !== 0 ||
    passedAssertions !== report.numPassedTests || failedAssertion || failedSuite) {
  fail('Backend E2E nije prošao; Jest status i kompletan izvještaj moraju biti uspješni.');
}
