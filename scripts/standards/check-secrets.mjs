#!/usr/bin/env node
// STD-01 — nema tajni u repozitoriju. Skener je namjerno konzervativan (malo lažnih pozitiva),
// jer se svaki izuzetak mora ručno zapisati u allowlist.json.
//
//   node scripts/standards/check-secrets.mjs

import { Report, finish, lineOf, loadAllowlist, read, walk } from './lib.mjs';

const report = new Report(
  'Nema tajni u kodu',
  'tajna u gitu je tajna zauvijek (historija se ne briše); Coolify i .env su jedino mjesto za vrijednosti',
  'premjesti vrijednost u env (Coolify), rotiraj je, pa očisti fajl',
);

const allow = loadAllowlist();

const RULES = [
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, what: 'AWS access key' },
  { id: 'private-key', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, what: 'privatni ključ' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, what: 'GitHub token' },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, what: 'Slack token' },
  { id: 'stripe-key', re: /\bsk_live_[A-Za-z0-9]{20,}\b/g, what: 'Stripe live ključ' },
  { id: 'db-url-with-password', re: /\b(?:postgres|postgresql|redis|rediss):\/\/[^\s:'"@]+:[^\s'"@]{4,}@/g, what: 'URL baze sa lozinkom' },
];

// Primjeri i testovi smiju imati očigledne placeholdere.
const SKIP_FILES = [
  '**/*.md', 'docs/**', 'AUDIT/**',
  '**/*.spec.ts', '**/*.e2e-spec.ts', '**/test/**', 'frontend/e2e/**',
  'backend/prisma/seed*.ts', '**/package-lock.json',
  '.env.example', '.env.coolify',
];

const files = [
  ...walk('backend', (f) => /\.(ts|json|sh|yml|yaml|prisma)$/.test(f) && !f.includes('node_modules')),
  ...walk('frontend', (f) => /\.(ts|tsx|json|html|template|conf)$/.test(f) && !f.includes('node_modules')),
  ...walk('mobile', (f) => /\.(ts|tsx|json|js)$/.test(f) && !f.includes('node_modules')),
  ...walk('.github', (f) => /\.(yml|yaml)$/.test(f)),
  ...walk('scripts', (f) => /\.(mjs|js|sh)$/.test(f)),
  'docker-compose.yml', 'docker-compose.local-ports.yml', '.env.example', '.env.coolify',
  'Dockerfile', 'Dockerfile.frontend',
].filter((f) => {
  return !SKIP_FILES.some((g) => {
    if (g.startsWith('**/')) return f.includes(g.slice(3));
    if (g.endsWith('/**')) return f.startsWith(g.slice(0, -3));
    return f === g;
  });
});

for (const file of files) {
  report.bump();
  const text = read(file);
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const hit = m[0];
      // placeholderi u primjerima
      if (/localhost|127\.0\.0\.1|example|changeme|<|root:root|\$\{/.test(hit)) continue;
      const start = text.lastIndexOf('\n', m.index) + 1;
      const end = text.indexOf('\n', m.index);
      const line = text.slice(start, end === -1 ? text.length : end);
      const exempt = allow.secrets.some((a) => a.file === file && line.includes(a.match));
      if (exempt) continue;
      report.violation(`${file}:${lineOf(text, m.index)}`, `${rule.what}: ${hit.slice(0, 24)}…`);
    }
  }
}

finish(report);
