import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Web test runner: uz uobičajeni Vitest izlaz, ispisuje BROJ STVARNO IZVRŠENIH
 * PostgreSQL integracijskih testova (passed+failed u *.integration.test.ts), ne preskočenih.
 * Bez ovoga CI log pokazuje samo zbir web testova i ne vidi se koliko je DB testova zaista radilo.
 * U CI-ju (REQUIRE_DB_TESTS=1) pad je ako je ijedan integracijski test preskočen ili nijedan nije izvršen.
 */
const requireDbTests = process.env.REQUIRE_DB_TESTS === "1";
const reportPath = join(tmpdir(), `gradix-web-vitest-${process.pid}.json`);
const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const args = [
  vitestCli,
  "run",
  "--reporter=default",
  "--reporter=json",
  `--outputFile.json=${reportPath}`,
  ...process.argv.slice(2),
];

const exitCode = await new Promise((resolve) => {
  const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
  child.once("error", (error) => {
    console.error("Could not start Vitest:", error.message);
    resolve(1);
  });
  child.once("close", (code) => resolve(code ?? 1));
});

let report;
if (existsSync(reportPath)) {
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    console.error("Could not read Vitest JSON report:", error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(reportPath, { force: true });
  }
}

if (!report) {
  if (requireDbTests) process.exit(1);
  process.exit(exitCode);
}

const integrationSuites = (report.testResults ?? []).filter((suite) =>
  basename(suite.name ?? "").includes(".integration.test."),
);
const assertions = integrationSuites.flatMap((suite) => suite.assertionResults ?? []);
const passed = assertions.filter((test) => test.status === "passed").length;
const failed = assertions.filter((test) => test.status === "failed").length;
const skipped = assertions.filter((test) => ["skipped", "pending", "todo"].includes(test.status)).length;
const executed = passed + failed;

const summary = `PostgreSQL web integration tests: ${passed} passed, ${failed} failed, ${skipped} skipped (${executed} executed; ${assertions.length} total in ${integrationSuites.length} integration suites).`;
console.log(`\n[web-db-test-summary] ${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### PostgreSQL web integration tests\n\n${summary}\n`);
}

if (requireDbTests && (executed === 0 || skipped > 0)) {
  if (skipped > 0) console.error(`CI is configured to execute every web PostgreSQL integration test; ${skipped} were skipped.`);
  if (executed === 0) console.error("CI executed no web PostgreSQL integration tests.");
  process.exit(1);
}

process.exit(exitCode);
