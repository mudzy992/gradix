type Obj = Record<string, unknown>;
export type ContractRoute = { method: string; path: string; handler: string };
export type ContractIssue = { route: string; issue: string };
export type ContractException = ContractIssue & { reason: string };
const object = (value: unknown): value is Obj =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function typedSchema(
  schema: unknown,
  document: unknown,
  seen = new Set<string>(),
): boolean {
  if (!object(schema)) return false;
  if (typeof schema.$ref === 'string') {
    if (!schema.$ref.startsWith('#/') || seen.has(schema.$ref)) return false;
    const next = new Set(seen).add(schema.$ref);
    let target: unknown = document;
    for (const part of schema.$ref.slice(2).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      target = object(target) ? target[key] : undefined;
    }
    return typedSchema(target, document, next);
  }
  if (
    typeof schema.type === 'string' &&
    [
      'object',
      'array',
      'string',
      'number',
      'integer',
      'boolean',
      'null',
    ].includes(schema.type)
  )
    return true;
  return ['oneOf', 'anyOf', 'allOf'].some((key) => {
    const parts = schema[key];
    return (
      Array.isArray(parts) &&
      parts.length > 0 &&
      parts.every((part: unknown) => typedSchema(part, document, seen))
    );
  });
}
function schemas(content: unknown): unknown[] {
  if (!object(content)) return [];
  return Object.values(content).flatMap((entry) =>
    object(entry) ? [entry.schema] : [],
  );
}
function responseSchemas(responses: Obj): unknown[] {
  return Object.entries(responses).flatMap(([status, response]) =>
    /^2\d\d$/.test(status) && object(response) ? schemas(response.content) : [],
  );
}
function listsData(schema: unknown): boolean {
  if (!object(schema)) return false;
  if (schema.type === 'array') return true;
  return (
    object(schema.properties) &&
    object(schema.properties.data) &&
    schema.properties.data.type === 'array'
  );
}
/** Identifies syntactic documentation gaps, not semantic correctness of a contract. */
export function contractIssues(
  route: ContractRoute,
  operation: unknown,
  document?: unknown,
): string[] {
  if (!object(operation)) return ['operation'];
  const issues: string[] = [];
  const responses = object(operation.responses) ? operation.responses : {};
  if (!Object.keys(responses).length) issues.push('response-missing');
  for (const [status, response] of Object.entries(responses)) {
    const types = object(response) ? schemas(response.content) : [];
    if (
      !types.length ||
      !types.every((schema) => typedSchema(schema, document))
    )
      issues.push(`response-schema-${status}`);
  }
  if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
    const body = object(operation.requestBody) ? operation.requestBody : {};
    const types = schemas(body.content);
    if (
      !types.length ||
      !types.every((schema) => typedSchema(schema, document))
    )
      issues.push('request-schema');
  }
  for (const code of ['400', '401', '403', '404']) {
    const response = responses[code];
    if (
      !object(response) ||
      typeof response.description !== 'string' ||
      !response.description.trim()
    )
      issues.push(`error-${code}`);
  }
  const inferredList =
    /^list/i.test(route.handler) || responseSchemas(responses).some(listsData);
  const kind = operation['x-gradix-response-kind'];
  if (
    route.method === 'GET' &&
    !inferredList &&
    kind !== 'list' &&
    kind !== 'single'
  )
    issues.push('list-classification');
  const list = route.method === 'GET' && (inferredList || kind === 'list');
  if (list) {
    const params = Array.isArray(operation.parameters)
      ? operation.parameters
      : [];
    if (
      !['cursor', 'limit'].every((name) =>
        params.some(
          (param) =>
            object(param) && param.in === 'query' && param.name === name,
        ),
      )
    )
      issues.push('cursor-limit');
  }
  return issues;
}
export function compareContractExceptions(
  issues: ContractIssue[],
  exceptions: ContractException[],
): string[] {
  const key = (item: ContractIssue) => `${item.route}|${item.issue}`;
  const exceptionsByKey = new Map<string, string>();
  for (const item of exceptions) {
    if (
      !item.route ||
      !item.issue ||
      !item.reason?.trim() ||
      exceptionsByKey.has(key(item))
    )
      throw new Error('Invalid or duplicate OpenAPI exception');
    exceptionsByKey.set(key(item), item.reason);
  }
  const actual = new Set(issues.map(key));
  const errors = [...actual]
    .filter((item) => !exceptionsByKey.has(item))
    .map((item) => `unlisted: ${item}`);
  for (const item of exceptionsByKey.keys())
    if (!actual.has(item)) errors.push(`stale: ${item}`);
  return errors;
}
