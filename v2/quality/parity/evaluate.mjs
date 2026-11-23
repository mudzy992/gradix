/** Honest coverage rules. A heading or `status < 400` is not persistence. */

const STATUSES = new Set(["COVERED", "CI-SKIP", "BLOCKED", "NOT_IMPLEMENTED"]);

export function evaluate(input) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const testGroups = new Map();
  for (const outcome of input.outcomes) {
    if (seen.has(outcome.id)) errors.push(`duplicate outcome ${outcome.id}`);
    seen.add(outcome.id);
    if (!STATUSES.has(outcome.status)) errors.push(`${outcome.id}: unknown status ${outcome.status}`);
    if (outcome.section?.includes("Van obima")) {
      errors.push(`${outcome.id}: out-of-scope section cannot be an outcome`);
    }
    if (outcome.status === "CI-SKIP") {
      if (!outcome.owner || !outcome.review) errors.push(`${outcome.id}: CI-SKIP needs owner and review`);
      continue;
    }
    if (outcome.status === "BLOCKED") {
      if (!outcome.reason) errors.push(`${outcome.id}: BLOCKED needs a reason`);
      if (outcome.gate === "required") errors.push(`${outcome.id}: BLOCKED is not coverage`);
      continue;
    }
    if (outcome.status === "NOT_IMPLEMENTED") {
      const line = `${outcome.id}: NOT_IMPLEMENTED (${outcome.summary ?? outcome.matrixEdge ?? ""})`;
      if (outcome.gate === "required") errors.push(line);
      else warnings.push(line);
      continue;
    }
    checkCovered(outcome, input, errors, testGroups);
  }
  for (const [key, groups] of testGroups) {
    if (groups.size > 1) errors.push(`test ${key} cannot cover unrelated groups: ${[...groups].join(", ")}`);
  }
  checkMatrix(input, errors);
  checkWorkflow(input.workflow, errors);
  return { errors, warnings };
}

function checkCovered(outcome, input, errors, testGroups) {
  if (!outcome.evidence?.length) {
    errors.push(`${outcome.id}: COVERED without evidence`);
    return;
  }
  for (const evidence of outcome.evidence) {
    const source = input.files.get(evidence.file);
    if (source == null) {
      errors.push(`${outcome.id}: missing file ${evidence.file}`);
      continue;
    }
    const body = evidence.title ? testBody(source, evidence.title) : { found: true, skipped: false, body: source };
    if (!body.found) errors.push(`${outcome.id}: title not found in ${evidence.file}`);
    if (body.skipped) errors.push(`${outcome.id}: skipped test is not coverage`);
    for (const token of evidence.bodyIncludes ?? []) {
      if (!body.body.includes(token)) errors.push(`${outcome.id}: evidence missing ${JSON.stringify(token)}`);
    }
    assertShape(outcome, evidence, body.body, input.workflow ?? "", errors);
    if (evidence.title) {
      const key = `${evidence.file}::${evidence.title}`;
      const groups = testGroups.get(key) ?? new Set();
      groups.add(outcome.group);
      testGroups.set(key, groups);
    }
  }
}

function assertShape(outcome, evidence, body, workflow, errors) {
  const id = outcome.id;
  if (outcome.assertion === "unit") {
    const integration = evidence.file.includes(".integration.");
    if (!evidence.file.endsWith(".test.ts") || integration) {
      errors.push(`${id}: unit evidence must be a non-integration .test.ts`);
    }
    if (!body.includes("expect(")) errors.push(`${id}: unit evidence has no expect(`);
  }
  if (outcome.assertion === "integration") {
    if (!evidence.file.includes(".integration.test.ts")) errors.push(`${id}: integration path required`);
    if (!/expect\(|expectAdminFailure\(/.test(body)) {
      errors.push(`${id}: integration evidence has no expect`);
    }
  }
  if (outcome.assertion === "persistence") {
    if (!/SELECT|client\.query|pool\.query|countProjects/.test(body)) {
      errors.push(`${id}: persistence evidence does not read the database`);
    }
  }
  if (outcome.assertion === "ui-entity") {
    if (!body.includes("getByText(")) errors.push(`${id}: UI evidence does not bind a created entity`);
  }
  if (outcome.assertion === "grant-matrix") {
    for (const token of evidence.workflowIncludes ?? []) {
      if (!workflow.includes(token)) errors.push(`${id}: workflow missing ${token}`);
    }
  }
  if (outcome.assertion === "bound") {
    if (!evidence.bodyIncludes?.length) errors.push(`${id}: bound evidence needs bodyIncludes`);
    if (!/toBe\(|toEqual\(|toThrow\(|toMatchObject\(|SELECT|getByText\(/.test(body)) {
      errors.push(`${id}: bound evidence has no strong assertion`);
    }
  }
  if (body.includes("status < 400")) errors.push(`${id}: status < 400 is not coverage`);
}

function checkMatrix(input, errors) {
  if (!input.matrix) return;
  const present = new Set(input.outcomes.filter((row) => row.matrixEdge).map((row) => row.matrixEdge));
  for (const edge of input.matrix.edges) {
    if (!present.has(edge)) errors.push(`matrix edge ${edge} has no registry outcome`);
  }
  for (const outcome of input.outcomes) {
    if (outcome.matrixEdge && !input.matrix.edges.includes(outcome.matrixEdge)) {
      errors.push(`${outcome.id}: obsolete matrix edge ${outcome.matrixEdge}`);
    }
  }
  for (const section of input.matrix.sections) {
    if (!input.outcomes.some((row) => row.section === section)) {
      errors.push(`tender section ${section} has no outcome`);
    }
  }
}

function checkWorkflow(workflow, errors) {
  if (workflow == null) return;
  const lines = workflow.split("\n").filter((line) => line.includes("playwright install"));
  if (lines.length === 0) errors.push("workflow has no playwright install");
  for (const line of lines) {
    if (line.includes("||")) errors.push(`playwright install failure is swallowed: ${line.trim()}`);
  }
  if (!workflow.includes("v2-bootstrap")) errors.push("workflow push trigger does not include v2-bootstrap");
}

function testBody(source, title) {
  const quoted = JSON.stringify(title);
  const markers = [`it(${quoted}`, `test(${quoted}`, `it.skip(${quoted}`, `test.skip(${quoted}`];
  let at = -1;
  let skipped = false;
  for (const marker of markers) {
    const found = source.indexOf(marker);
    if (found >= 0) {
      at = found;
      skipped = marker.includes(".skip");
      break;
    }
  }
  if (at < 0) return { found: false, skipped: false, body: "" };
  const rest = source.slice(at);
  const next = rest.slice(1).search(/\n(?:it|test|it\.skip|test\.skip)\(/);
  const body = next < 0 ? rest : rest.slice(0, next + 1);
  return { found: true, skipped, body };
}
