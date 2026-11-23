#!/usr/bin/env node
/**
 * Application-wide coverage. Separate from tender matrix parity.
 *
 * Implemented rate = COVERED / (implemented outcomes - CI-SKIP - BLOCKED).
 * PLANNED_NOT_IMPLEMENTED is reported on the roadmap and is not in that denominator.
 * Missing implementation defaults to IMPLEMENTED. UNCLEAR stays in the implemented denominator.
 * CI-SKIP and BLOCKED stay listed and are not counted as covered.
 * A false COVERED fails. gate required + NOT_IMPLEMENTED fails.
 * priority critical + NOT_IMPLEMENTED fails even when gate is track.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "./parity/evaluate.mjs";

const v2Root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(v2Root, "..");
const registryDir = join(v2Root, "quality", "registry", "application");

const outcomes = [];
for (const name of readdirSync(registryDir).filter((file) => file.endsWith(".json"))) {
  const doc = JSON.parse(readFileSync(join(registryDir, name), "utf8"));
  for (const outcome of doc.outcomes ?? []) outcomes.push(outcome);
}

const files = new Map();
for (const outcome of outcomes) {
  for (const evidence of outcome.evidence ?? []) {
    if (files.has(evidence.file)) continue;
    files.set(evidence.file, readFileSync(join(v2Root, evidence.file), "utf8"));
  }
}

const workflow = readFileSync(join(repoRoot, ".github", "workflows", "ci-v2.yml"), "utf8");
const result = evaluate({ outcomes, files, workflow });
for (const outcome of outcomes) {
  if (outcome.priority === "critical" && outcome.status === "NOT_IMPLEMENTED") {
    result.errors.push(`${outcome.id}: critical feature has no meaningful test`);
  }
}

const KINDS = new Set(["IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED_NOT_IMPLEMENTED", "UNCLEAR"]);
for (const outcome of outcomes) {
  const kind = outcome.implementation ?? "IMPLEMENTED";
  if (!KINDS.has(kind)) result.errors.push(`${outcome.id}: unknown implementation ${kind}`);
  outcome.implementation = kind;
}
const isSkip = (row) => row.status === "CI-SKIP" || row.status === "BLOCKED";
const planned = outcomes.filter((row) => row.implementation === "PLANNED_NOT_IMPLEMENTED");
const implemented = outcomes.filter((row) => row.implementation !== "PLANNED_NOT_IMPLEMENTED");
const skipped = implemented.filter(isSkip);
const denominatorRows = implemented.filter((row) => !isSkip(row));
const coveredRows = denominatorRows.filter((row) => row.status === "COVERED");
const rate = denominatorRows.length === 0 ? 0 : coveredRows.length / denominatorRows.length;
const mixedDenom = outcomes.filter((row) => !isSkip(row));
const mixedCovered = outcomes.filter((row) => row.status === "COVERED").length;
const mixedRate = mixedDenom.length === 0 ? 0 : mixedCovered / mixedDenom.length;
const withSkips = implemented.length === 0 ? 0 : coveredRows.length / implemented.length;
const roadmapCovered = planned.filter((row) => row.status === "COVERED").length;
const gaps = denominatorRows.filter((row) => row.status !== "COVERED");
const report = {
  generatedAt: new Date().toISOString(),
  rule: "Implemented rate excludes PLANNED_NOT_IMPLEMENTED, CI-SKIP, and BLOCKED. Skips are not successes. UNCLEAR stays in the implemented denominator.",
  total: outcomes.length,
  covered: coveredRows.length,
  skipped: skipped.length,
  planned: planned.length,
  denominator: denominatorRows.length,
  rate,
  mixedDenominator: mixedDenom.length,
  mixedRate,
  rateIfSkipsStayUnverified: withSkips,
  roadmap: { covered: roadmapCovered, total: planned.length },
  gaps: gaps.map((row) => ({ id: row.id, status: row.status, implementation: row.implementation, summary: row.summary })),
  plannedItems: planned.map((row) => ({ id: row.id, status: row.status, summary: row.summary })),
  errorCount: result.errors.length,
  warningCount: result.warnings.length,
  errors: result.errors,
  warnings: result.warnings,
};
writeFileSync(join(v2Root, "quality", "application-report.json"), `${JSON.stringify(report, null, 2)}\n`);
const pct = (value) => `${(value * 100).toFixed(1)}%`;
console.log(
  `implemented coverage ${coveredRows.length}/${denominatorRows.length} (${pct(rate)}) planned=${planned.length} skipped=${skipped.length}`,
);
console.log(
  `mixed coverage ${mixedCovered}/${mixedDenom.length} (${pct(mixedRate)}); if skips stay unverified ${coveredRows.length}/${implemented.length} (${pct(withSkips)})`,
);
console.log(`roadmap coverage ${roadmapCovered}/${planned.length}`);
for (const error of result.errors) console.error(`application: ${error}`);
for (const warning of result.warnings) console.log(`application warning: ${warning}`);
console.log(`application errors=${result.errors.length} warnings=${result.warnings.length}`);
process.exit(result.errors.length > 0 ? 1 : 0);
