// Execute the real env guard in an isolated repository; never alter actual templates.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = path.dirname(fileURLToPath(import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'gradix-env-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/standards', 'backend/src/config', 'frontend/src']) mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ['lib.mjs', 'check-env.mjs']) copyFileSync(path.join(source, file), path.join(root, 'scripts/standards', file));
  const write = (file, value) => writeFileSync(path.join(root, file), value);
  write('.env.example', 'FOO_BAR=\n');
  write('.env.coolify', 'FOO_BAR=\n');
  write('backend/src/config/env.ts', 'export interface AppEnv { FOO_BAR: string }\nexport function validateEnv(raw: any) { return raw.FOO_BAR }\n');
  write('backend/src/app.ts', "const a = config.get('FOO_BAR');\n");
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/standards/check-env.mjs')], { cwd: root, encoding: 'utf8' });
  return { root, write, run };
}

test('usaglašeni predlošci i eksplicitni pristup validatora prolaze', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('navodnici i statički bracket pristupi detektuju nedokumentovane varijable', (t) => {
  const f = fixture(t);
  f.write('backend/src/app.ts', 'config.get<string>("DOUBLE_QUOTE"); process.env[\'BRACKET_BACKEND\'];\n');
  f.write('frontend/src/app.ts', 'import.meta.env["VITE_BRACKET"];\n');
  const result = f.run();
  assert.equal(result.status, 1);
  for (const name of ['DOUBLE_QUOTE', 'BRACKET_BACKEND', 'VITE_BRACKET']) assert.match(result.stdout, new RegExp(`koristi ${name}`));
});

test('sama TypeScript deklaracija nije dokaz da validator obrađuje varijablu', (t) => {
  const f = fixture(t);
  f.write('backend/src/config/env.ts', 'export interface AppEnv { FOO_BAR: string }\nexport function validateEnv(raw: any) { return raw }\n');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /nije pronađen raw\.FOO_BAR u tekstu od validateEnv/);
});

test('nedostajući Coolify predložak i validator ruše provjeru', (t) => {
  const f = fixture(t);
  rmSync(path.join(f.root, '.env.coolify'));
  rmSync(path.join(f.root, 'backend/src/config/env.ts'));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /nedostaje obavezni Coolify env predložak/);
  assert.match(result.stdout, /nedostaje validator okruženja/);
});

test('različiti ključevi predložaka i nedostajući example nisu prihvaćeni', (t) => {
  const f = fixture(t);
  f.write('.env.coolify', 'OTHER=\n');
  let result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /nema FOO_BAR/);
  assert.match(result.stdout, /nema OTHER/);
  rmSync(path.join(f.root, '.env.example'));
  result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /nedostaje obavezni env predložak/);
});
