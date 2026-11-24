#!/usr/bin/env node
/**
 * Brza provjera Maestro tokova — BEZ emulatora, bez mreže, bez APK-a.
 *
 * Zašto postoji: puni Maestro run (APK + hladan boot emulatora + tokovi) traje 30–40 min i
 * pada zbog okruženja, a ne zbog koda. `IMPLEMENTATION_PLAN.md` zato traži da emulator NE
 * blokira PR/push, a da na svakom pushu ostane brza provjera YAML-a. Ovo je ta provjera.
 *
 * Šta hvata (greške koje su stvarno oborile run):
 *   - nepoznata komanda (`tapOnn`) — Maestro je odbija tek na uređaju;
 *   - nedostajući `appId`/`name` ili prazan blok koraka;
 *   - `${VAR}` koji skripta ne prosljeđuje preko `-e` (na uređaju bude prazan unos);
 *   - tok koji skripta poziva a fajl ne postoji, i obrnuto;
 *   - neescape-ovan navodnik u `echo "…"` — ruši cijeli `run:` blok prije ijednog testa
 *     (run 45381425043).
 *
 * Šta NE provjerava (namjerno): da li element postoji na ekranu. To samo emulator zna.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Poziva se iz `v2` (tako rade i ostale `check-*` skripte), a `.github` je u korijenu repoa.
const ROOT = process.argv[2] ?? ".";
const REPO = ROOT.includes("apps/mobile") ? ROOT : join(ROOT, "..");
const MOBILE = join(ROOT, "apps/mobile");
const FLOWS = join(MOBILE, "maestro/ci");
const SCRIPT = join(MOBILE, "scripts/maestro-ci.sh");

/** Komande koje Maestro poznaje; namjerno široko — cilj je uhvatiti tipfeler. */
const KNOWN = new Set([
  "appId", "name", "outputDir", "tags", "env", "onFlowStart", "onFlowComplete",
  "launchApp", "stopApp", "clearState", "clearKeychain", "tapOn", "doubleTapOn",
  "longPressOn", "assertVisible", "assertNotVisible", "assertTrue", "extendedWaitUntil",
  "scroll", "scrollUntilVisible", "swipe", "inputText", "eraseText", "pressKey",
  "hideKeyboard", "back", "takeScreenshot", "runFlow", "runScript", "waitForAnimationToEnd",
  "repeat", "retry", "copyTextFrom", "pasteText", "openLink", "setLocation",
  "setOrientation", "addMedia", "startRecording", "stopRecording", "evalScript",
]);

/** Promjenljive koje orkestrator prosljeđuje kroz `-e`. */
const PASSED_VARS = new Set(["DEMO_LOZINKA"]);

const problems = [];
const fail = (file, message) => problems.push(`${file}: ${message}`);

/* ------------------------------------------------------------------ 1. workflow YAML */

/*
 * Sintaksa `run:` blokova se provjerava BASH-om, ne regexom.
 *
 * Regex je pokušan prvo i bio je i pregrub i nedovoljan: prijavljivao je legitimne redirecte
 * (`echo "$X" >> "$GITHUB_OUTPUT"`) i propuštao pravi slučaj (``echo "... „tekst" ..."``).
 * `bash -n` je egzaktan parser i hvata TAČNO ono što ruši korak prije ijednog testa
 * (run 45381425043: neescape-ovan navodnik → `syntax error near unexpected token`).
 */
const workflowDir = join(REPO, ".github/workflows");
const workflowFiles = existsSync(workflowDir) ? readdirSync(workflowDir).filter((name) => name.endsWith(".yml")) : [];
if (workflowFiles.length === 0) fail(".github/workflows", "nema workflow fajlova — provjeri putanju");

