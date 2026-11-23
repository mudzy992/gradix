/**
 * CI provjera ažurnosti: generisani dokument mora biti identičan onome na disku.
 *
 * Zašto ne „generiši pa commit u CI“: tada CI mijenja repo. Ovako se razilaženje vidi kao pad
 * sa uputom šta pokrenuti, i to prije nego se klijent zakuca na stari ugovor.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "../src/openapi";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "openapi.json");
const expected = `${JSON.stringify(buildOpenApi(), null, 2)}\n`;

let actual = "";
try {
  actual = readFileSync(target, "utf8");
} catch {
  console.error("openapi.json ne postoji. Pokrenite: pnpm --filter @gradix/contracts openapi");
  process.exit(1);
}

if (actual !== expected) {
  console.error(
    "openapi.json nije ažuran. Pokrenite: pnpm --filter @gradix/contracts openapi\n" +
      "Razlika je posljedica promjene ugovora u src/schemas.ts ili src/routes.ts.",
  );
  process.exit(1);
}

console.log("openapi.json je ažuran");
