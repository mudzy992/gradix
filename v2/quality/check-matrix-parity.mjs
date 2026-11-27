#!/usr/bin/env node
/**
 * Matrix parity. Required NOT_IMPLEMENTED and false COVERED fail the process.
 * --self-test proves those failures on fixtures. The live registry is then checked.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "./parity/evaluate.mjs";
import { loadOutcomes } from "./parity/load.mjs";
import { runSelfTest } from "./parity/self-test.mjs";
import { parseTenderMatrix } from "./parity/tender-matrix.mjs";

const v2Root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(v2Root, "..");

const selfTestOnly = process.argv.includes("--self-test");
const selfCode = runSelfTest(parseTenderMatrix);
if (selfTestOnly) process.exit(selfCode);
if (selfCode !== 0) process.exit(selfCode);

const outcomes = loadOutcomes(join(v2Root, "quality", "registry"));
const files = new Map();
for (const outcome of outcomes) {
  for (const evidence of outcome.evidence ?? []) {
    if (files.has(evidence.file)) continue;
    files.set(evidence.file, readFileSync(join(v2Root, evidence.file), "utf8"));
  }
}
const matrix = parseTenderMatrix(
  readFileSync(join(repoRoot, ".cursor", "docs", "matrices", "tenders", "MATRIX.md"), "utf8"),
);
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "ci-v2.yml"), "utf8");
const result = evaluate({ outcomes, files, matrix, workflow });
const report = {
  generatedAt: new Date().toISOString(),
  errorCount: result.errors.length,
  warningCount: result.warnings.length,
  errors: result.errors,
  warnings: result.warnings,
};
writeFileSync(join(v2Root, "quality", "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const error of result.errors) console.error(`parity: ${error}`);
for (const warning of result.warnings) console.log(`parity warning: ${warning}`);
console.log(`parity errors=${result.errors.length} warnings=${result.warnings.length}`);
process.exit(result.errors.length > 0 ? 1 : 0);
