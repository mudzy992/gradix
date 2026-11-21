// Zajedničko za scripts/standards/* — bez zavisnosti.
// Svaka provjera ispisuje: pravilo → lokacija → zašto → kako popraviti, i vraća exit 1 na prekršaj.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'generated', '.expo', '.next',
  'build', 'out', 'assets', '__pycache__', 'docs/_retired',
]);

/** Rekurzivno skuplja fajlove; `relDir` je relativan od ROOT-a. */
export function walk(relDir, accept = () => true) {
  const out = [];
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return out;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const r = rel(full);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(r)) continue;
        visit(full);
      } else if (entry.isFile() && accept(r)) out.push(r);
    }
  };
  visit(abs);
  return out;
}

export const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

/** Vrlo mali glob: `*` (bez /), `**` (sve), `{a,b}` alternativa. */
export function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i += 1; } else re += '[^/]*';
    } else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) re += '\\{';
      else {
        const alts = glob.slice(i + 1, end).split(',').map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        re += `(?:${alts.join('|')})`;
        i = end;
      }
    } else if ('\\^$.|+?()[]'.includes(ch)) re += `\\${ch}`;
    else re += ch;
  }
  return new RegExp(`${re}$`);
}

export const matchesAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

/** Allowlist iz scripts/standards/allowlist.json (svaki izuzetak ima razlog). */
export function loadAllowlist() {
  const p = path.join(ROOT, 'scripts/standards/allowlist.json');
  if (!fs.existsSync(p)) return { logs: [], secrets: [], docs: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export class Report {
  constructor(rule, why, fix) {
    this.rule = rule;
    this.why = why;
    this.fix = fix;
    this.violations = [];
    this.warnings = [];
    this.checked = 0;
  }

  bump() { this.checked += 1; }

  violation(location, detail) { this.violations.push({ location, detail }); }

  warning(location, detail) { this.warnings.push({ location, detail }); }

  print() {
    console.log(`\n── ${this.rule} ─────────────────────────────────────`);
    console.log(`   Zašto: ${this.why}`);
    console.log(`   Popravka: ${this.fix}`);
    console.log(`   Provjereno: ${this.checked}`);
    for (const w of this.warnings.slice(0, 20)) console.log(`   ⚠️  ${w.location} — ${w.detail}`);
    if (this.warnings.length > 20) console.log(`   ⚠️  … i još ${this.warnings.length - 20}`);
    for (const v of this.violations.slice(0, 40)) console.log(`   ❌ ${v.location} — ${v.detail}`);
    if (this.violations.length > 40) console.log(`   ❌ … i još ${this.violations.length - 40}`);
    return this.violations.length === 0;
  }
}

export function finish(report) {
  const ok = report.print();
  if (!ok) process.exitCode = 1;
  return ok;
}

/** Linija (1-based) prvog pojavljivanja uzorka u tekstu. */
export function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}
