#!/usr/bin/env node
// A lightweight guard against common hand-written Decimal mocks in backend specs.
// It is deliberately conservative, not a TypeScript semantic proof.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const option = process.argv.find((arg) => arg.startsWith('--root='));
const root = option ? path.resolve(option.slice(7)) : ROOT;
const backend = path.join(root, 'backend');
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!['node_modules', 'generated', 'coverage', 'dist'].includes(entry.name)) walk(path.join(dir, entry.name));
    } else if (entry.isFile() && /(?:\.spec|\.e2e-spec)\.tsx?$/.test(entry.name)) files.push(path.join(dir, entry.name));
  }
}
walk(backend);
const patterns = [
  /\bclass\s+(?:(?:Fake|Mock|Stub)\s*Decimal|\w*(?:Fake|Mock|Stub)\w*Decimal|\w*Decimal\w*(?:Fake|Mock|Stub)|Decimal)\b/i,
  /(?:\bDecimal\b|['"]Decimal['"])\s*:\s*(?!Prisma\s*\.\s*Decimal\b)(?:class\b|function\b|jest\s*\.\s*fn\b|[A-Za-z_$][\w$]*|\([^)]*\)\s*=>|\{)/,
  /\bjest\s*\.\s*(?:mock|doMock)\s*\(\s*['"]decimal\.js(?:-light)?['"]/
];
const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
  if (patterns.some((pattern) => pattern.test(source))) violations.push(path.relative(root, file).split(path.sep).join('/'));
}
if (violations.length) {
  console.log('❌ Ručno pisani Decimal mock je zabranjen; koristi stvarni Prisma.Decimal ili backend/test/helpers/decimal.ts:');
  for (const file of violations) console.log(`   - ${file}`);
  process.exitCode = 1;
} else console.log(`✅ Decimal mock guard: ${files.length} backend spec fajlova provjereno.`);
