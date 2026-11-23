import madge from "madge";

/**
 * A2 — CI provjera ciklusa uvozâ, za OBA klijentska paketa (mobilni + web).
 *
 * Zašto ovo postoji: ciklus `ui/index → teren/SignOutButton → ui/index` (mobilni) je
 * pravio da se cijeli UI sistem učita radi jednog dugmeta, a na webu je dev-server
 * znao izgubiti hot-reload na ciklusima klijent ↔ dijalozi. Nulta tolerancija: test
 * pada na SVAKI novi ciklus, ne samo na postojeće.
 *
 * Pokretanje: `pnpm check-cycles` (iz v2/). Alat: madge — čita stvarne import grafove
 * (uključujući `@/` aliase preko web tsconfiga), pa ne zavisi od formatiranja koda.
 */

const TARGETS = [
  { name: "apps/mobile/src", tsConfig: undefined },
  { name: "apps/web/src", tsConfig: "apps/web/tsconfig.json" },
];

let failed = false;
for (const target of TARGETS) {
  const result = await madge([target.name], {
    fileExtensions: ["ts", "tsx"],
    ...(target.tsConfig ? { tsConfig: target.tsConfig } : {}),
  });
  const cycles = result.circular();
  if (cycles.length === 0) {
    console.log(`✔ ${target.name}: nema ciklusa uvozâ`);
    continue;
  }
  failed = true;
  console.error(`✖ ${target.name}: pronađeno ${cycles.length} ciklus(a):`);
  for (const cycle of cycles) {
    console.error(`   ${cycle.join(" → ")}`);
  }
  console.error(
    `   Popravi: izdvoji dijeljene tipove/pomoćnike u zasebnu datoteku (npr. *-shared.ts)\n` +
      `   ili uvoz iz konkretne datoteke umjesto iz barrela (index).`,
  );
}

if (failed) process.exit(1);
