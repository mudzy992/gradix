#!/usr/bin/env node
// STD-01 — jedna komanda za sve guardraile: `npm run check:all`.
// Svaki korak je zaseban proces; pad bilo kog koraka = pad cjeline (exit 1).
//
//   node scripts/standards/check-all.mjs                # sve što je izvodljivo lokalno
//   node scripts/standards/check-all.mjs --ci           # u CI: preskočen korak je GREŠKA
//   node scripts/standards/check-all.mjs --only=docs    # jedan ili više (zarez)
//   node scripts/standards/check-all.mjs --list         # šta postoji
//
// Korak koji traži `node_modules` se lokalno preskače sa jasnom porukom; u CI-ju (`--ci`) pada.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const only = (argv.find((a) => a.startsWith('--only=')) ?? '').replace('--only=', '').split(',').filter(Boolean);
const ci = argv.includes('--ci');
const list = argv.includes('--list');

const NODE = process.execPath;
const node = (...args) => [NODE, ...args];

const STEPS = [
  {
    id: 'coverage',
    name: 'Matrica pokrivenosti (svaki fajl inventarisan, statusi legalni)',
    cmd: node('scripts/audit/check-coverage.mjs'),
  },
  {
    id: 'audit-status',
    name: 'Strogi audit gate (lokalne provjere statusa i matrice)',
    cmd: node('scripts/audit/check-audit-gate.mjs'),
  },
  {
    id: 'segments',
    name: 'Skeletoni segmenata (59/59)',
    cmd: node('scripts/audit/scaffold-segments.mjs', '--check'),
  },
  {
    id: 'docs',
    name: 'Dokumentacija (linkovi, baneri, indeksi)',
    cmd: node('scripts/standards/check-docs.mjs'),
  },
  {
    id: 'secrets',
    name: 'Nema tajni u kodu',
    cmd: node('scripts/standards/check-secrets.mjs'),
  },
  {
    id: 'logs',
    name: 'Nema console.log u aplikativnom kodu',
    cmd: node('scripts/standards/check-console.mjs'),
  },
  {
    id: 'decimal-mocks',
    name: 'Backend testovi koriste pravi Prisma Decimal',
    cmd: node('scripts/standards/check-decimal-mocks.mjs'),
  },
  {
    id: 'tenant-static',
    name: 'Tenant Prisma AST ratchet (postojeći kandidati nisu pregledani)',
    cmd: node('scripts/standards/check-tenant.mjs'),
    needs: 'backend/node_modules/typescript',
  },
  {
    id: 'schema',
    name: 'Prisma šema: nema novih FK bez indeksa',
    cmd: node('scripts/standards/check-schema.mjs'),
  },
  {
    id: 'image',
    name: 'Backend slika + entrypoint (non-root, healthcheck, exec forma)',
    cmd: node('scripts/standards/check-image.mjs'),
  },
  {
    id: 'env',
    name: 'Env varijable dokumentovane i usklađene (.env.example ↔ .env.coolify ↔ kod)',
    cmd: node('scripts/standards/check-env.mjs'),
  },
  {
    id: 'compose',
    name: 'Compose invarijante (Coolify)',
    cmd: node('scripts/standards/check-compose.mjs'),
  },
  {
    id: 'coverage-ratchet',
    name: 'Coverage ratchet (ne smije pasti ispod baseline-a)',
    cmd: node('scripts/standards/check-coverage-ratchet.mjs'),
    needs: 'backend/coverage/coverage-summary.json',
  },
  {
    id: 'backend-lint',
    name: 'Backend: ESLint (bez --fix)',
    cmd: ['npm', 'run', 'lint:check'],
    cwd: 'backend',
    needs: 'backend/node_modules',
    needsAlso: 'generated',
  },
  {
    id: 'backend-types',
    name: 'Backend: TypeScript (tsc --noEmit)',
    cmd: ['npm', 'run', 'typecheck'],
    cwd: 'backend',
    needs: 'backend/node_modules',
    needsAlso: 'generated',
  },
  {
    id: 'backend-test',
    name: 'Backend: unit testovi (Jest)',
    cmd: ['npm', 'test', '--', '--silent'],
    cwd: 'backend',
    needs: 'backend/node_modules',
  },
  {
    id: 'frontend-lint',
    name: 'Frontend: oxlint',
    cmd: ['npm', 'run', 'lint:check'],
    cwd: 'frontend',
    needs: 'frontend/node_modules',
  },
  {
    id: 'frontend-types',
    name: 'Frontend: TypeScript (tsc -b)',
    cmd: ['npm', 'run', 'typecheck'],
    cwd: 'frontend',
    needs: 'frontend/node_modules',
  },
];

if (list) {
  for (const s of STEPS) console.log(`${s.id.padEnd(10)} ${s.name}${s.needs ? `  (traži ${s.needs})` : ''}`);
  process.exit(0);
}

const selected = only.length ? STEPS.filter((s) => only.includes(s.id)) : STEPS;
const unknown = only.filter((id) => !STEPS.some((s) => s.id === id));
if (unknown.length) {
  console.error(`Nepoznat korak: ${unknown.join(', ')}. Postoje: ${STEPS.map((s) => s.id).join(', ')}`);
  process.exit(2);
}

const results = [];
const started = Date.now();

for (const step of selected) {
  const missing = [step.needs, step.needsAlso].filter((d) => d && !fs.existsSync(path.join(ROOT, d)));
  const missingDeps = missing.length > 0;
  if (missingDeps && !ci) {
    const hint = missing.includes('generated')
      ? 'pokreni `npx prisma generate` u backend/ i `npm ci` u tom paketu'
      : missing.includes('coverage')
        ? 'pokreni `cd backend && npm run test:cov`'
        : 'pokreni `npm ci` u tom paketu';
    console.log(`\n⏭  ${step.id}: preskočeno (nema ${missing.join(' ni ')}; ${hint})`);
    results.push({ ...step, status: 'skip' });
    continue;
  }
  if (missingDeps && ci) {
    console.log(`\n❌ ${step.id}: u CI-ju je preskakanje zabranjeno, a nema ${missing.join(' ni ')}`);
    results.push({ ...step, status: 'fail' });
    continue;
  }

  console.log(`\n▶ ${step.id}: ${step.name}`);
  const res = spawnSync(step.cmd[0], step.cmd.slice(1), {
    cwd: step.cwd ? path.join(ROOT, step.cwd) : ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.error) {
    console.log(`❌ ${step.id}: ne može se pokrenuti (${res.error.message})`);
    results.push({ ...step, status: 'fail' });
    continue;
  }
  results.push({ ...step, status: res.status === 0 ? 'pass' : 'fail' });
}

const icon = { pass: '✅', fail: '❌', skip: '⏭' };
console.log('\n── CHECK:ALL ─────────────────────────────────────────');
for (const r of results) console.log(`   ${icon[r.status]} ${r.id.padEnd(10)} ${r.name}`);
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip');
console.log(`\n   ${results.length} koraka, ${failed.length} palo, ${skipped.length} preskočeno, ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed.length ? 1 : 0);
