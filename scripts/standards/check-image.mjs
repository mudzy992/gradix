#!/usr/bin/env node
// INF-02 — invarijante backend slike i entrypointa, provjerljive bez Dockera:
//  - produkcijska faza ne radi kao root (`USER node` prije ENTRYPOINT-a)
//  - HEALTHCHECK postoji i gađa /api/health
//  - ENTRYPOINT + CMD su definisani (exec forma, ne shell forma)
//  - entrypoint ima `set -e` i završava sa `exec "$@"` (signali idu do node-a)
//  - seed je u slici (D-024) i ulazna tačka builda se provjerava u buildu
//
//   node scripts/standards/check-image.mjs

import { Report, finish, read } from './lib.mjs';

const report = new Report(
  'Backend slika i entrypoint',
  'root u kontejneru = pun pristup host bind mount-ovima; bez `exec` signali ne stižu do node-a, pa deploy „visi“ do timeouta',
  'popravi backend/Dockerfile odnosno backend/docker-entrypoint.sh (vidi docs/INFRASTRUCTURE.md §3–§4)',
);

const dockerfile = read('backend/Dockerfile');
const lines = dockerfile.split('\n');

// 1) USER node u produkcijskoj fazi
report.bump();
const lastFrom = lines.map((l, i) => (/^FROM\s/.test(l) ? i : -1)).filter((i) => i >= 0).pop();
const userLine = lines.findIndex((l, i) => i > lastFrom && /^USER\s+/.test(l));
const entrypointLine = lines.findIndex((l) => /^ENTRYPOINT\s/.test(l));
if (userLine === -1) report.violation('backend/Dockerfile', 'produkcijska faza nema `USER` (radi kao root)');
else {
  const user = lines[userLine].replace(/^USER\s+/, '').trim();
  if (user === 'root' || user === '0') report.violation('backend/Dockerfile', 'produkcijska faza radi kao root');
  if (entrypointLine !== -1 && userLine > entrypointLine) {
    report.violation('backend/Dockerfile', '`USER` mora biti prije `ENTRYPOINT`');
  }
}

// 2) HEALTHCHECK
report.bump();
const health = lines.findIndex((l) => /^HEALTHCHECK\s/.test(l));
if (health === -1) report.violation('backend/Dockerfile', 'nema HEALTHCHECK');
else {
  const healthBlock = lines.slice(health, health + 3).join(' ');
  if (!healthBlock.includes('/api/health')) {
    report.violation('backend/Dockerfile', 'HEALTHCHECK ne gađa /api/health (API prefiks je `api`)');
  }
}

// 3) ENTRYPOINT + CMD u exec formi
report.bump();
const cmdLine = lines.findIndex((l) => /^CMD\s/.test(l));
if (entrypointLine === -1) report.violation('backend/Dockerfile', 'nema ENTRYPOINT');
else if (!/^ENTRYPOINT\s+\[/.test(dockerfile.split('\n')[entrypointLine])) {
  report.violation('backend/Dockerfile', 'ENTRYPOINT nije u exec formi (JSON array)');
}
if (cmdLine === -1) report.violation('backend/Dockerfile', 'nema CMD');
else if (!/^CMD\s+\[/.test(lines[cmdLine])) report.violation('backend/Dockerfile', 'CMD nije u exec formi');

// 4) seed ulazna tačka je provjerena u buildu (D-024)
report.bump();
if (!/test -f dist\/prisma\/seed\.js/.test(dockerfile)) {
  report.violation('backend/Dockerfile', 'build ne provjerava dist/prisma/seed.js (seed je dio slike)');
}

// 5) entrypoint: set -e + exec
const entry = read('backend/docker-entrypoint.sh');
report.bump();
if (!/^set -e/m.test(entry)) report.violation('backend/docker-entrypoint.sh', 'nema `set -e`');
report.bump();
if (!/^exec\s+"\$@"\s*$/m.test(entry)) {
  report.violation('backend/docker-entrypoint.sh', 'ne završava sa `exec "$@"` (signali ne stižu do node-a)');
}

// 6) entrypoint provjerava CA prije migracija
report.bump();
const caIdx = entry.indexOf('sslrootcert');
const migrateIdx = entry.indexOf('migrate deploy');
if (caIdx === -1) report.violation('backend/docker-entrypoint.sh', 'nema SSL preflight');
else if (migrateIdx !== -1 && caIdx > migrateIdx) {
  report.violation('backend/docker-entrypoint.sh', 'SSL preflight mora biti prije `migrate deploy`');
}

finish(report);
