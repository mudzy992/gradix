import { evaluate } from "./evaluate.mjs";

const MATRIX = `
## Statusi

| From | To |
|---|---|
| OPPORTUNITY | GO_NO_GO, CANCELLED |
| WON | (terminal) |

## Polja
## Prilozi
## Obligations × TENDER
## Convert WON
## Kalkulacija × revizije
## Dozvole
## Ishod i uspješnost
## Partneri (R7.1)
`;

const unit = `
it("allows", () => {
  expect(true).not.toThrow();
});
`;

const heading = `
test("opens", async ({ page }) => {
  expect(res.status < 400).toBeTruthy();
  await expectHeading(page, "Tenderi");
});
`;

export function runSelfTest(parseTenderMatrix) {
  const failures = [];
  const matrix = shrink(parseTenderMatrix(MATRIX));
  const good = base(matrix);
  good.outcomes.push(covered("F7.tender.edge.OPPORTUNITY.GO_NO_GO", "OPPORTUNITY>GO_NO_GO", "allow"));
  good.outcomes.push(covered("F7.tender.edge.OPPORTUNITY.CANCELLED", "OPPORTUNITY>CANCELLED", "allow"));
  good.outcomes.push(terminal("WON>terminal"));
  good.files.set("unit.test.ts", unit);
  fillSections(good);
  expectFail(failures, "missing required edge is an error", () => {
    const input = base(matrix);
    fillSections(input);
    return evaluate(input);
  });
  expectOk(failures, "complete required set passes", evaluate(good));
  expectFail(failures, "false COVERED title fails", () => {
    const input = structuredCloneSafe(good);
    input.outcomes[0].evidence[0].title = "missing";
    input.files = good.files;
    return evaluate(input);
  });
  expectFail(failures, "heading and status < 400 are not coverage", () => {
    const input = structuredCloneSafe(good);
    input.files = new Map(good.files);
    input.files.set("e2e.spec.ts", heading);
    input.outcomes.push({
      id: "weak",
      status: "COVERED",
      gate: "required",
      group: "other",
      assertion: "ui-entity",
      section: "Polja",
      evidence: [{ file: "e2e.spec.ts", title: "opens", bodyIncludes: ["expectHeading"] }],
    });
    return evaluate(input);
  });
  expectFail(failures, "CI-SKIP without owner fails", () => {
    const input = structuredCloneSafe(good);
    input.files = good.files;
    input.outcomes.push({ id: "skip", status: "CI-SKIP", gate: "required", section: "Prilozi" });
    return evaluate(input);
  });
  expectFail(failures, "swallowed playwright install fails", () => {
    const input = structuredCloneSafe(good);
    input.files = good.files;
    input.workflow = "branches: [v2-bootstrap]\nplaywright install chromium || echo kept";
    return evaluate(input);
  });
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    return 1;
  }
  console.log("matrix parity self-test: pass");
  return 0;
}

function shrink(matrix) {
  return {
    ...matrix,
    edges: ["OPPORTUNITY>GO_NO_GO", "OPPORTUNITY>CANCELLED", "WON>terminal"],
    sections: matrix.sections,
  };
}

function base(matrix) {
  return {
    outcomes: [],
    files: new Map(),
    matrix,
    workflow: "branches: [v2-bootstrap]\nplaywright install --with-deps chromium\n",
  };
}

function covered(id, edge, group) {
  return {
    id,
    status: "COVERED",
    gate: "required",
    group,
    section: "Statusi",
    matrixEdge: edge,
    assertion: "unit",
    evidence: [{ file: "unit.test.ts", title: "allows", bodyIncludes: ["expect("] }],
  };
}

function terminal(edge) {
  return {
    id: `edge-${edge}`,
    status: "CI-SKIP",
    gate: "required",
    section: "Statusi",
    matrixEdge: edge,
    owner: "self-test",
    review: "fixture only",
  };
}

function fillSections(input) {
  for (const section of input.matrix.sections) {
    input.outcomes.push({
      id: `section-${section}`,
      status: "CI-SKIP",
      gate: "required",
      section,
      owner: "self-test",
      review: "fixture only",
    });
  }
}

function expectFail(failures, name, run) {
  const result = run();
  if (result.errors.length === 0) failures.push(`self-test did not fail: ${name}`);
}

function expectOk(failures, name, result) {
  if (result.errors.length > 0) failures.push(`self-test ${name}: ${result.errors.join("; ")}`);
}

function structuredCloneSafe(input) {
  return {
    outcomes: JSON.parse(JSON.stringify(input.outcomes)),
    files: input.files,
    matrix: input.matrix,
    workflow: input.workflow,
  };
}
