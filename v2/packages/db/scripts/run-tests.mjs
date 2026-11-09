import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const requireDbTests = process.env.REQUIRE_DB_TESTS === "1";
if (requireDbTests && (!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)) {
  console.error("PostgreSQL integration tests are required, but DATABASE_URL or DATABASE_ADMIN_URL is missing.");
  process.exit(1);
}

const reportPath = join(tmpdir(), `gradix-db-vitest-${process.pid}.json`);
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

const assertions = (report.testResults ?? []).flatMap((suite) => suite.assertionResults ?? []);
const passed = assertions.filter((test) => test.status === "passed").length;
const failed = assertions.filter((test) => test.status === "failed").length;
const skipped = assertions.filter((test) => ["skipped", "pending", "todo"].includes(test.status)).length;
const executed = passed + failed;
const suites = new Set((report.testResults ?? []).map((suite) => basename(suite.name ?? "")));
const requiredSuites = [
  "assignment-history.integration.test.ts",
  "r4-workday.integration.test.ts",
  "scope-default-migration.test.ts",
  "sync-cursor.integration.test.ts",
  "tenant.test.ts",
];
const missingSuites = requiredSuites.filter((suite) => !suites.has(suite));

const summary = `PostgreSQL database tests: ${passed} passed, ${failed} failed, ${skipped} skipped (${executed} executed; ${assertions.length} total).`;
console.log(`\n[db-test-summary] ${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### PostgreSQL database tests\n\n${summary}\n`);
}

if (requireDbTests && (executed === 0 || skipped > 0 || missingSuites.length > 0)) {
  if (missingSuites.length > 0) {
    console.error(`Required PostgreSQL test suites were not discovered: ${missingSuites.join(", ")}`);
  }
  if (skipped > 0) console.error(`CI is configured to execute every database test; ${skipped} were skipped.`);
  if (executed === 0) console.error("CI executed no PostgreSQL database tests.");
  process.exit(1);
}

process.exit(exitCode);
