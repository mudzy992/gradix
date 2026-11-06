// Zajednička logika za audit skripte (bez zavisnosti).
// Koristi se iz `inventory.mjs` (generisanje matrice) i `check-coverage.mjs` (CI gate).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MATRIX_PATH = path.join(ROOT, 'AUDIT/COVERAGE_MATRIX.csv');
export const SEGMENTS_PATH = path.join(ROOT, 'scripts/audit/segments.json');
export const PLAN_PATH = path.join(ROOT, 'AUDIT/02_MASTER_AUDIT_PLAN.md');

export const STATUSES = ['nepregledano', 'u-toku', 'pregledano', 'popravljeno', 'pokriveno-testom'];
export const REVIEWED = new Set(['pregledano', 'popravljeno', 'pokriveno-testom']);
export const CSV_HEADER = ['file', 'layer', 'module', 'segment', 'loc', 'status', 'findings', 'date'];

/**
 * IZUZECI (svjesno, sa obrazloženjem):
 *  - node_modules, .git               → vendor / VCS
 *  - backend/generated, dist, coverage → generisano build-om
 *  - *.lock, package-lock.json        → generisano (npm), nema ručno pisane logike
 *  - mobile/assets, *.png|ttf|jpg|svg  → binarni resursi
 *  - *.md, docs/, AUDIT/              → dokumentacija (ima svoj guard: STD-02)
 *  - LICENSE, .gitignore              → pravni/VCS metapodaci
 */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'generated', 'assets', '__pycache__', '.expo']);

const INCLUDE_DIRS = [
  'backend/src', 'backend/test', 'backend/prisma',
  'frontend/src', 'frontend/e2e',
  'mobile/app', 'mobile/components', 'mobile/lib', 'mobile/db', 'mobile/sync',
  'mobile/hooks', 'mobile/i18n', 'mobile/constants',
  'scripts/audit', 'scripts/standards', 'scripts/ops', 'scripts/dev', '.github/workflows',
];

const INCLUDE_FILES = [
  'package.json',
  'docker-compose.yml', 'docker-compose.local-ports.yml', 'Dockerfile', 'Dockerfile.frontend',
  '.env.example', '.env.coolify',
  'backend/Dockerfile', 'backend/docker-entrypoint.sh', 'backend/prisma.config.ts',
  'backend/coverage-baseline.json','backend/prisma/index-baseline.json',
  'backend/package.json', 'backend/tsconfig.json', 'backend/tsconfig.build.json',
  'backend/nest-cli.json', 'backend/eslint.config.mjs',
  'frontend/Dockerfile', 'frontend/package.json', 'frontend/tsconfig.json',
  'frontend/tsconfig.app.json', 'frontend/tsconfig.node.json', 'frontend/vite.config.ts',
  'frontend/playwright.config.ts', 'frontend/index.html', 'frontend/components.json',
  'frontend/.oxlintrc.json', 'frontend/nginx/default.conf.template',
  'mobile/package.json', 'mobile/app.json', 'mobile/tsconfig.json',
  'mobile/babel.config.js', 'mobile/metro.config.js',
];

const EXT_ALLOW = new Set([
  '.ts', '.tsx', '.css', '.json', '.prisma', '.sql', '.sh', '.yml', '.yaml',
  '.html', '.template', '.mjs', '.cjs', '.js',
]);

function walk(dirAbs, out) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(path.join(dirAbs, entry.name), out);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.lock') || entry.name === 'package-lock.json') continue;
      out.push(path.join(dirAbs, entry.name));
    }
  }
}

export function collectFiles() {
  const files = new Set();
  for (const rel of INCLUDE_DIRS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const found = [];
    walk(abs, found);
    for (const f of found) {
      if (!EXT_ALLOW.has(path.extname(f))) continue;
      files.add(path.relative(ROOT, f).split(path.sep).join('/'));
    }
  }
  for (const rel of INCLUDE_FILES) {
    if (fs.existsSync(path.join(ROOT, rel))) files.add(rel);
  }
  return [...files].sort();
}

