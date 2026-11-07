/**
 * Provjera da su RN/React/Expo paketi usklađeni sa onim što traži `expo` iz `package.json`.
 *
 * Zašto postoji: `expo export` za web prolazi i sa neusklađenim verzijama, a native bundle
 * pada tek pri pokretanju (primjer: `react-native@0.86.0` + Expo 58 ⇒
 * `Unable to resolve "react-native/setup-env"`). `expo install --check` traži mrežu; ovo
 * čita `bundledNativeModules.json` iz instaliranog `expo` paketa i ne treba mrežu (radi u CI).
 *
 * Izlaz: 0 = sve usklađeno, 1 = odstupanje (ispisuje koje).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const require = createRequire(join(appDir, "package.json"));

const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
const bundled = require("expo/bundledNativeModules.json");

/** "~1.2.3" / "^1.2.3" / "1.2.3" ⇒ "1.2.3" (bez operatora). */
const bare = (range) => String(range).trim().replace(/^[~^=]+/, "");

const problems = [];
for (const [name, installed] of Object.entries(pkg.dependencies ?? {})) {
  if (name.startsWith("@gradix/")) continue; // workspace paketi
  const wanted = bundled[name];
  if (!wanted) continue; // nije native modul Expo SDK-a (npr. `expo` sam)
  if (bare(wanted) !== bare(installed)) {
    problems.push(`${name}: instalirano ${installed}, Expo 58 traži ${wanted}`);
  }
}

const expoWanted = bundled.expo ?? null;
if (expoWanted && bare(expoWanted) !== bare(pkg.dependencies?.expo)) {
  problems.push(`expo: instalirano ${pkg.dependencies?.expo}, tabela traži ${expoWanted}`);
}

if (problems.length > 0) {
  console.error("Neusklađene verzije (native bundle će pasti ili raditi nepredvidivo):");
  for (const line of problems) console.error(`  - ${line}`);
  console.error("\nPopravi: pnpm --filter @gradix/mobile add <paket>@<verzija iz tabele>, pa pnpm install.");
  process.exit(1);
}

console.log(
  `Expo verzije usklađene (${Object.keys(bundled).length} paketa u tabeli, provjereno ${
    Object.keys(pkg.dependencies ?? {}).filter((n) => bundled[n]).length
  }).`,
);