for (const file of workflowFiles) {
  const lines = readFileSync(join(workflowDir, file), "utf8").split("\n");
  lines.forEach((line, index) => {
    const isFlowBlock = /^\s+(?:run|script):\s*[|>][-+]?\s*$/.test(line);
    if (!isFlowBlock) return;
    const blockIndent = line.length - line.trimStart().length;
    const body = [];
    for (const following of lines.slice(index + 1)) {
      if (following.trim() === "") {
        body.push("");
        continue;
      }
      if (following.length - following.trimStart().length <= blockIndent) break;
      body.push(following.slice(blockIndent + 2));
    }
    if (body.length === 0) return;
    const script = body.join("\n");
    // `python - <<'PY'` i slični heredoc-i su dio bloka; bash ih validira sa ostatkom.
    const check = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    if (check.status !== 0) {
      const reason = (check.stderr ?? "").split("\n").find((row) => row.includes("error")) ?? "sintaksa";
      fail(`${file}:${index + 1}`, `run blok se ne parsira (${reason.trim().slice(0, 90)})`);
    }
  });
}

/* ------------------------------------------------------------------ 2. tokovi */

const flowFiles = existsSync(FLOWS) ? readdirSync(FLOWS).filter((name) => name.endsWith(".yaml")).sort() : [];
if (flowFiles.length === 0) fail("maestro/ci", "nema nijednog toka");

for (const file of flowFiles) {
  const text = readFileSync(join(FLOWS, file), "utf8");
  const parts = text.split(/^---$/m);
  if (parts.length < 2) {
    fail(file, "nema `---` razdjelnika zaglavlja i koraka");
    continue;
  }
  const [header, ...bodyParts] = parts;

  // Zaglavlje: `appId` i `name` su obavezni (ime ide u anotacije i izvještaj).
  const appId = header.match(/^appId:\s*(.+)$/m)?.[1]?.trim();
  const name = header.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (!appId) fail(file, "nedostaje `appId` u zaglavlju");
  if (!name) fail(file, "nedostaje `name` u zaglavlju");

  const body = bodyParts.join("---");
  if (!body.replace(/#.*$/gm, "").trim()) fail(file, "blok koraka je prazan");

  // Komande: svaki element liste na nultom nivou počinje imenom komande.
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#") || !line.startsWith("- ")) continue;
    const item = line.slice(2).trim();
    if (!item) continue;
    const key = item.split(":")[0].trim().replace(/^-+/, "");
    if (item.startsWith("- ")) continue; // ugniježđena lista (npr. `- - tekst`)
    if (!KNOWN.has(key)) fail(file, `nepoznata komanda \`${key}\` (Maestro je odbija tek na uređaju)`);
  }

  // Promjenljive: svaka `${VAR}` mora biti proslijeđena kroz `-e` ili definisana u `env:`.
  const headerHasEnv = /^env:/m.test(header);
  for (const match of text.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
    const variable = match[1];
    if (PASSED_VARS.has(variable) || headerHasEnv) continue;
    fail(file, `koristi \${${variable}} a nije proslijeđen kroz \`-e\` ni definisan u \`env:\``);
  }
}

/* ------------------------------------------------------------------ 3. skripta ↔ tokovi */

if (!existsSync(SCRIPT)) {
  fail("scripts/maestro-ci.sh", "nedostaje orkestrator");
} else {
  const script = readFileSync(SCRIPT, "utf8");
  const referenced = new Set([...script.matchAll(/\$flows_dir\/([A-Za-z0-9_.-]+\.yaml)/g)].map((m) => m[1]));

  for (const file of referenced) {
    if (!existsSync(join(FLOWS, file))) fail("scripts/maestro-ci.sh", `poziva tok koji ne postoji: maestro/ci/${file}`);
  }
  for (const file of flowFiles) {
    if (file.startsWith("_")) continue; // pomoćni tokovi (fokus polja) se zovu direktno
    if (!referenced.has(file) && !script.includes(file)) {
      fail(file, "tok postoji ali ga `scripts/maestro-ci.sh` ne poziva — nikad se ne izvršava");
    }
  }
}

/* ------------------------------------------------------------------ ishod */

if (problems.length > 0) {
  console.error(`Maestro provjera: ${problems.length} problem(a)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Maestro provjera: OK (${flowFiles.length} tokova + workflow YAML) — bez emulatora; ` +
    "puni run samo workflow_dispatch/noćni.",
);
