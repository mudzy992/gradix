#!/usr/bin/env node
// STD-01 — nema console.log/debug u aplikativnom kodu (console.error/warn su dozvoljeni).
// Izuzetak mora biti u scripts/standards/allowlist.json sa razlogom i rokom.
//
//   node scripts/standards/check-console.mjs

import { Report, finish, loadAllowlist, read, walk } from './lib.mjs';

const report = new Report(
  'Nema console.log u aplikativnom kodu',
  'strukturisano logovanje (pino, INF-04) je jedini način da logovi dođu do Coolifyja sa nivoom i kontekstom',
  'koristi Logger (kad postoji) ili console.error/warn; ako je izuzetak opravdan, dodaj ga u allowlist.json',
);

const allow = loadAllowlist();
const ALLOWED_DIRS = /^(backend\/src|frontend\/src|mobile\/(app|components|lib|db|sync|hooks))\//;
const ALLOWED_EXT = /\.(ts|tsx)$/;
const SKIP = /(\.spec\.|\.e2e-spec\.|__tests__|\/test\/|seed)/;
const PATTERN = /\bconsole\.(log|debug)\s*\(/g;

const files = [
  ...walk('backend/src', (f) => ALLOWED_EXT.test(f) && !SKIP.test(f)),
  ...walk('frontend/src', (f) => ALLOWED_EXT.test(f) && !SKIP.test(f)),
  ...walk('mobile', (f) => ALLOWED_EXT.test(f) && !SKIP.test(f) && /^mobile\/(app|components|lib|db|sync|hooks)\//.test(f)),
];

for (const file of files) {
  report.bump();
  const text = read(file);
  const lines = text.split('\n');
  const hits = allow.logs.filter((a) => a.file === file);
  lines.forEach((line, i) => {
    PATTERN.lastIndex = 0;
    if (!PATTERN.test(line)) return;
    if (hits.some((h) => h.match && line.includes(h.match))) return;
    report.violation(`${file}:${i + 1}`, `console.log/debug — ${line.trim().slice(0, 80)}`);
  });
}

finish(report);
