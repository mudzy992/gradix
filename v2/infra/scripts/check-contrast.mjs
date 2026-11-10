#!/usr/bin/env node
/**
 * CI stražar (U): kontrast tokena mora držati WCAG AA u OBJE teme, web i mobilni.
 *   tekst/osnovno >= 4.5, prigušeno >= 4.5 na ploči i pozadini, dugmad >= 4.5,
 *   link >= 4.5, opasnost >= 4.5, ivica polja >= 3 (netekstualni kontrast).
 * Pad ovdje = build pada. Paleta se mijenja samo uz ovu provjeru.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function mix(a, b, percentA) {
  return a.map((v, i) => Math.round((v * percentA + b[i] * (100 - percentA)) / 100));
}
function luminance([r, g, b]) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Razriješi var()/color-mix() izraze iz globals.css u RGB (transparent se tretira preko bijele podloge preglednika — backdrop se ne provjerava). */
function resolver(vars) {
  function resolve(expr, depth = 0) {
    expr = expr.trim();
    const varMatch = expr.match(/^var\((--[a-z-]+)\)$/);
    if (varMatch) return resolve(vars[varMatch[1]], depth + 1);
    if (expr.startsWith("#")) return hexToRgb(expr);
    const mixMatch = expr.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/);
    if (mixMatch) {
      const a = resolve(mixMatch[1], depth + 1);
      const bRaw = mixMatch[3].trim();
      const b = bRaw === "transparent" ? [255, 255, 255] : resolve(bRaw, depth + 1);
      return mix(a, b, parseFloat(mixMatch[2]));
    }
    throw new Error(`Nepoznat izraz boje: ${expr}`);
  }
  return resolve;
}

function parseBlock(css, selector) {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open) === -1 ? css.length : css.indexOf("}", open);
  const vars = {};
  for (const m of css.slice(open, close).matchAll(/(--[a-z-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const css = readFileSync(join(root, "apps/web/src/app/globals.css"), "utf8");
// Paleta živi u svom :root bloku (prije tematskih blokova).
const palette = parseBlock(css, "@theme");
const failures = [];

function check(label, fg, bg, min) {
  const ratio = contrast(fg, bg);
  const ok = ratio >= min;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${ratio.toFixed(2)}:1 (min ${min})`);
  if (!ok) failures.push(`${label} ${ratio.toFixed(2)} < ${min}`);
}

for (const theme of ["light", "dark"]) {
  const selector = theme === "light" ? ':root,\n[data-theme="light"]' : '[data-theme="dark"]';
  const vars = { ...palette, ...parseBlock(css, selector) };
  const resolve = resolver(vars);
  const R = (name) => resolve(vars[name]);
  console.log(`— web ${theme}`);
  check("text/panel", R("--text"), R("--panel"), 4.5);
  check("text/bg", R("--text"), R("--bg"), 4.5);
  check("muted/panel", R("--muted"), R("--panel"), 4.5);
  check("muted/bg", R("--muted"), R("--bg"), 4.5);
  check("on-primary/primary", R("--on-primary"), R("--primary"), 4.5);
  check("on-accent/accent", R("--on-accent"), R("--accent"), 4.5);
  check("link/panel", R("--link"), R("--panel"), 4.5);
  check("danger/panel", R("--danger"), R("--panel"), 4.5);
  check("danger/danger-soft", R("--danger"), R("--danger-soft"), 4.5);
  check("field/panel (ivica)", R("--field"), R("--panel"), 3);
}

// Mobilni tokeni: direktni hex u ThemeTokens objektima.
const mobileTokens = readFileSync(join(root, "apps/mobile/src/theme/tokens.ts"), "utf8");
for (const themeName of ["lightTheme", "darkTheme"]) {
  const block = mobileTokens.slice(mobileTokens.indexOf(`export const ${themeName}`));
  const body = block.slice(0, block.indexOf("};"));
  const get = (key) => hexToRgb(body.match(new RegExp(`${key}:\\s*"(#[0-9a-fA-F]+)"`))[1]);
  console.log(`— mobile ${themeName}`);
  check("text/panel", get("text"), get("panel"), 4.5);
  check("muted/panel", get("muted"), get("panel"), 4.5);
  check("muted/bg", get("muted"), get("bg"), 4.5);
  check("onPrimary/primary", get("onPrimary"), get("primary"), 4.5);
  check("onAccent/accent", get("onAccent"), get("accent"), 4.5);
  check("link/panel", get("link"), get("panel"), 4.5);
  check("danger/panel", get("danger"), get("panel"), 4.5);
  check("danger/dangerSoft", get("danger"), get("dangerSoft"), 4.5);
  check("field/panel (ivica)", get("field"), get("panel"), 3);
}

if (failures.length) {
  console.error(`\nKontrast pada (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nKontrast: sve provjere prolaze (WCAG AA, obje teme, web + mobile).");
