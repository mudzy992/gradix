#!/usr/bin/env node
// TEST-01: conservative AST ratchet; baseline entries are unreviewed debt, not safety approval.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT, walk } from './lib.mjs';

// TypeScript is already a backend dev dependency, not a new dependency.
const require = createRequire(path.join(ROOT, 'backend/package.json'));
const ts = require('typescript');
const OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy']);

export function tenantModels() {
  const dir = path.join(ROOT, 'backend/prisma/schema');
  const models = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.prisma')).sort()) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\/[^\n]*/g, '');
    for (const match of text.matchAll(/\bmodel\s+(\w+)\s*\{([^}]*?)\}/gs)) {
      if (/^\s*companyId\s+\w+\??(?:\s|$)/m.test(match[2])) models.add(match[1]);
    }
  }
  if (!models.size) throw new Error('No tenant models found');
  return models;
}
function property(obj, key) {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  return obj.properties.find((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === key);
}
function value(prop) {
  if (!prop) return undefined;
  if (ts.isShorthandPropertyAssignment(prop)) return prop.name;
  if (ts.isPropertyAssignment(prop)) return prop.initializer;
  return undefined;
}
function unwrap(expr) {
  while (expr && (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isAwaitExpression(expr))) expr = expr.expression;
  return expr;
}
function staticScope(expr, helpers) {
  expr = unwrap(expr);
  if (!expr) return false;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && helpers.has(expr.expression.text)) return true;
  if (!ts.isObjectLiteralExpression(expr)) return false;
  let company = unwrap(value(property(expr, 'companyId')));
  if (company && ts.isObjectLiteralExpression(company)) company = unwrap(value(property(company, 'equals')));
  if (company && company.kind !== ts.SyntaxKind.NullKeyword && !(ts.isIdentifier(company) && company.text === 'undefined')) return true;
  if (expr.properties.some((p) => ts.isSpreadAssignment(p) && staticScope(p.expression, helpers))) return true;
  const and = unwrap(value(property(expr, 'AND')));
  if (and && ts.isArrayLiteralExpression(and)) return and.elements.some((part) => staticScope(part, helpers));
  return and ? staticScope(and, helpers) : false;
}
function dataScope(expr, helpers) {
  expr = unwrap(expr);
  if (expr && ts.isArrayLiteralExpression(expr)) return expr.elements.length > 0 && expr.elements.every((part) => dataScope(part, helpers));
  return staticScope(expr, helpers);
}
export function scanSource(file, text, models) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const byName = new Map([...models].map((name) => [name[0].toLowerCase() + name.slice(1), name]));
  const helpers = new Set();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !stmt.moduleSpecifier.text.endsWith('/scope-by-project')) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const e of bindings.elements) if (['scopeByCompany', 'projectListWhere'].includes((e.propertyName ?? e.name).text)) helpers.add(e.name.text);
  }
  const found = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const op = node.expression.name.text;
      const target = node.expression.expression;
      if (OPS.has(op) && ts.isPropertyAccessExpression(target) && byName.has(target.name.text)) {
        const args = node.arguments[0];
        const where = value(property(args, 'where'));
        const data = value(property(args, 'data'));
        const create = value(property(args, 'create'));
        let scoped;
        if (['create', 'createMany', 'createManyAndReturn'].includes(op)) scoped = dataScope(data, helpers);
        else if (op === 'upsert') scoped = staticScope(where, helpers) && dataScope(create, helpers);
        else scoped = staticScope(where, helpers);
        if (!scoped) found.push({ file, model: byName.get(target.name.text), operation: op, fingerprint: createHash('sha256').update(node.getText(source)).digest('hex'), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}
export function compareBaseline(found, baseline) {
  const key = (x) => [x.file, x.model, x.operation, x.fingerprint].join('|');
  const allowed = new Map();
  for (const entry of baseline) {
    if (!entry.reason || !Number.isInteger(entry.count) || entry.count < 1 || allowed.has(key(entry))) throw new Error('Invalid tenant baseline entry');
    allowed.set(key(entry), entry.count);
  }
  const seen = new Map();
  for (const entry of found) seen.set(key(entry), (seen.get(key(entry)) ?? 0) + 1);
  return [...seen].filter(([k, count]) => count > (allowed.get(k) ?? 0)).map(([k, count]) => `${k}: ${count} > ${allowed.get(k) ?? 0}`);
}
function main() {
  const models = tenantModels();
  const files = walk('backend/src', (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
  const found = files.flatMap((file) => scanSource(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), models));
  const baselinePath = path.join(ROOT, 'scripts/standards/tenant-query-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const errors = compareBaseline(found, baseline);
  process.stdout.write(`Tenant AST: ${models.size} models; ${found.length} candidate unscoped calls; ${errors.length} new/expanded; baseline is unreviewed debt.\n`);
  if (errors.length) { for (const error of errors) process.stderr.write(`${error}\n`); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
