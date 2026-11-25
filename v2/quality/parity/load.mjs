import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadOutcomes(registryDir) {
  const outcomes = [];
  for (const name of readdirSync(registryDir).filter((file) => file.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(join(registryDir, name), "utf8"));
    const defaults = doc.edgeDefaults ?? {};
    for (const edge of doc.edges ?? []) outcomes.push(expandEdge({ ...defaults, ...edge }));
    for (const outcome of doc.outcomes ?? []) outcomes.push(outcome);
  }
  return outcomes;
}

function expandEdge(edge) {
  const covered = edge.status === "COVERED";
  return {
    id: `F7.tender.edge.${edge.edge.replaceAll(">", ".")}`,
    slice: "F7",
    source: ".cursor/docs/matrices/tenders/MATRIX.md#Statusi",
    summary: edge.edge,
    group: edge.group ?? "tender-edge-open",
    gate: "required",
    section: "Statusi",
    matrixEdge: edge.edge,
    assertion: edge.assertion ?? "unit",
    status: edge.status,
    evidence: covered
      ? [{ file: edge.file, title: edge.title, bodyIncludes: edge.bodyIncludes }]
      : [],
  };
}
