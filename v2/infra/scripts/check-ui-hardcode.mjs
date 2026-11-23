#!/usr/bin/env node
/**
 * CI stražar (U): u UI sistemu i migriranim ekranima NEMA hardkodiranih boja ni
 * tipografskih brojeva. Boje žive samo u tokenima (globals.css / tokens.ts),
 * veličine u tipografskoj skali. Opseg raste s migracijom: kad se ekran migrira,
 * doda se ovdje i u ESLint (docs/UI-EXCEPTIONS.md — lista se samo smanjuje).
 * Pun opseg (svi ekrani, nula izuzetaka) stupa kad migracija završi.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCOPES = [
  "apps/web/src/components/ui",
  "apps/mobile/src/ui",
  // Migrirani ekrani — predlošci U7b + katalog:
  "apps/web/src/app/ured/radnici",
  "apps/web/src/app/katalog",
  // C.1: novi pregled je migriran od prvnog dana — bez hex i fontSize brojeva.
  "apps/web/src/app/pregled",
  "apps/mobile/src/app/moj-dan.tsx",
  "apps/mobile/src/app/index.tsx",
  "apps/mobile/src/app/katalog.tsx",
];

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FONT_SIZE_NUM = /fontSize\s*:\s*\d/;
const failures = [];

function scan(path) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) scan(join(path, name));
    return;
  }
  if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) return;
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    const rel = `${relative(root, path)}:${i + 1}`;
    if (HEX.test(line) && !line.includes("eslint-disable")) failures.push(`${rel} hardkodirana boja: ${line.trim()}`);
    if (path.includes("apps/mobile") && FONT_SIZE_NUM.test(line)) failures.push(`${rel} fontSize broj izvan tokena: ${line.trim()}`);
  });
}

for (const scope of SCOPES) scan(join(root, scope));

if (failures.length) {
  console.error(`Hardkodiranje u UI sistemu (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("UI hardcode: nema boja ni fontSize brojeva u UI sistemu i migriranim ekranima.");
