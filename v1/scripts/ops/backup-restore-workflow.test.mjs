import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/backup-restore.yml'), 'utf8');
const match = workflow.match(/- name: Uporedi brojeve redova izvor ↔ restore\n\s+shell: bash\n\s+run: \|\n([\s\S]*?)\n      - name: Dijagnostika na pad/);
assert.ok(match, 'Drill comparison step must exist in the actual workflow');
const script = match[1].split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');

function runScenario(scenario) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gradix-restore-check-'));
  try {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(tmp, 'backend/prisma/migrations/001'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'backend/prisma/migrations/002'), { recursive: true });
    fs.writeFileSync(path.join(bin, 'psql'), `#!/usr/bin/env bash
set -eu
if [[ "$*" != *"ON_ERROR_STOP=1"* ]]; then echo missing-stop >&2; exit 1; fi
query="\${*: -1}"
if [[ "$CASE" == fail_both ]]; then echo 'identical failure' >&2; exit 1; fi
if [[ "$query" == *'_prisma_migrations'* ]]; then
  case "$CASE" in
    migration_error) echo failure >&2; exit 1;;
    migration_bad) echo not-a-number; exit 0;;
    migration_fewer) echo 1; exit 0;;
    migration_more) echo 3; exit 0;;
  esac
  echo 2; exit 0
fi
if [[ "$CASE" == row_bad ]]; then echo not-a-number; exit 0; fi
if [[ "$CASE" == mismatch && "$1" == target ]]; then echo 4; exit 0; fi
echo 3
`, { mode: 0o755 });
    return spawnSync('bash', ['-c', script], {
      cwd: tmp,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CASE: scenario, PG_SOURCE: 'source', PG_TARGET: 'target' },
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('jednaki redovi i potpune migracije prolaze', () => {
  const result = runScenario('success');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /rezultat: failed=0/);
});

test('identična greška oba SQL upita ne može izgledati kao jednak broj redova', () => {
  const result = runScenario('fail_both');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /rezultat: failed=0/);
});

test('različiti ili nebrojčani rezultati redova padaju', () => {
  for (const scenario of ['mismatch', 'row_bad']) {
    const result = runScenario(scenario);
    assert.notEqual(result.status, 0, scenario);
    assert.match(result.stdout, /::error title=row-count::/);
  }
});

test('neuspješan, nebrojčan ili pogrešan broj migracija pada', () => {
  for (const scenario of ['migration_error', 'migration_bad', 'migration_fewer', 'migration_more']) {
    const result = runScenario(scenario);
    assert.notEqual(result.status, 0, scenario);
    assert.doesNotMatch(result.stdout, /rezultat: failed=0/);
  }
});
