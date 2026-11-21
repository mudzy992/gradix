#!/usr/bin/env node
// INF-01 — env guard: kod i compose ne smiju koristiti varijablu koja nije dokumentovana,
// a `.env.example` i `.env.coolify` ne smiju se razići. Takođe: nema referenci na penzionisane
// dokumente iz konfiguracije (te reference tiho šalju čitaoca u arhivu).
//
//   node scripts/standards/check-env.mjs

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, Report, finish, loadAllowlist, read, walk } from './lib.mjs';

const report = new Report(
  'Env varijable su dokumentovane i usklađene',
  'varijabla koju kod traži a nije u predlošku = pad u produkciji; varijabla u predlošku koju niko ne čita = lažna sigurnost',
  'dodaj varijablu u .env.example i .env.coolify (isti ključevi) ili je ukloni iz koda/compose-a',
);

const allow = loadAllowlist();
const allowEnv = new Set((allow.env ?? []).map((e) => e.name));
const DOC = '.env.example';
const DOC_COOLIFY = '.env.coolify';

if (!fs.existsSync(path.join(ROOT, DOC))) {
  report.violation(DOC, 'nedostaje obavezni env predložak');
  finish(report);
  process.exit(1);
}

const documented = new Set(
  read(DOC)
    .split('\n')
    .map((l) => l.match(/^([A-Z_][A-Z0-9_]*)=/))
    .filter(Boolean)
    .map((m) => m[1]),
);

const usages = new Map(); // var → Set(izvor)
const add = (name, source) => {
  if (!usages.has(name)) usages.set(name, new Set());
  usages.get(name).add(source);
};

// 1) compose (oba fajla)
for (const f of ['docker-compose.yml', 'docker-compose.local-ports.yml']) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  for (const m of read(f).matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)) add(m[1], 'compose');
}

// 2) entrypoint + Dockerfile-ovi (ARG/ENV)
for (const f of ['backend/docker-entrypoint.sh', 'Dockerfile', 'Dockerfile.frontend', 'backend/Dockerfile', 'frontend/Dockerfile']) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  const text = read(f);
  for (const m of text.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)|\b(?:ARG|ENV)\s+([A-Z_][A-Z0-9_]*)/g)) {
    add(m[1] ?? m[2], f.includes('entrypoint') ? 'entrypoint' : 'docker');
  }
}

// 3) backend: config.get / getOrThrow / process.env
for (const f of walk('backend/src', (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'))) {
  const text = read(f);
  for (const m of text.matchAll(/\.get(?:OrThrow)?(?:<[^>]*>)?\(\s*(['\"])([A-Z_][A-Z0-9_]*)\1/g)) add(m[2], 'backend');
  for (const m of text.matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*(['\"])([A-Z_][A-Z0-9_]*)\2\s*\])/g)) add(m[1] ?? m[3], 'backend');
}
// backend: prisma.config.ts + seed (build-time / seed)
for (const f of ['backend/prisma.config.ts', ...walk('backend/prisma', (p) => p.endsWith('.ts'))]) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  for (const m of read(f).matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*(['\"])([A-Z_][A-Z0-9_]*)\2\s*\])/g)) add(m[1] ?? m[3], 'backend');
}

// 4) frontend / mobile (samo javne varijable)
for (const f of walk('frontend/src', (p) => /\.(ts|tsx)$/.test(p))) {
  for (const m of read(f).matchAll(/import\.meta\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*(['\"])([A-Z_][A-Z0-9_]*)\2\s*\])/g)) add(m[1] ?? m[3], 'frontend');
}
for (const f of walk('mobile', (p) => /\.(ts|tsx|js|json)$/.test(p))) {
  for (const m of read(f).matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*(['\"])([A-Z_][A-Z0-9_]*)\2\s*\])/g)) add(m[1] ?? m[3], 'mobile');
  for (const m of read(f).matchAll(/\b(EXPO_PUBLIC_[A-Z0-9_]+)\b/g)) add(m[1], 'mobile');
}

// --- provjera 1: sve što kod/compose traži mora biti dokumentovano ---
for (const [name, sources] of [...usages].sort()) {
  report.bump();
  if (documented.has(name) || allowEnv.has(name)) continue;
  report.violation([...sources].join('+'), `koristi ${name}, ali nije u ${DOC}`);
}

// --- provjera 1b: tekst od validateEnv mora sadržati statički pristup backend varijabli ---
// Sama TypeScript deklaracija ne izvršava validaciju. Ovo je heuristika: statički
// pristup raw.NAME u funkciji validateEnv nije dokaz semantičke ispravnosti validatora.
const schemaPath = 'backend/src/config/env.ts';
if (!fs.existsSync(path.join(ROOT, schemaPath))) {
  report.violation(schemaPath, 'nedostaje validator okruženja');
} else {
  const schema = read(schemaPath);
  const functionStart = schema.indexOf('export function validateEnv(');
  const body = functionStart < 0 ? '' : schema.slice(functionStart);
  if (functionStart < 0) report.violation(schemaPath, 'nedostaje funkcija validateEnv');
  const handled = new Set([...body.matchAll(/\braw\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  for (const [name, sources] of [...usages].sort()) {
    if (!sources.has('backend')) continue;
    report.bump();
    if (handled.has(name) || allowEnv.has(name)) continue;
    report.violation(schemaPath, `nije pronađen raw.${name} u tekstu od validateEnv, a backend ga čita`);
  }
}

// --- provjera 2: dokumentovano, a niko ne čita (upozorenje, ne pad) ---
for (const name of [...documented].sort()) {
  report.bump();
  if (!usages.has(name)) report.warning(DOC, `${name} je dokumentovan, ali ga kod/compose ne koristi`);
}

// --- provjera 3: .env.example i .env.coolify imaju iste ključeve ---
if (!fs.existsSync(path.join(ROOT, DOC_COOLIFY))) {
  report.violation(DOC_COOLIFY, 'nedostaje obavezni Coolify env predložak');
} else {
  const coolify = new Set(
    read(DOC_COOLIFY).split('\n').map((l) => l.match(/^([A-Z_][A-Z0-9_]*)=/)).filter(Boolean).map((m) => m[1]),
  );
  report.bump();
  for (const k of documented) if (!coolify.has(k)) report.violation(DOC_COOLIFY, `nema ${k} (a ima ga ${DOC})`);
  for (const k of coolify) if (!documented.has(k)) report.violation(DOC, `nema ${k} (a ima ga ${DOC_COOLIFY})`);
}

// --- provjera 4: nema referenci na penzionisane dokumente iz konfiguracije ---
const retiredNames = new Set(
  walk('docs/_retired', (f) => f.endsWith('.md')).map((f) => path.basename(f)),
);
const liveNames = new Set(walk('docs', (f) => f.endsWith('.md') && !f.startsWith('docs/_retired/')).map((f) => path.basename(f)));
const configFiles = [
  'docker-compose.yml', 'docker-compose.local-ports.yml', '.env.example', '.env.coolify',
  'Dockerfile', 'Dockerfile.frontend', 'backend/Dockerfile', 'frontend/Dockerfile',
  'backend/docker-entrypoint.sh', 'backend/prisma.config.ts',
];
for (const f of configFiles) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  report.bump();
  for (const m of read(f).matchAll(/\b([A-Za-z0-9_]+\.md)\b/g)) {
    const name = m[1];
    if (retiredNames.has(name) && !liveNames.has(name)) {
      report.violation(f, `referenca na penzionisan dokument ${name} → koristi docs/INFRASTRUCTURE.md`);
    }
  }
}

finish(report);
