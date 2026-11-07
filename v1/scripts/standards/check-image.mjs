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
  'Slike i entrypointi (backend + frontend)',
  'root u kontejneru = pun pristup host bind mount-ovima; nginx `add_header` u dubljem bloku poništava naslijeđene headere; bez `exec` signali ne stižu do node-a',
  'popravi Dockerfile/entrypoint/nginx template (vidi docs/INFRASTRUCTURE.md §3–§4 i §10)',
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

// --- FRONTEND (INF-03) ---
const feDockerfile = read('frontend/Dockerfile');
const nginx = read('frontend/nginx/default.conf.template');

// 8) frontend slika: healthcheck, STOPSIGNAL, exec CMD
report.bump();
if (!/^HEALTHCHECK\s/m.test(feDockerfile)) report.violation('frontend/Dockerfile', 'nema HEALTHCHECK');
report.bump();
if (!/^STOPSIGNAL\s+SIGQUIT/m.test(feDockerfile)) {
  report.violation('frontend/Dockerfile', 'nema `STOPSIGNAL SIGQUIT` (nginx se gasi graceful)');
}
report.bump();
if (!/^CMD\s+\[/m.test(feDockerfile)) report.violation('frontend/Dockerfile', 'CMD nije u exec formi');

// 9) nginx: skrivena verzija + CSP
report.bump();
if (!/server_tokens\s+off;/.test(nginx)) report.violation('frontend/nginx/default.conf.template', 'nema `server_tokens off;`');
report.bump();
if (!/Content-Security-Policy/.test(nginx)) {
  report.violation('frontend/nginx/default.conf.template', 'nema `Content-Security-Policy` headera');
}

// 9b) D-041: API može biti na drugom domenu → CSP mora imati `${CSP_API_ORIGIN}` u `img-src` i
// `connect-src`, i sva tri `add_header` bloka moraju biti IDENTIČNA (inače jedan blok tiho
// ostane bez dozvole za API domen).
report.bump();
{
  const headers = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map((m) => m[1]);
  if (headers.length !== 3) {
    report.violation('frontend/nginx/default.conf.template', `CSP header mora biti u sva 3 bloka (nađeno ${headers.length})`);
  } else if (new Set(headers).size !== 1) {
    report.violation('frontend/nginx/default.conf.template', 'CSP headeri se razlikuju između blokova (nginx ih tada ne nasljeđuje isto)');
  }
  const csp = headers[0] ?? '';
  if (!/img-src[^;]*\$\{CSP_API_ORIGIN\}/.test(csp)) {
    report.violation('frontend/nginx/default.conf.template', 'CSP `img-src` nema `${CSP_API_ORIGIN}` (logo/fajlovi sa API domena se ne bi prikazali)');
  }
  if (!/connect-src[^;]*\$\{CSP_API_ORIGIN\}/.test(csp)) {
    report.violation('frontend/nginx/default.conf.template', 'CSP `connect-src` nema `${CSP_API_ORIGIN}` (fetch na API domen bi bio blokiran)');
  }
}

// 10) nasljeđivanje headera: svaki blok sa svojim add_header mora ponoviti sigurnosne headere
report.bump();
for (const block of ['location /assets/', 'location = /index.html']) {
  const start = nginx.indexOf(block);
  if (start === -1) {
    report.violation('frontend/nginx/default.conf.template', `nema blok \`${block}\``);
    continue;
  }
  const body = nginx.slice(start, nginx.indexOf('}', start));
  if (/add_header/.test(body) && !body.includes('X-Content-Type-Options')) {
    report.violation('frontend/nginx/default.conf.template', `blok \`${block}\` ima svoj add_header ali ne ponavlja sigurnosne headere (nginx ih tada poništi)`);
  }
}

// 11) proxy i SPA fallback
report.bump();
for (const needle of ['proxy_pass ${BACKEND_URL}/api/', 'proxy_pass ${BACKEND_URL}/socket.io/', 'try_files $uri $uri/ /index.html']) {
  if (!nginx.includes(needle)) report.violation('frontend/nginx/default.conf.template', `nema: ${needle}`);
}

// 12) korijenski Dockerfile-ovi su identične kopije app verzija (Coolify koristi korijen)
report.bump();
for (const [rootFile, appFile, appText] of [
  ['Dockerfile', 'backend/Dockerfile', dockerfile],
  ['Dockerfile.frontend', 'frontend/Dockerfile', feDockerfile],
]) {
  report.bump();
  try {
    if (read(rootFile) !== appText) {
      report.violation(rootFile, `nije identičan \`${appFile}\` (CI to traži u jobu \`docker\`)`);
    }
  } catch {
    report.violation(rootFile, 'ne postoji korijenska kopija');
  }
}

finish(report);
