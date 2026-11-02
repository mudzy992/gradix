#!/usr/bin/env node
// STD-01 — invarijante produkcijskog compose fajla. Ovo su pravila koja su već jednom pala u
// produkciji (host portovi, CA mountovi, mrtve MinIO slike) — sada su provjerljiva lokalno.
//
//   node scripts/standards/check-compose.mjs

import fs from 'node:fs';
import { ROOT, Report, finish, read } from './lib.mjs';

const report = new Report(
  'Compose invarijante (Coolify)',
  'fiksni host portovi ruše blue/green deploy; bez CA mounta backend ne može da se poveže na bazu',
  'vidi docs/INFRASTRUCTURE.md §8; popravi docker-compose.yml (portove drži samo *.local-ports.yml)',
);

const PROD = 'docker-compose.yml';

/** Grubi parser: vraća { serviceName: { image, body } } za `services:` blok (dovoljno za invarijante). */
function parseServices(text) {
  const services = {};
  let inServices = false;
  let current = null;
  for (const line of text.split('\n')) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^\S/.test(line)) { inServices = false; current = null; }
    if (!inServices) continue;
    const svc = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (svc) { current = svc[1]; services[current] = { image: null, body: [] }; continue; }
    if (!current) continue;
    services[current].body.push(line);
    const img = line.match(/^\s+image:\s*(.+)$/);
    if (img) services[current].image = img[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return services;
}

// --- 1. nema host portova u produkcijskom compose-u ---
report.bump();
const text = read(PROD);
if (/^\s{4}ports:/m.test(text) || /^\s{2}ports:/m.test(text)) {
  report.violation(PROD, 'sadrži `ports:` — host portovi su dozvoljeni samo u docker-compose.local-ports.yml');
}

const services = parseServices(text);

// --- 2. eksterne mreže ---
for (const net of ['db_net', 'redis_net']) {
  report.bump();
  const declared = new RegExp(`^ {2}${net}:`, 'm').test(text.split(/^networks:/m)[1] ?? '');
  const external = new RegExp(`^ {2}${net}:[\\s\\S]{0,200}?external:\\s*true`, 'm').test(text);
  if (!declared || !external) report.violation(PROD, `mreža ${net} mora biti deklarisana kao external: true`);
}

// --- 3. CA mountovi u backend servisu, read-only ---
const backend = services.backend;
report.bump();
if (!backend) report.violation(PROD, 'nema `backend` servisa');
else {
  for (const target of ['/etc/ssl/certs/coolify-ca.crt', '/etc/ssl/redis/redis-ca.crt']) {
    report.bump();
    if (!backend.body.some((l) => l.includes(`target: ${target}`))) {
      report.violation(PROD, `backend ne mountuje ${target} (Coolify CA)`);
    }
  }
  report.bump();
  const roCount = backend.body.filter((l) => /read_only:\s*true/.test(l)).length;
  if (roCount < 2) report.violation(PROD, `CA mountovi moraju biti read_only: true (nađeno ${roCount})`);
}

// --- 4. slike: nema mrtvih MinIO image-a, nema nepinovanih trećih strana (upozorenje) ---
const DEAD_IMAGES = [/minio\/minio/, /quay\.io\/minio\/minio/, /bitnamilegacy\/minio/, /bitnami\/minio/];
for (const [name, svc] of Object.entries(services)) {
  report.bump();
  if (!svc.image) continue;
  if (DEAD_IMAGES.some((re) => re.test(svc.image))) {
    report.violation(PROD, `${name}: mrtva MinIO slika \`${svc.image}\``);
  }
  if (/:latest\b/.test(svc.image) && !/coollabsio\/minio/.test(svc.image)) {
    report.warning(PROD, `${name}: nepinovan tag \`${svc.image}\` (digest pinning je INF-01/CI-03)`);
  }
}

// --- 5. healthcheck na backendu i frontendu ---
for (const name of ['backend', 'frontend']) {
  report.bump();
  const svc = services[name];
  if (!svc) { report.violation(PROD, `nema \`${name}\` servisa`); continue; }
  if (!svc.body.some((l) => /^\s{4}healthcheck:/.test(l))) report.violation(PROD, `${name}: nema healthcheck`);
}

// --- 6. oba compose fajla moraju biti čitljivi i imati `services:` ---
for (const f of ['docker-compose.yml', 'docker-compose.local-ports.yml']) {
  report.bump();
  if (!fs.existsSync(new URL(`file://${ROOT}/${f}`))) continue;
  if (!/^services:/m.test(read(f))) report.violation(f, 'nema `services:` blok');
}

finish(report);
