#!/usr/bin/env node
// CI-04 — coverage ratchet: prag se ne izmišlja, nego se **zaključava na izmjereno stanje** i
// smije samo rasti. Cilj od 40 % (Q5 / D-016) se dostiže testovima u TEST-01/TEST-02, a ovaj
// gate garantuje da se pokrivenost ne može vratiti unazad.
//
//   node scripts/standards/check-coverage-ratchet.mjs
//   node scripts/standards/check-coverage-ratchet.mjs --summary=backend/coverage/coverage-summary.json \
//        --baseline=backend/coverage-baseline.json --write   # ručno podizanje praga (novi baseline)
//
// Pravila:
//  - metrika ispod baseline-a  → exit 1 (regresija)
//  - metrika iznad baseline-a za ≥ 5 pp → upozorenje „podigni baseline“
//  - `--write` upisuje trenutno stanje u baseline (samo ručno, nikad u CI-ju)

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const resolve = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const summaryPath = resolve(arg('summary', 'backend/coverage/coverage-summary.json'));
const baselinePath = resolve(arg('baseline', 'backend/coverage-baseline.json'));
const write = argv.includes('--write');
const METRICS = ['lines', 'statements', 'functions', 'branches'];

if (!fs.existsSync(summaryPath)) {
  console.error(`Nema coverage izvještaja: ${path.relative(ROOT, summaryPath)}`);
  console.error('Pokreni: cd backend && npm run test:cov');
  process.exit(2);
}
if (!fs.existsSync(baselinePath)) {
  console.error(`Nema baseline-a: ${path.relative(ROOT, baselinePath)} (kreiraj sa --write)`);
  process.exit(2);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).total;
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const current = Object.fromEntries(METRICS.map((m) => [m, Number(summary[m]?.pct ?? 0)]));

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = METRICS.map((m) => {
    const was = Number(baseline.metrics?.[m] ?? 0);
    const now = current[m];
    return `| ${m} | ${now.toFixed(2)} % | ${was.toFixed(2)} % | ${now >= was ? '✅' : '❌'} |`;
  });
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ['## Coverage ratchet', '', '| metrika | sada | prag | |', '|---|---|---|---|', ...rows, ''].join('\n'),
    'utf8',
  );
}

console.log('── COVERAGE RATCHET ──────────────────────────────────────');
const regressions = [];
const raises = [];
for (const m of METRICS) {
  const was = Number(baseline.metrics?.[m] ?? 0);
  const now = current[m];
  const delta = now - was;
  const mark = delta < -0.05 ? '❌' : '✅';
  console.log(`   ${mark} ${m.padEnd(11)} ${was.toFixed(2)}% → ${now.toFixed(2)}%  (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pp)`);
  if (delta < -0.05) regressions.push(`${m}: ${was.toFixed(2)}% → ${now.toFixed(2)}%`);
  if (delta >= 5) raises.push(`${m}: ${now.toFixed(2)}%`);
}

if (write) {
  const next = {
    $comment: baseline.$comment,
    date: new Date().toISOString().slice(0, 10),
    metrics: current,
    note: baseline.note,
  };
  fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`\nBaseline upisan: ${path.relative(ROOT, baselinePath)}`);
  process.exit(0);
}

if (raises.length) console.log(`\n⚠️  Pokrivenost je porasla — podigni baseline (--write): ${raises.join(', ')}`);
if (regressions.length) {
  console.log(`\n❌ Regresija pokrivenosti (${regressions.length}):`);
  for (const r of regressions) console.log(`   - ${r}`);
  console.log('   Popravka: dodaj testove ili (samo uz odobrenje) opravdaj pad i podigni baseline.');
  process.exit(1);
}
console.log('\nGATE: PASS');
