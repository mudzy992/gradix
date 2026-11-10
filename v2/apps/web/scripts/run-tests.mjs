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

// Padajući testovi idu i kao anotacije: logovi runa nisu uvijek dostupni svim klijentima,
// a bez imena testa CI crvenilo ne govori ništa (isti razlog kao prisma korak u workflowu).
for (const suite of report.testResults ?? []) {
  // Pad u beforeAll/afterAll ne pripada ni jednom testu — bez ovoga anotacija ne postoji
  // i CI kaže samo "test je pao", bez ijednog imena ili poruke.
  if (suite.status === "failed" && !(suite.assertionResults ?? []).some((t) => t.status === "failed")) {
    const cleanSuite = (value) => String(value ?? "").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, " ");
    const suiteMessage = String(suite.message ?? "suite failed").split("\n").slice(0, 3).join(" | ").slice(0, 900);
    console.log(`::error title=web test suite failed: ${cleanSuite(basename(suite.name ?? "unknown"))}::${cleanSuite(suiteMessage)}`);
  }
  for (const test of suite.assertionResults ?? []) {
    if (test.status !== "failed") continue;
    const message = String(test.failureMessages?.[0] ?? "failed").split("\n").slice(0, 3).join(" | ").slice(0, 900);
    const clean = (value) => value.replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, " ");
    console.log(`::error title=web test failed: ${clean(test.fullName ?? test.title ?? "unknown")}::${clean(message)}`);
  }
}

// Imenovani padovi u fajl koji CI diže kao artefakt: turbo prefiksira izlaz paketa, pa
// `::error::` linije iz ovog procesa GitHub ne pretvara u anotacije.
const failureLines = [];
for (const suite of report.testResults ?? []) {
  if (suite.status === "failed" && !(suite.assertionResults ?? []).some((t) => t.status === "failed")) {
    failureLines.push(`SUITE ${basename(suite.name ?? "unknown")}: ${String(suite.message ?? "").slice(0, 2000)}`);
  }
  for (const test of suite.assertionResults ?? []) {
    if (test.status === "failed") {
      failureLines.push(`TEST ${test.fullName ?? test.title}: ${String(test.failureMessages?.[0] ?? "").slice(0, 2000)}`);
    }
  }
}
if (failureLines.length > 0) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(process.cwd(), "web-test-failures.txt"), failureLines.join("\n\n"));
}

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