export function countLoc(rel) {
  try {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return text.split('\n').length;
  } catch {
    return 0;
  }
}

// Redoslijed je bitan: prvo specifičnije pravilo.
const RULES = [
  // --- standardi / audit alati ---
  { re: /^scripts\/standards\//, layer: 'STD', module: 'standards', segment: 'STD-01' },
  { re: /^scripts\/dev\//, layer: 'STD', module: 'dev-tools', segment: 'STD-01' },
  { re: /^package\.json$/, layer: 'STD', module: 'standards', segment: 'STD-01' },
  { re: /^scripts\/audit\//, layer: 'STD', module: 'audit-tools', segment: 'STD-01' },
  // INF-07: ACL linija za Redis korisnika.
  { re: /^scripts\/ops\/redis-acl\.sh$/, layer: 'INF', module: 'redis', segment: 'INF-07' },
  // INF-06: operativne skripte (backup/restore runbook).
  { re: /^scripts\/ops\//, layer: 'INF', module: 'ops-scripts', segment: 'INF-06' },
  // --- CI ---
  { re: /^\.github\/workflows\//, layer: 'CI', module: 'ci', segment: 'CI-01' },
  // --- infrastruktura ---
  { re: /^docker-compose.*\.yml$|^\.env\./, layer: 'INF', module: 'compose', segment: 'INF-01' },
  { re: /^Dockerfile$|^backend\/Dockerfile$|^backend\/docker-entrypoint\.sh$/, layer: 'INF', module: 'backend-image', segment: 'INF-02' },
  { re: /^Dockerfile\.frontend$|^frontend\/Dockerfile$|^frontend\/nginx\//, layer: 'INF', module: 'frontend-image', segment: 'INF-03' },

  // --- backend: temelj ---
  { re: /^backend\/prisma\/schema\//, layer: 'BE', module: 'prisma-schema', segment: 'BE-01' },
  { re: /^backend\/prisma\/migrations\//, layer: 'BE', module: 'migrations', segment: 'BE-08' },
  { re: /^backend\/prisma\/seed.*\.ts$/, layer: 'BE', module: 'seed', segment: 'BE-08' },
  { re: /^backend\/coverage-baseline\.json$/, layer: 'TEST', module: 'coverage', segment: 'TEST-01' },
  { re: /^backend\/prisma\/index-baseline\.json$/, layer: 'BE', module: 'migrations', segment: 'BE-08' },
  { re: /^backend\/prisma\.config\.ts$|^backend\/(package\.json|tsconfig.*\.json|nest-cli\.json|eslint\.config\.mjs)$/, layer: 'BE', module: 'config', segment: 'BE-01' },
  { re: /^backend\/src\/(main|app\.module|app\.setup)\.ts$/, layer: 'BE', module: 'bootstrap', segment: 'BE-01' },
  { re: /^backend\/src\/config\//, layer: 'BE', module: 'config', segment: 'BE-01' },
  { re: /^backend\/src\/modules\/prisma\//, layer: 'BE', module: 'prisma', segment: 'BE-01' },
  { re: /^backend\/src\/common\/(constants|types)\//, layer: 'BE', module: 'common', segment: 'BE-01' },
  { re: /^backend\/src\/common\/constants\.ts$/, layer: 'BE', module: 'common', segment: 'BE-01' },
  { re: /^backend\/src\/common\/utils\/storage-path\.ts$/, layer: 'BE', module: 'common', segment: 'BE-11' },
  { re: /^backend\/src\/common\/(dto|errors|filters|interceptors|decorators|guards|utils)\//, layer: 'BE', module: 'common', segment: 'BE-01' },
  { re: /^backend\/src\/common\/(rbac|scope)\//, layer: 'BE', module: 'common', segment: 'BE-03' },
  { re: /^backend\/src\/common\/settings\//, layer: 'BE', module: 'common', segment: 'BE-04' },
  { re: /^backend\/src\/common\/notify\//, layer: 'BE', module: 'common', segment: 'BE-16' },
  { re: /^backend\/src\/common\/geo\//, layer: 'BE', module: 'common', segment: 'BE-12' },
  // INF-04: strukturisano logovanje (JSON, korelacioni ID) — cross-cutting, ali kod živi u backendu.
  { re: /^backend\/src\/common\/logging\//, layer: 'BE', module: 'logging', segment: 'INF-04' },
  // INF-07: Redis klijent + throttle storage (cross-cutting, kod u backendu).
  { re: /^backend\/src\/common\/redis\//, layer: 'INF', module: 'redis', segment: 'INF-07' },
  // --- backend: moduli ---
  { re: /^backend\/src\/modules\/auth\//, layer: 'BE', module: 'auth', segment: 'BE-02' },
  { re: /^backend\/src\/modules\/users\//, layer: 'BE', module: 'users', segment: 'BE-03' },
  { re: /^backend\/src\/modules\/companies\//, layer: 'BE', module: 'companies', segment: 'BE-04' },
  { re: /^backend\/src\/modules\/settings\//, layer: 'BE', module: 'settings', segment: 'BE-04' },
  { re: /^backend\/src\/modules\/audit\//, layer: 'BE', module: 'audit', segment: 'BE-04' },
  { re: /^backend\/src\/modules\/health\//, layer: 'BE', module: 'health', segment: 'BE-18' },
  { re: /^backend\/src\/modules\/payroll\//, layer: 'BE', module: 'payroll', segment: 'BE-13' },
  { re: /^backend\/src\/modules\/erp\//, layer: 'BE', module: 'erp', segment: 'BE-14' },
  { re: /^backend\/src\/modules\/polish\//, layer: 'BE', module: 'polish', segment: 'BE-15' },
  { re: /^backend\/src\/modules\/(public|notifications|mail|realtime)\//, layer: 'BE', module: 'public-notify', segment: 'BE-16' },
  { re: /^backend\/src\/modules\/files\//, layer: 'BE', module: 'files', segment: 'BE-11' },
  // --- backend: ops (po imenu fajla) ---
  { re: /^backend\/src\/modules\/ops\/sync/, layer: 'BE', module: 'ops', segment: 'BE-17' },
  { re: /^backend\/src\/modules\/ops\/(timer|amendments?)/, layer: 'BE', module: 'ops', segment: 'BE-07' },
  { re: /^backend\/src\/modules\/ops\/(tasks?|dispatch)/, layer: 'BE', module: 'ops', segment: 'BE-06' },
  { re: /^backend\/src\/modules\/ops\/(projects?|phases?|assignments?|documents?|project-)/, layer: 'BE', module: 'ops', segment: 'BE-05' },
  { re: /^backend\/src\/modules\/ops\/(machines?|machine-|gps|iot|locations?|devices?)/, layer: 'BE', module: 'ops', segment: 'BE-09' },
  { re: /^backend\/src\/modules\/ops\/(trips?|fuel|depots?|catalog|materials?)/, layer: 'BE', module: 'ops', segment: 'BE-10' },
  { re: /^backend\/src\/modules\/ops\/(diary|incidents?|hse)/, layer: 'BE', module: 'ops', segment: 'BE-11' },
  { re: /^backend\/src\/modules\/ops\/serialize-diary/, layer: 'BE', module: 'ops', segment: 'BE-11' },
  { re: /^backend\/src\/modules\/ops\/serialize-(fleet|gps-device|machine)|^backend\/src\/modules\/ops\/write-machine-gps/, layer: 'BE', module: 'ops', segment: 'BE-09' },
  { re: /^backend\/src\/modules\/ops\/serialize-task/, layer: 'BE', module: 'ops', segment: 'BE-06' },
  { re: /^backend\/src\/modules\/ops\/serialize-timer/, layer: 'BE', module: 'ops', segment: 'BE-07' },
  { re: /^backend\/src\/modules\/ops\/(dashboard|presence|geofence)/, layer: 'BE', module: 'ops', segment: 'BE-12' },
  { re: /^backend\/src\/modules\/ops\//, layer: 'BE', module: 'ops', segment: 'BE-05' },
  // --- backend: testovi ---
  { re: /^backend\/test\/helpers\//, layer: 'TEST', module: 'e2e-helpers', segment: 'TEST-01' },
  { re: /^backend\/test\/(decimal-scale|project-isolation)\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'TEST-01' },
  { re: /^backend\/test\/jest-e2e\.json$/, layer: 'TEST', module: 'e2e-config', segment: 'TEST-01' },
  { re: /^backend\/test\/auth\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'BE-02' },
  { re: /^backend\/test\/users(-rbac)?\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'BE-03' },
  { re: /^backend\/test\/tenant\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'BE-04' },
  { re: /^backend\/test\/(projects|ops-core)\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'BE-05' },
  { re: /^backend\/test\/(fleet|iot)\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'BE-09' },
  { re: /^backend\/test\/(diary|files)\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'BE-11' },
  { re: /^backend\/test\/(ops-web|health)\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'BE-12' },
  { re: /^backend\/test\/(sync|payroll|erp|polish|public)\.e2e-spec\.ts$/, layer: 'TEST', module: 'e2e', segment: 'BE-17' },

  // --- frontend ---
  { re: /^frontend\/src\/index\.css$/, layer: 'FE', module: 'design', segment: 'FE-01' },
  { re: /^frontend\/src\/(App|main)\.tsx?$|^frontend\/src\/vite-env\.d\.ts$|^frontend\/src\/routes\//, layer: 'FE', module: 'app-shell', segment: 'FE-02' },
  {
    re: /^frontend\/src\/components\/layout\/company-switcher\.tsx$/,
    layer: 'FE',
    module: 'admin-ui',
    segment: 'FE-13',
  },
  { re: /^frontend\/src\/components\/layout\//, layer: 'FE', module: 'layout', segment: 'FE-02' },
  { re: /^frontend\/src\/components\/ui\//, layer: 'FE', module: 'ui', segment: 'FE-16' },
  { re: /^frontend\/src\/components\/ops\//, layer: 'FE', module: 'ops-ui', segment: 'FE-08' },
  // FE-05 (D-044): unit/component testovi frontenda — spec fajlovi i testna infrastruktura.
  { re: /^frontend\/src\/.*\.spec\.tsx?$/, layer: 'TEST', module: 'fe-unit', segment: 'FE-05' },
  { re: /^frontend\/test\//, layer: 'TEST', module: 'fe-unit', segment: 'FE-05' },
  { re: /^frontend\/vitest\.config\.ts$/, layer: 'TEST', module: 'fe-unit', segment: 'FE-05' },
  { re: /^frontend\/src\/components\/erp[-\/]/, layer: 'FE', module: 'erp-ui', segment: 'FE-12' },
  { re: /^frontend\/src\/components\/diary-/, layer: 'FE', module: 'diary-ui', segment: 'FE-10' },
  { re: /^frontend\/src\/components\/public-/, layer: 'FE', module: 'public-ui', segment: 'FE-14' },
  // FE-13 (D-052): administracija — postavke, korisnici, firme (prije su padali u generički FE-08).
  {
    re: /^frontend\/src\/components\/(settings|users|companies)\//,
    layer: 'FE',
    module: 'admin-ui',
    segment: 'FE-13',
  },
  { re: /^frontend\/src\/lib\/settings-keys\.ts$/, layer: 'FE', module: 'admin-ui', segment: 'FE-13' },
  { re: /^frontend\/src\/components\//, layer: 'FE', module: 'ops-ui', segment: 'FE-08' },
  { re: /^frontend\/src\/pages\/(login|forgot|reset|change-password)-page\.tsx$/, layer: 'FE', module: 'auth-pages', segment: 'FE-07' },
  { re: /^frontend\/src\/pages\/dashboard-page\.tsx$/, layer: 'FE', module: 'dashboard', segment: 'FE-04' },
  { re: /^frontend\/src\/pages\/(projects|project-detail|tasks|task-detail)-page\.tsx$/, layer: 'FE', module: 'ops-pages', segment: 'FE-08' },
  { re: /^frontend\/src\/pages\/(fleet|fleet-map|logistics)-page\.tsx$/, layer: 'FE', module: 'fleet-pages', segment: 'FE-09' },
  { re: /^frontend\/src\/pages\/(diary|hse|documents)-page\.tsx$/, layer: 'FE', module: 'site-pages', segment: 'FE-10' },
  { re: /^frontend\/src\/pages\/(tenders|services|reports)-page\.tsx$/, layer: 'FE', module: 'office-pages', segment: 'FE-11' },
  { re: /^frontend\/src\/pages\/(payroll|erp)-page\.tsx$/, layer: 'FE', module: 'money-pages', segment: 'FE-12' },
  { re: /^frontend\/src\/pages\/(settings|users|companies)-page\.tsx$/, layer: 'FE', module: 'admin-pages', segment: 'FE-13' },
  { re: /^frontend\/src\/pages\/public-site-page\.tsx$/, layer: 'FE', module: 'public-site', segment: 'FE-14' },
  { re: /^frontend\/src\/(i18n|stores|hooks|lib)\//, layer: 'FE', module: 'shared', segment: 'FE-15' },
  { re: /^frontend\/e2e\/|^frontend\/playwright\.config\.ts$/, layer: 'FE', module: 'e2e', segment: 'FE-06' },
  { re: /^frontend\/(vite\.config\.ts|index\.html|components\.json|\.oxlintrc\.json|package\.json|tsconfig.*\.json)$/, layer: 'FE', module: 'config', segment: 'FE-02' },

  // --- mobile ---
  { re: /^mobile\/app\/(login|change-password)\.tsx$|^mobile\/lib\/(auth-store|secure|api|api-types|compress-image)\.ts$/, layer: 'MOB', module: 'auth', segment: 'MOB-02' },
  { re: /^mobile\/(db|sync)\//, layer: 'MOB', module: 'offline', segment: 'MOB-04' },
  { re: /^mobile\/components\/offline-bar\.tsx$/, layer: 'MOB', module: 'offline', segment: 'MOB-04' },
  { re: /^mobile\/(lib\/(timer-actions|permissions|errors)|i18n\/)/, layer: 'MOB', module: 'domain', segment: 'MOB-06' },
  { re: /^mobile\/components\//, layer: 'MOB', module: 'ui', segment: 'MOB-06' },
  { re: /^mobile\/hooks\//, layer: 'MOB', module: 'hooks', segment: 'MOB-01' },
  { re: /^mobile\/constants\//, layer: 'MOB', module: 'theme', segment: 'MOB-06' },
  { re: /^mobile\//, layer: 'MOB', module: 'app', segment: 'MOB-01' },
];

export function classify(rel) {
  for (const rule of RULES) {
    if (rule.re.test(rel)) return { layer: rule.layer, module: rule.module, segment: rule.segment };
  }
  return { layer: 'UNASSIGNED', module: 'unassigned', segment: 'UNASSIGNED' };
}

export function readMatrix() {
  if (!fs.existsSync(MATRIX_PATH)) return new Map();
  const text = fs.readFileSync(MATRIX_PATH, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return new Map();
  const header = parseCsvLine(lines[0]);
  const rows = new Map();
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((key, i) => { row[key] = cells[i] ?? ''; });
    if (row.file) rows.set(row.file, row);
  }
  return rows;
}

export function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Validate one CSV record (multiline fields are not supported by the matrix). */
export function isValidCsvLine(line) {
  let state = 'start'; // start | bare | quoted | closed
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\n' || ch === '\r') return false;
    if (state === 'quoted') {
      if (ch === '"' && line[i + 1] === '"') i += 1;
      else if (ch === '"') state = 'closed';
    } else if (state === 'closed') {
      if (ch !== ',') return false;
      state = 'start';
    } else if (ch === ',') state = 'start';
    else if (ch === '"') {
      if (state !== 'start') return false;
      state = 'quoted';
    } else state = 'bare';
  }
  return state !== 'quoted';
}

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function readSegments() {
  return JSON.parse(fs.readFileSync(SEGMENTS_PATH, 'utf8')).segments;
}
